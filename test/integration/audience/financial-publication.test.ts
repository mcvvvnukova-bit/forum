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
      observedAt: "2026-04-01T09:00:00.000Z",
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
      observedAt: "2026-05-01T09:00:00.000Z",
      rawFetchKey: "raw/fns-bfo/new.json",
      parserVersion: "fns-bfo/1.0.0",
    };

    await publishForRun(runId, firstBfo);
    await publishForRun(runId, revexp);
    await publishForRun(runId, [newerBfo]);

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

  it("keeps a newer source-time projection when older evidence arrives later", async () => {
    const inn = parseLegalEntityInn("7704217370");
    const newer: FinancialMetricEvidence = {
      inn,
      reportYear: 2025,
      metric: "revenue",
      value: parseMoneyText("200", "dot"),
      sourceKind: "fns_bfo",
      sourceRecordKey: "7704217370:2025:0710002:newer",
      observedAt: "2026-05-01T09:00:00.000Z",
      rawFetchKey: "raw/fns-bfo/new.json",
      parserVersion: "fns-bfo/1.0.0",
    };
    const older: FinancialMetricEvidence = {
      ...newer,
      value: parseMoneyText("100", "dot"),
      sourceRecordKey: "7704217370:2025:0710002:older",
      observedAt: "2026-04-01T09:00:00.000Z",
      rawFetchKey: "raw/fns-bfo/old.json",
    };

    await publishForRun(runId, [newer]);
    await publishForRun(runId, [older]);

    const observation = await database.query<{
      revenue: string;
      source_record_key: string;
      observed_at: string;
    }>(
      `SELECT observation.revenue::text, evidence.source_record_key,
              evidence.observed_at::text
       FROM audience.financial_observations observation
       JOIN audience.financial_evidence evidence ON evidence.id = observation.revenue_evidence_id
       WHERE observation.company_inn = $1 AND observation.report_year = 2025`,
      [inn],
    );
    expect(observation.rows).toEqual([{
      revenue: "200.00",
      source_record_key: newer.sourceRecordKey,
      observed_at: "2026-05-01 09:00:00+00",
    }]);
  });

  it("rolls back the whole financial batch when later evidence lacks raw provenance", async () => {
    const failureRunId = randomUUID();
    await seedFinancialProvenance(database, failureRunId);
    const inn = parseLegalEntityInn("7710140679");
    const evidence: readonly FinancialMetricEvidence[] = [
      {
        inn,
        reportYear: 2025,
        metric: "income",
        value: parseMoneyText("10", "dot"),
        sourceKind: "fns_revexp",
        sourceRecordKey: "7710140679:2025:income",
        observedAt: "2026-04-01T09:00:00.000Z",
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
        observedAt: "2026-04-01T09:00:00.000Z",
        rawFetchKey: "raw/missing.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
    ];

    await expect(publishForRun(failureRunId, evidence))
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

  it("rolls back evidence and projections when a later metric crosses the locked run year", async () => {
    const failureRunId = randomUUID();
    await seedFinancialProvenance(database, failureRunId);
    const inn = parseLegalEntityInn("7710140679");
    const task = await repository.createTask(failureRunId, "fixture_finance", 300);
    const evidence: readonly FinancialMetricEvidence[] = [
      {
        inn,
        reportYear: 2025,
        metric: "income",
        value: parseMoneyText("15", "dot"),
        sourceKind: "fns_revexp",
        sourceRecordKey: "7710140679:2025:income-year-lock",
        observedAt: "2026-04-01T09:00:00.000Z",
        rawFetchKey: "raw/fns-revexp/report.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
      {
        inn,
        reportYear: 2026,
        metric: "revenue",
        value: parseMoneyText("30", "dot"),
        sourceKind: "fns_bfo",
        sourceRecordKey: "7710140679:2026:revenue-year-lock",
        observedAt: "2026-04-01T09:00:00.000Z",
        rawFetchKey: "raw/fns-bfo/old.json",
        parserVersion: "fns-bfo/1.0.0",
      },
    ];

    try {
      await expect(repository.publishFinancial({
        task,
        reportYear: 2025,
        evidence,
        metricOutcomes: metricOutcomesForEvidence(evidence),
      })).rejects.toThrow(
        "financial evidence report year does not match immutable run scope",
      );

      const rows = await database.query<{ evidence: string; observations: string }>(
        `SELECT
           (SELECT count(*) FROM audience.financial_evidence
            WHERE company_inn = $1)::text AS evidence,
           (SELECT count(*) FROM audience.financial_observations
            WHERE company_inn = $1)::text AS observations`,
        [inn],
      );
      expect(rows.rows[0]).toEqual({ evidence: "0", observations: "0" });
    } finally {
      await database.transaction(async (transaction) => {
        await transaction.query("SET CONSTRAINTS ALL DEFERRED");
        await transaction.query(
          "DELETE FROM audience.financial_observations WHERE company_inn = $1",
          [inn],
        );
        await transaction.query(
          "DELETE FROM audience.financial_evidence WHERE company_inn = $1",
          [inn],
        );
        await transaction.query("DELETE FROM audience.crawl_tasks WHERE id = $1", [task.id]);
      });
    }
  });

  it.each([
    ["revenue mapped to revexp", "revenue", "fns_revexp", "raw/fns-revexp/report.xml"],
    ["income mapped to BFO", "income", "fns_bfo", "raw/fns-bfo/old.json"],
    ["BFO evidence pointing at revexp raw", "revenue", "fns_bfo", "raw/fns-revexp/report.xml"],
  ] as const)("rejects %s", async (_case, metric, sourceKind, rawFetchKey) => {
    const failureRunId = randomUUID();
    await seedFinancialProvenance(database, failureRunId);
    const inn = parseLegalEntityInn("7710140679");
    const evidence: FinancialMetricEvidence = {
      inn,
      reportYear: 2025,
      metric,
      value: parseMoneyText("42", "dot"),
      sourceKind,
      sourceRecordKey: `${inn}:2025:${metric}`,
      observedAt: "2026-04-01T09:00:00.000Z",
      rawFetchKey,
      parserVersion: sourceKind === "fns_bfo" ? "fns-bfo/1.0.0" : "fns-revexp/1.0.0",
    };

    await expect(publishForRun(failureRunId, [evidence]))
      .rejects.toThrow(/financial source mapping|financial raw evidence is missing/);
    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.financial_evidence
       WHERE company_inn = $1 AND report_year = 2025`,
      [inn],
    );
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("atomically persists a mixed published/no-data metric contract", async () => {
    const mixedRunId = randomUUID();
    await seedFinancialProvenance(database, mixedRunId);
    const evidence: FinancialMetricEvidence = {
      inn: parseLegalEntityInn("7707083893"),
      reportYear: 2025,
      metric: "revenue",
      value: parseMoneyText("125000", "dot"),
      sourceKind: "fns_bfo",
      sourceRecordKey: "7707083893:2025:0710002:mixed",
      observedAt: "2026-04-01T09:00:00.000Z",
      rawFetchKey: "raw/fns-bfo/old.json",
      parserVersion: "fns-bfo/1.0.0",
    };
    const metricOutcomes = mixedMetricOutcomes();

    await publishFinancialEvidence({
      runId: mixedRunId,
      reportYear: 2025,
      evidence: [evidence],
      metricOutcomes,
    }, { repository });

    const task = await database.query<{ result_json: unknown }>(
      `SELECT result_json FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_finance' AND status = 'succeeded'`,
      [mixedRunId],
    );
    expect(task.rows).toEqual([{
      result_json: {
        evidence: 1,
        metricOutcomes,
      },
    }]);
  });

  it.each([
    ["a forged no-data outcome carrying evidence", {
      ...mixedMetricOutcomes(),
      revenue: {
        outcome: "no_data" as const,
        evidence: 0 as const,
        sourceAttempt: financialSourceAttempt("fns_bfo", "bfo-old", "raw/fns-bfo/old.json", "fns-bfo/1.0.0"),
      },
    }],
    ["an absent required outcome", {
      revenue: { outcome: "published" as const, evidence: 1 },
      income: mixedMetricOutcomes().income,
    }],
  ])("rejects %s without partially publishing", async (_case, metricOutcomes) => {
    const rejectedRunId = randomUUID();
    await seedFinancialProvenance(database, rejectedRunId);
    const evidence: FinancialMetricEvidence = {
      inn: parseLegalEntityInn("7707083893"),
      reportYear: 2025,
      metric: "revenue",
      value: parseMoneyText("42", "dot"),
      sourceKind: "fns_bfo",
      sourceRecordKey: "7707083893:2025:0710002:rejected-contract",
      observedAt: "2026-04-01T09:00:00.000Z",
      rawFetchKey: "raw/fns-bfo/old.json",
      parserVersion: "fns-bfo/1.0.0",
    };

    await expect(publishFinancialEvidence({
      runId: rejectedRunId,
      reportYear: 2025,
      evidence: [evidence],
      metricOutcomes,
    }, { repository })).rejects.toThrow(/financial metric .*outcome/);
    const rows = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.financial_evidence evidence
       JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
       WHERE raw.run_id = $1`,
      [rejectedRunId],
    );
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("keeps a stale finance token unable to publish a no-data contract", async () => {
    const staleRunId = randomUUID();
    await seedFinancialProvenance(database, staleRunId);
    const stale = await repository.createTask(staleRunId, "fixture_finance", 1);
    await database.query(
      "UPDATE audience.crawl_tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [stale.id],
    );
    const current = await repository.acquireTask(stale.id, 60);
    expect(current?.fencingToken).toBe(stale.fencingToken + 1);

    await expect(repository.publishFinancial({
      task: stale,
      reportYear: 2025,
      evidence: [],
      metricOutcomes: {
        revenue: {
          outcome: "no_data",
          evidence: 0,
          sourceAttempt: financialSourceAttempt("fns_bfo", "bfo-old", "raw/fns-bfo/old.json", "fns-bfo/1.0.0"),
        },
        income: mixedMetricOutcomes().income,
        expenses: mixedMetricOutcomes().expenses,
      },
    })).resolves.toBe(false);
    await expect(repository.taskState(stale.id)).resolves.toMatchObject({
      status: "running",
      resultJson: null,
    });
  });

  function publishForRun(
    targetRunId: string,
    evidence: readonly FinancialMetricEvidence[],
  ): Promise<void> {
    return publishFinancialEvidence({
      runId: targetRunId,
      reportYear: 2025,
      evidence,
      metricOutcomes: metricOutcomesForEvidence(evidence),
    }, { repository });
  }
});

function financialSourceAttempt(
  sourceKind: "fns_bfo" | "fns_revexp",
  sourceRecordKey: string,
  rawFetchKey: string,
  parserVersion: string,
) {
  return {
    sourceKind,
    sourceRecordKey,
    observedAt: "2026-04-01T09:00:00.000Z",
    rawFetchKey,
    parserVersion,
  } as const;
}

function mixedMetricOutcomes() {
  return {
    revenue: { outcome: "published" as const, evidence: 1 },
    income: {
      outcome: "no_data" as const,
      evidence: 0 as const,
      sourceAttempt: financialSourceAttempt("fns_revexp", "revexp", "raw/fns-revexp/report.xml", "fns-revexp/1.0.0"),
    },
    expenses: {
      outcome: "no_data" as const,
      evidence: 0 as const,
      sourceAttempt: financialSourceAttempt("fns_revexp", "revexp", "raw/fns-revexp/report.xml", "fns-revexp/1.0.0"),
    },
  };
}

function metricOutcomesForEvidence(evidence: readonly FinancialMetricEvidence[]) {
  const count = (metric: FinancialMetricEvidence["metric"]) =>
    evidence.filter((item) => item.metric === metric).length;
  return {
    revenue: count("revenue") > 0
      ? { outcome: "published" as const, evidence: count("revenue") }
      : {
          outcome: "no_data" as const,
          evidence: 0 as const,
          sourceAttempt: financialSourceAttempt("fns_bfo", "bfo-old", "raw/fns-bfo/old.json", "fns-bfo/1.0.0"),
        },
    income: count("income") > 0
      ? { outcome: "published" as const, evidence: count("income") }
      : mixedMetricOutcomes().income,
    expenses: count("expenses") > 0
      ? { outcome: "published" as const, evidence: count("expenses") }
      : mixedMetricOutcomes().expenses,
  };
}

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
       ) VALUES ($1, '{"year":2025,"requiredFinancialMetrics":["revenue","income","expenses"]}'::jsonb, 'financial-fixture/1.0.0', 'financial/1.0.0',
         'succeeded', now(), now())`,
      [runId],
    );
    for (const [id, sourceKind, sourceRecordKey, objectKey, checksum, parserVersion] of rawFetches) {
      await transaction.query(
        `INSERT INTO audience.source_fetches (
           id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
           mime_type, final_url, navigation_status, captured_at, parser_version
         ) VALUES ($1, $2, $3, $4, $5, $6,
           'application/octet-stream', $7, 200, '2026-04-01T09:00:00.000Z', $8)`,
        [id, runId, sourceKind, sourceRecordKey, objectKey, checksum,
          `http://127.0.0.1/fixtures/${sourceRecordKey}`, parserVersion],
      );
    }
    for (const [inn, name, sourceRecordKey] of [
      ["7707083893", "АО Альфа", "1001"],
      ["7710140679", "ООО Бета", "1002"],
      ["7704217370", "ООО Гамма", "1003"],
    ]) {
      await transaction.query(
        `INSERT INTO audience.companies (inn, name, source_fetch_id, source_record_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (inn) DO NOTHING`,
        [inn, name, organizationFetch, sourceRecordKey],
      );
    }
  });
}
