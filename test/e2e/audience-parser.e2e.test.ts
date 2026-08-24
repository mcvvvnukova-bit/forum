import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importSelectedOkveds } from "../../src/modules/audience/application/import-selected-okveds";
import type { CapturedRawObject } from "../../src/modules/audience/application/ports/audience-repository";
import { publishFinancialEvidence } from "../../src/modules/audience/application/publish-financial-evidence";
import { reconcileRun } from "../../src/modules/audience/application/reconcile-run";
import { replayRun } from "../../src/modules/audience/application/replay-run";
import { runFixtureDiscovery } from "../../src/modules/audience/application/run-fixture-discovery";
import { parseLegalEntityInn } from "../../src/modules/audience/domain/inn";
import { PostgresAudienceRepository } from "../../src/modules/audience/infrastructure/postgres/audience-repository";
import { PostgresOkvedRepository } from "../../src/modules/audience/infrastructure/postgres/okved-repository";
import { parseBfo } from "../../src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser";
import { parseRevexp } from "../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import { checksumBrowserRawBundle, sha256 } from "../../src/modules/audience/infrastructure/storage/raw-bundle";
import { S3RawObjectStorage } from "../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import type { AppEnv } from "../../src/shared/config/env";
import { PostgresDatabase } from "../../src/shared/postgres/database";
import {
  startListOrgFixtureServer,
  type ListOrgFixtureServer,
} from "../support/list-org-fixture-server";
import { createTemporaryDatabase, type TemporaryDatabase } from "../support/postgres";

const selectedOkvedsPath = new URL("../../data/okved/selected-okveds.csv", import.meta.url);
const bfoFixturePath = new URL("../fixtures/fns-bfo/report-0710002.json", import.meta.url);
const revexpFixturePath = new URL("../fixtures/fns-revexp/revexp.xml", import.meta.url);

