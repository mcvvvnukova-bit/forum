import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { publishFinancialEvidence } from "../../../src/modules/audience/application/publish-financial-evidence";
import { parseMoneyText, type FinancialMetricEvidence } from "../../../src/modules/audience/domain/financial";
import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { parseBfo } from "../../../src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser";
import { parseRevexp } from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("financial evidence publication", () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: PostgresDatabase;
  let repository: PostgresAudienceRepository;
  let runId: string;

  beforeAll(async () => {
    temporaryDatabase = await createTemporaryDatabase();
    await runner({
      databaseUrl: temporaryDatabase.connectionString,
      dir: "migrations",
      direction: "up",
      migrationsTable: "okved_migrations",
      migrationsSchema: "public",
    });
    database = new PostgresDatabase(temporaryDatabase.connectionString);
    repository = new PostgresAudienceRepository(database);
    runId = randomUUID();
    await seedFinancialProvenance(database, runId);
  });

  afterAll(async () => {
    await database?.close();
    await temporaryDatabase?.drop();
  });

  it("updates each metric with exact evidence without erasing other source columns", async () => {
    const inn = parseLegalEntityInn("7707083893");
    const bfoBytes = await readFile(new URL("../../fixtures/fns-bfo/report-0710002.json", import.meta.url));
    const revexpBytes = await readFile(new URL("../../fixtures/fns-revexp/revexp.xml", import.meta.url));
    const firstBfo = parseBfo(bfoBytes, {
      inn,
      reportYear: 2025,
      rawFetchKey: "raw/fns-bfo/old.json",
      parserVersion: "fns-bfo/1.0.0",
    }).evidence;
    const revexp = parseRevexp(revexpBytes, {
      reportYear: 2025,
      sourceRecordKey: "7707083893:2025:revexp",
      rawFetchKey: "raw/fns-revexp/report.xml",
      parserVersion: "fns-revexp/1.0.0",
    });
    const newerBfo: FinancialMetricEvidence = {
      inn,
      reportYear: 2025,
      metric: "revenue",
      value: parseMoneyText("130000", "dot"),
      sourceKind: "fns_bfo",
      sourceRecordKey: "7707083893:2025:0710002:3",
      rawFetchKey: "raw/fns-bfo/new.json",
      parserVersion: "fns-bfo/1.0.0",
    };

    await publishFinancialEvidence({ runId, evidence: firstBfo }, { repository });
    await publishFinancialEvidence({ runId, evidence: revexp }, { repository });
    await publishFinancialEvidence({ runId, evidence: [newerBfo] }, { repository });

    const observation = await database.query<{
      revenue: string;
      income: string;
      expenses: string;
      revenue_evidence_id: string;
      income_evidence_id: string;
      expenses_evidence_id: string;
    }>(
      `SELECT revenue::text, income::text, expenses::text,
              revenue_evidence_id, income_evidence_id, expenses_evidence_id
       FROM audience.financial_observations
       WHERE company_inn = $1 AND report_year = 2025`,
      [inn],
    );
    expect(observation.rows[0]).toMatchObject({
      revenue: "130000.00",
      income: "150000.00",
      expenses: "0.00",
    });

    const exactEvidence = await database.query<{ metric: string; amount: string }>(
      `SELECT evidence.metric::text, evidence.amount::text
       FROM audience.financial_observations observation
       CROSS JOIN LATERAL (VALUES
         ('revenue', observation.revenue_evidence_id),
         ('income', observation.income_evidence_id),
         ('expenses', observation.expenses_evidence_id)
       ) selected(metric, evidence_id)
       JOIN audience.financial_evidence evidence ON evidence.id = selected.evidence_id
       WHERE observation.company_inn = $1 AND observation.report_year = 2025
       ORDER BY selected.metric`,
      [inn],
    );
    expect(exactEvidence.rows).toEqual([
      { metric: "expenses", amount: "0.00" },
      { metric: "income", amount: "150000.00" },
      { metric: "revenue", amount: "130000.00" },
    ]);
  });

  it("rolls back the whole financial batch when later evidence lacks raw provenance", async () => {
    const inn = parseLegalEntityInn("7710140679");
    const evidence: readonly FinancialMetricEvidence[] = [
      {
        inn,
        reportYear: 2025,
        metric: "income",
        value: parseMoneyText("10", "dot"),
        sourceKind: "fns_revexp",
        sourceRecordKey: "7710140679:2025:income",
        rawFetchKey: "raw/fns-revexp/report.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
      {
        inn,
        reportYear: 2025,
        metric: "expenses",
        value: parseMoneyText("5", "dot"),
        sourceKind: "fns_revexp",
        sourceRecordKey: "7710140679:2025:expenses",
        rawFetchKey: "raw/missing.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
    ];

    await expect(publishFinancialEvidence({ runId, evidence }, { repository }))
      .rejects.toThrow("financial raw evidence is missing");

    const observations = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.financial_observations
       WHERE company_inn = $1`,
      [inn],
    );
    const publishedEvidence = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.financial_evidence
       WHERE company_inn = $1`,
      [inn],
    );
    expect(observations.rows[0]?.count).toBe("0");
    expect(publishedEvidence.rows[0]?.count).toBe("0");
  });

  it.each([
    ["revenue mapped to revexp", "revenue", "fns_revexp", "raw/fns-revexp/report.xml"],
    ["income mapped to BFO", "income", "fns_bfo", "raw/fns-bfo/old.json"],
    ["BFO evidence pointing at revexp raw", "revenue", "fns_bfo", "raw/fns-revexp/report.xml"],
  ] as const)("rejects %s", async (_case, metric, sourceKind, rawFetchKey) => {
    const inn = parseLegalEntityInn("7710140679");
    const evidence: FinancialMetricEvidence = {
      inn,
      reportYear: 2026,
      metric,
      value: parseMoneyText("42", "dot"),
      sourceKind,
      sourceRecordKey: `${inn}:2026:${metric}`,
      rawFetchKey,
      parserVersion: sourceKind === "fns_bfo" ? "fns-bfo/1.0.0" : "fns-revexp/1.0.0",
    };

    await expect(publishFinancialEvidence({ runId, evidence: [evidence] }, { repository }))
      .rejects.toThrow(/financial source mapping|financial raw evidence is missing/);
    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.financial_evidence
       WHERE company_inn = $1 AND report_year = 2026`,
      [inn],
    );
    expect(rows.rows[0]?.count).toBe("0");
  });
});

async function seedFinancialProvenance(database: PostgresDatabase, runId: string): Promise<void> {
  const organizationFetch = randomUUID();
  const rawFetches = [
    [organizationFetch, "list-org-browser", "organization", "raw/list-org/company.json", "a".repeat(64), "list-org-browser/1.0.0"],
    [randomUUID(), "fns-bfo", "bfo-old", "raw/fns-bfo/old.json", "b".repeat(64), "fns-bfo/1.0.0"],
    [randomUUID(), "fns-revexp", "revexp", "raw/fns-revexp/report.xml", "c".repeat(64), "fns-revexp/1.0.0"],
    [randomUUID(), "fns-bfo", "bfo-new", "raw/fns-bfo/new.json", "d".repeat(64), "fns-bfo/1.0.0"],
  ] as const;

  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, completed_at, published_at
       ) VALUES ($1, '{}'::jsonb, 'financial-fixture/1.0.0', 'financial/1.0.0',
         'succeeded', now(), now())`,
      [runId],
    );
    for (const [id, sourceKind, sourceRecordKey, objectKey, checksum, parserVersion] of rawFetches) {
      await transaction.query(
        `INSERT INTO audience.source_fetches (
           id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
           mime_type, final_url, navigation_status, captured_at, parser_version
         ) VALUES ($1, $2, $3, $4, $5, $6,
           'application/octet-stream', $7, 200, now(), $8)`,
        [id, runId, sourceKind, sourceRecordKey, objectKey, checksum,
          `http://127.0.0.1/fixtures/${sourceRecordKey}`, parserVersion],
      );
    }
    for (const [inn, name, sourceRecordKey] of [
      ["7707083893", "АО Альфа", "1001"],
      ["7710140679", "ООО Бета", "1002"],
    ]) {
      await transaction.query(
        `INSERT INTO audience.companies (inn, name, source_fetch_id, source_record_key)
         VALUES ($1, $2, $3, $4)`,
        [inn, name, organizationFetch, sourceRecordKey],
      );
    }
  });
}