describe.sequential("audience parser fixture acceptance", () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: PostgresDatabase;
  let repository: PostgresAudienceRepository;
  let fixture: ListOrgFixtureServer | undefined;
  let client: S3Client;
  let env: AppEnv;
  let runId: string;
  let afterFirstReplay: unknown;

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
    env = {
      appMode: "fixture",
      databaseUrl: temporaryDatabase.connectionString,
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: `okved-e2e-${randomUUID()}`,
      s3AccessKeyId: "okved-local",
      s3SecretAccessKey: "okved-local-secret",
      listOrgLiveEnabled: false,
    };
    client = new S3Client({
      endpoint: env.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));

    await releaseAndImportSelectedOkved(database, env);

    runId = randomUUID();
    fixture = await startListOrgFixtureServer();
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser");
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion: "list-org-browser/1.0.0",
    });
    await runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion: "list-org-browser/1.0.0",
    }, { repository, source, rawStorage });

    const dryRun = await domainAndEvidenceCounts(database, runId);
    expect(dryRun).toEqual({
      companies: 0,
      companyOkveds: 0,
      runCompanyMatches: 0,
      organizationEvidence: 0,
      financialEvidence: 0,
      financialObservations: 0,
    });

    await fixture.close();
    fixture = undefined;

    await replayRun({ runId, dryRun: false }, { repository, rawStorage });
    afterFirstReplay = await publishedSnapshot(database, runId);
    await replayRun({ runId, dryRun: false }, { repository, rawStorage });
    expect(await publishedSnapshot(database, runId)).toEqual(afterFirstReplay);

    const financial = await stageFinancialFixtures(runId, 2025, env);
    await publishFinancialEvidence(financial, { repository });
  }, 60_000);

  afterAll(async () => {
    await fixture?.close();
    if (client !== undefined && env !== undefined) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: env.s3Bucket }));
      const objects = (listed.Contents ?? []).flatMap((item) =>
        item.Key === undefined ? [] : [{ Key: item.Key }]
      );
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({
          Bucket: env.s3Bucket,
          Delete: { Objects: objects },
        }));
      }
      await client.send(new DeleteBucketCommand({ Bucket: env.s3Bucket }));
      client.destroy();
    }
    await database?.close();
    await temporaryDatabase?.drop();
  });

  it("runs release, browser dry-run, raw replay twice, finance, and exact reconciliation", async () => {
    const report = await reconcileRun(runId, repository);

    expect(report.discovery).toEqual({
      occurrences: 4,
      uniqueSourceRecords: 3,
      acceptedCompanies: 3,
      duplicates: 1,
      rejected: 0,
    });
    expect(report.tasks.nonTerminal).toBe(0);
    expect(report.financial).toEqual({ revenue: 1, income: 1, expenses: 1 });
    expect(report.unexplainedSourceFetches).toBe(0);
    expect(report).toMatchObject({
      status: "succeeded",
      stagedCompanies: 3,
      companies: 3,
      companyOkveds: 3,
      runCompanyMatches: 3,
      published: true,
      consistent: true,
    });

    expect(await readOnlyAcceptanceSnapshot(database, runId)).toEqual({
      companies: 3,
      companyOkveds: 3,
      runCompanyMatches: 3,
      duplicateOccurrences: 1,
      nonLoopbackSourceFetches: 0,
      organizationEvidenceWithoutRaw: 0,
      financialEvidenceWithoutRaw: 0,
      revenue: "125000.00",
      income: "150000.00",
      expenses: "0.00",
    });
  });

  it("rejects any non-terminal crawl task", async () => {
    const taskId = randomUUID();
    await database.query(
      `INSERT INTO audience.crawl_tasks (id, run_id, task_kind, status)
       VALUES ($1, $2, 'acceptance-pending', 'pending')`,
      [taskId, runId],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("non-terminal tasks: 1");
    } finally {
      await database.query("DELETE FROM audience.crawl_tasks WHERE id = $1", [taskId]);
    }
  });

  it("rejects a discovered occurrence that is not accepted, duplicate, or rejected", async () => {
    await setDiscoveryCount(database, runId, "occurrences", 5);
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("unaccounted discovery occurrences: 1");
    } finally {
      await setDiscoveryCount(database, runId, "occurrences", 4);
    }
  });

  it("rejects a published organization without organization evidence", async () => {
    const deleted = await database.query<OrganizationEvidenceRow>(
      `DELETE FROM audience.organization_evidence
       WHERE id = (SELECT id FROM audience.organization_evidence ORDER BY id LIMIT 1)
       RETURNING id, company_inn, source_fetch_id, source_record_key, field_name,
                 value_json, parser_version, collected_at`,
    );
    const evidence = deleted.rows[0]!;
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("organizations without evidence: 1");
    } finally {
      await database.query(
        `INSERT INTO audience.organization_evidence (
           id, company_inn, source_fetch_id, source_record_key, field_name,
           value_json, parser_version, collected_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [evidence.id, evidence.company_inn, evidence.source_fetch_id,
          evidence.source_record_key, evidence.field_name, JSON.stringify(evidence.value_json),
          evidence.parser_version, evidence.collected_at],
      );
    }
  });

  it("rejects organization evidence whose raw fetch/checksum is outside the run", async () => {
    const evidence = await database.query<{ id: string; source_fetch_id: string }>(
      `SELECT id, source_fetch_id FROM audience.organization_evidence ORDER BY id LIMIT 1`,
    );
    const row = evidence.rows[0]!;
    const foreignFetch = await database.query<{ id: string }>(
      `SELECT id FROM audience.source_fetches WHERE run_id <> $1 ORDER BY id LIMIT 1`,
      [runId],
    );
    await database.query(
      "UPDATE audience.organization_evidence SET source_fetch_id = $1 WHERE id = $2",
      [foreignFetch.rows[0]!.id, row.id],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("evidence without run raw checksum: 1");
    } finally {
      await database.query(
        "UPDATE audience.organization_evidence SET source_fetch_id = $1 WHERE id = $2",
        [row.source_fetch_id, row.id],
      );
    }
  });

  it("rejects a successful browser run without an explicit end or limit reason", async () => {
    await database.query(
      "UPDATE audience.crawl_runs SET terminal_reason = 'unexpected_success' WHERE id = $1",
      [runId],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("invalid successful browser end reason");
    } finally {
      await database.query(
        "UPDATE audience.crawl_runs SET terminal_reason = 'terminal_marker' WHERE id = $1",
        [runId],
      );
    }
  });

  it("rejects a financial metric whose evidence is outside the run", async () => {
    const evidence = await database.query<{ id: string; source_fetch_id: string }>(
      `SELECT id, source_fetch_id FROM audience.financial_evidence
       WHERE metric = 'revenue' ORDER BY collected_at DESC, id DESC LIMIT 1`,
    );
    const row = evidence.rows[0]!;
    const foreignFetch = await database.query<{ id: string }>(
      `SELECT id FROM audience.source_fetches WHERE run_id <> $1 ORDER BY id LIMIT 1`,
      [runId],
    );
    await database.query(
      "UPDATE audience.financial_evidence SET source_fetch_id = $1 WHERE id = $2",
      [foreignFetch.rows[0]!.id, row.id],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("published metrics without evidence: 1");
    } finally {
      await database.query(
        "UPDATE audience.financial_evidence SET source_fetch_id = $1 WHERE id = $2",
        [row.source_fetch_id, row.id],
      );
    }
  });

  it("rejects a financial projection that differs from its newest evidence", async () => {
    const source = await database.query<{ id: string }>(
      `SELECT source_fetch_id AS id FROM audience.financial_evidence
       WHERE metric = 'revenue' ORDER BY collected_at DESC, id DESC LIMIT 1`,
    );
    const evidenceId = randomUUID();
    await database.query(
      `INSERT INTO audience.financial_evidence (
         id, company_inn, report_year, metric, amount, source_fetch_id,
         source_record_key, parser_version, collected_at
       ) VALUES ($1, '7707083893', 2025, 'revenue', 130000.00, $2,
         '7707083893:2025:newer-acceptance', 'acceptance/1.0.0', now() + interval '1 second')`,
      [evidenceId, source.rows[0]!.id],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("financial projections behind newest evidence: 1");
    } finally {
      await database.query("DELETE FROM audience.financial_evidence WHERE id = $1", [evidenceId]);
    }
  });

  it("rejects a source fetch that no staged record or evidence explains", async () => {
    const fetchId = randomUUID();
    await database.query(
      `INSERT INTO audience.source_fetches (
         id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
         mime_type, final_url, navigation_status, captured_at, parser_version
       ) VALUES ($1, $2, 'unexpected-fixture', 'orphan', 'raw/orphan/manifest.json', $3,
         'application/json', 'http://127.0.0.1/fixtures/orphan', 200, now(), 'acceptance/1.0.0')`,
      [fetchId, runId, "f".repeat(64)],
    );
    try {
      await expect(reconcileRun(runId, repository)).rejects.toThrow("unexplained source fetches: 1");
    } finally {
      await database.query("DELETE FROM audience.source_fetches WHERE id = $1", [fetchId]);
    }
  });
});

interface OrganizationEvidenceRow {
  id: string;
  company_inn: string;
  source_fetch_id: string;
  source_record_key: string;
  field_name: string;
  value_json: unknown;
  parser_version: string;
  collected_at: string;
}

async function releaseAndImportSelectedOkved(database: PostgresDatabase, env: AppEnv): Promise<void> {
  const csv = await readFile(selectedOkvedsPath);
  const runId = randomUUID();
  const sourceFetchId = randomUUID();
  const datasetReleaseId = randomUUID();
  const bundle = fixtureRawBundle({
    runId,
    page: 1,
    sourceRecordKey: "selected-okveds:2025",
    parserVersion: "selected-okveds/1.0.0",
    finalUrl: "http://127.0.0.1/fixtures/selected-okveds.csv",
    bytes: csv,
  });
  const stored = await new S3RawObjectStorage(env, "okved-csv").put(bundle);
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
       ) VALUES ($1, '{}'::jsonb, 'selected-okveds-fixture/1.0.0',
         'selected-okveds/1.0.0', 'succeeded', 'fixture_release', now())`,
      [runId],
    );
    await transaction.query(
      `INSERT INTO audience.source_fetches (
         id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
         mime_type, final_url, navigation_status, captured_at, parser_version
       ) VALUES ($1, $2, 'okved-csv', 'selected-okveds:2025', $3, $4,
         'text/csv', $5, 200, $6, 'selected-okveds/1.0.0')`,
      [sourceFetchId, runId, stored.manifestKey, stored.checksumSha256,
        bundle.finalUrl, bundle.capturedAt],
    );
    await transaction.query(
      `INSERT INTO audience.dataset_releases (
         id, source_kind, source_version, source_fetch_id, published_at
       ) VALUES ($1, 'okved-csv', 'ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)', $2, now())`,
      [datasetReleaseId, sourceFetchId],
    );
  });
  expect(await importSelectedOkveds(
    csv.toString("utf8"),
    new PostgresOkvedRepository(database),
    datasetReleaseId,
  )).toBe(1);
}

async function stageFinancialFixtures(runId: string, year: number, env: AppEnv) {
  const inn = parseLegalEntityInn("7707083893");
  const [bfoBytes, revexpBytes] = await Promise.all([
    readFile(bfoFixturePath),
    readFile(revexpFixturePath),
  ]);
  const bfoBundle = fixtureRawBundle({
    runId,
    page: 1,
    sourceRecordKey: `${inn}:${year}:bfo-fixture`,
    parserVersion: "fns-bfo/1.0.0",
    finalUrl: `http://127.0.0.1/fixtures/fns-bfo/${year}`,
    bytes: bfoBytes,
  });
  const revexpBundle = fixtureRawBundle({
    runId,
    page: 2,
    sourceRecordKey: `${inn}:${year}:revexp-fixture`,
    parserVersion: "fns-revexp/1.0.0",
    finalUrl: `http://127.0.0.1/fixtures/fns-revexp/${year}`,
    bytes: revexpBytes,
  });
  const [bfoStored, revexpStored] = await Promise.all([
    new S3RawObjectStorage(env, "fns-bfo").put(bfoBundle),
    new S3RawObjectStorage(env, "fns-revexp").put(revexpBundle),
  ]);
  const rawObjects: CapturedRawObject[] = [
    capturedFinancialRaw("fns-bfo", bfoBundle, bfoStored),
    capturedFinancialRaw("fns-revexp", revexpBundle, revexpStored),
  ];
  const bfo = parseBfo(bfoBytes, {
    inn,
    reportYear: year,
    rawFetchKey: bfoStored.checksumSha256,
    parserVersion: bfoBundle.parserVersion,
  });
  const revexp = parseRevexp(revexpBytes, {
    reportYear: year,
    sourceRecordKey: `${inn}:${year}:revexp`,
    rawFetchKey: revexpStored.checksumSha256,
    parserVersion: revexpBundle.parserVersion,
  });
  return { runId, evidence: [...bfo.evidence, ...revexp], rawObjects };
}

function fixtureRawBundle(input: {
  runId: string;
  page: number;
  sourceRecordKey: string;
  parserVersion: string;
  finalUrl: string;
  bytes: Uint8Array;
}) {
  return checksumBrowserRawBundle({
    parserVersion: input.parserVersion,
    finalUrl: input.finalUrl,
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8: input.bytes,
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: sha256(input.bytes),
    identity: {
      runId: input.runId,
      page: input.page,
      sourceRecordKey: input.sourceRecordKey,
    },
    candidateEvidence: null,
    actions: [],
  });
}

function capturedFinancialRaw(
  sourceKind: string,
  bundle: ReturnType<typeof fixtureRawBundle>,
  stored: Awaited<ReturnType<S3RawObjectStorage["put"]>>,
): CapturedRawObject {
  return {
    id: randomUUID(),
    sourceKind,
    sourceRecordKey: bundle.identity.sourceRecordKey!,
    finalUrl: bundle.finalUrl,
    navigationStatus: bundle.navigationStatus,
    capturedAt: bundle.capturedAt,
    parserVersion: bundle.parserVersion,
    stored,
  };
}

async function domainAndEvidenceCounts(database: PostgresDatabase, runId: string) {
  const result = await database.query<{
    companies: string;
    company_okveds: string;
    run_company_matches: string;
    organization_evidence: string;
    financial_evidence: string;
    financial_observations: string;
  }>(
    `SELECT
       (SELECT count(*) FROM audience.companies)::text AS companies,
       (SELECT count(*) FROM audience.company_okveds)::text AS company_okveds,
       (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS run_company_matches,
       (SELECT count(*) FROM audience.organization_evidence)::text AS organization_evidence,
       (SELECT count(*) FROM audience.financial_evidence)::text AS financial_evidence,
       (SELECT count(*) FROM audience.financial_observations)::text AS financial_observations`,
    [runId],
  );
  const row = result.rows[0]!;
  return {
    companies: Number(row.companies),
    companyOkveds: Number(row.company_okveds),
    runCompanyMatches: Number(row.run_company_matches),
    organizationEvidence: Number(row.organization_evidence),
    financialEvidence: Number(row.financial_evidence),
    financialObservations: Number(row.financial_observations),
  };
}

async function publishedSnapshot(database: PostgresDatabase, runId: string) {
  const [companies, relations, matches, evidence] = await Promise.all([
    database.query(
      `SELECT inn, name, website, phone, email, source_fetch_id, source_record_key
       FROM audience.companies ORDER BY inn`,
    ),
    database.query(
      `SELECT company_inn, okved_code, is_primary, source_fetch_id, source_record_key
       FROM audience.company_okveds ORDER BY company_inn, okved_code`,
    ),
    database.query(
      `SELECT company_inn, matched_okved_code, source_fetch_id, source_record_key
       FROM audience.run_company_matches WHERE run_id = $1
       ORDER BY company_inn, matched_okved_code`,
      [runId],
    ),
    database.query(
      `SELECT company_inn, source_fetch_id, source_record_key, field_name, value_json, parser_version
       FROM audience.organization_evidence ORDER BY company_inn, field_name`,
    ),
  ]);
  return { companies: companies.rows, relations: relations.rows, matches: matches.rows, evidence: evidence.rows };
}

async function readOnlyAcceptanceSnapshot(database: PostgresDatabase, runId: string) {
  const result = await database.query<{
    companies: string;
    company_okveds: string;
    run_company_matches: string;
    duplicate_occurrences: string;
    non_loopback_source_fetches: string;
    organization_evidence_without_raw: string;
    financial_evidence_without_raw: string;
    revenue: string;
    income: string;
    expenses: string;
  }>(
    `SELECT
       (SELECT count(*) FROM audience.companies)::text AS companies,
       (SELECT count(*) FROM audience.company_okveds)::text AS company_okveds,
       (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS run_company_matches,
       (SELECT (result_json->'discovery'->>'duplicates')::integer
        FROM audience.crawl_tasks WHERE run_id = $1 AND task_kind = 'fixture_discovery')::text AS duplicate_occurrences,
       (SELECT count(*) FROM audience.source_fetches
        WHERE run_id = $1
          AND final_url !~ '^http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(?:/|$)')::text AS non_loopback_source_fetches,
       (SELECT count(*) FROM audience.organization_evidence evidence
        LEFT JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
        WHERE raw.id IS NULL OR raw.checksum_sha256 IS NULL)::text AS organization_evidence_without_raw,
       (SELECT count(*) FROM audience.financial_evidence evidence
        LEFT JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
        WHERE raw.id IS NULL OR raw.checksum_sha256 IS NULL)::text AS financial_evidence_without_raw,
       observation.revenue::text, observation.income::text, observation.expenses::text
     FROM audience.financial_observations observation
     WHERE observation.company_inn = '7707083893' AND observation.report_year = 2025`,
    [runId],
  );
  const row = result.rows[0]!;
  return {
    companies: Number(row.companies),
    companyOkveds: Number(row.company_okveds),
    runCompanyMatches: Number(row.run_company_matches),
    duplicateOccurrences: Number(row.duplicate_occurrences),
    nonLoopbackSourceFetches: Number(row.non_loopback_source_fetches),
    organizationEvidenceWithoutRaw: Number(row.organization_evidence_without_raw),
    financialEvidenceWithoutRaw: Number(row.financial_evidence_without_raw),
    revenue: row.revenue,
    income: row.income,
    expenses: row.expenses,
  };
}

async function setDiscoveryCount(
  database: PostgresDatabase,
  runId: string,
  field: string,
  value: number,
): Promise<void> {
  await database.query(
    `UPDATE audience.crawl_tasks
     SET result_json = jsonb_set(result_json, ARRAY['discovery', $2], to_jsonb($3::integer))
     WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
    [runId, field, value],
  );
}
