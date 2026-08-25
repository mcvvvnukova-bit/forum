import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importSelectedOkveds } from "../../../src/modules/audience/application/import-selected-okveds";
import { reconcileRun } from "../../../src/modules/audience/application/reconcile-run";
import { replayRun } from "../../../src/modules/audience/application/replay-run";
import { runFixtureDiscovery } from "../../../src/modules/audience/application/run-fixture-discovery";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { PostgresOkvedRepository } from "../../../src/modules/audience/infrastructure/postgres/okved-repository";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import { MANDATORY_SENSITIVE_QUERY_PARAMETERS } from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
import {
  ExternalBrowserRequestError,
  type OrganizationSource,
} from "../../../src/modules/audience/domain/discovery";
import type { AppEnv } from "../../../src/shared/config/env";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import {
  startListOrgFixtureServer,
  type ListOrgFixtureServer,
} from "../../support/list-org-fixture-server";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("fixture discovery and replay publication", () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: PostgresDatabase;
  let repository: PostgresAudienceRepository;
  let fixture: ListOrgFixtureServer;
  let client: S3Client;
  let env: AppEnv;
  let fixtureClosed = false;

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
    fixture = await startListOrgFixtureServer();

    env = {
      appMode: "fixture",
      databaseUrl: temporaryDatabase.connectionString,
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: `okved-fixture-run-${randomUUID()}`,
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
    await seedSelectedOkved(database);
  });

  afterAll(async () => {
    if (!fixtureClosed) await fixture?.close();
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

  it.each([
    ["non-contact name", "name", "Tampered Organization Name"],
    ["contact phone", "phone", "+7 (999) 000-00-00"],
  ])("rejects replay when staged %s differs from checksum-covered candidate evidence", async (
    _case,
    field,
    tamperedValue,
  ) => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });

    await runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage });
    await database.query(
      `UPDATE audience.crawl_tasks
       SET result_json = jsonb_set(
         result_json,
         ARRAY['candidates', '0', $2],
         to_jsonb($3::text)
       )
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId, field, tamperedValue],
    );

    await expect(replayRun({ runId, dryRun: false }, { repository, rawStorage }))
      .rejects.toThrow("staged candidate does not match verified raw evidence");
    expect(await domainCounts(database, runId)).toEqual({
      companies: 0,
      companyOkveds: 0,
      runCompanyMatches: 0,
    });
  });

  it("completes an external-resource fixture run as a fenced policy block", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=external`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });

    await expect(runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage })).resolves.toMatchObject({
      runId,
      status: "blocked",
      reason: "policy_block",
      discoveredCompanies: 0,
      publishedCompanies: 0,
    });
    await expect(repository.runStatus(runId)).resolves.toEqual({
      status: "blocked",
      terminalReason: "policy_block",
    });
    const task = await database.query<{ status: string; reason: string | null }>(
      `SELECT status, result_json->>'reason' AS reason
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toEqual([{ status: "blocked", reason: "policy_block" }]);
  });

  it("fails the task when a source throws an external-request error without raw evidence", async () => {
    const runId = randomUUID();
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source: OrganizationSource = {
      collect: async () => {
        throw new ExternalBrowserRequestError(["https://evidence-free.invalid"]);
      },
    };

    await expect(runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion: "list-org-browser/1.0.0",
    }, { repository, source, rawStorage })).rejects.toThrow("browser request escaped fixture allowlist");

    await expect(repository.runStatus(runId)).resolves.toEqual({
      status: "failed",
      terminalReason: "fixture_discovery_failed",
    });
    const task = await database.query<{ status: string; reason: string | null }>(
      `SELECT status, result_json->>'reason' AS reason
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toEqual([{ status: "failed", reason: null }]);
  });

  it("runs fixture discovery through the production tsx CLI transform", () => {
    const child = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "src/apps/browser-runner/main.ts",
        "fixture-discover",
        "--okved", "43.11",
        "--year", "2025",
        "--max-pages", "2",
        "--max-companies", "50",
        "--dry-run",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          APP_MODE: "fixture",
          LIST_ORG_LIVE_ENABLED: "false",
          DATABASE_URL: temporaryDatabase.connectionString,
          S3_ENDPOINT: env.s3Endpoint,
          S3_BUCKET: env.s3Bucket,
          S3_ACCESS_KEY_ID: env.s3AccessKeyId,
          S3_SECRET_ACCESS_KEY: env.s3SecretAccessKey,
        },
      },
    );

    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({
      ok: true,
      result: {
        status: "succeeded",
        reason: "terminal_marker",
        discoveredCompanies: 3,
        publishedCompanies: 0,
        rawObjects: 6,
      },
    });
  }, 25_000);

  it("rejects a mismatched finance year before staging any raw S3 object", async () => {
    const runId = randomUUID();
    await database.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
       ) VALUES ($1, $2::jsonb, 'finance-year-fixture/1.0.0',
         'list-org-browser/1.0.0', 'succeeded', 'terminal_marker', now())`,
      [runId, JSON.stringify({
        okved: "43.11",
        year: 2025,
        dryRun: true,
        maxPages: 2,
        maxCompanies: 50,
      })],
    );
    const prefix = `raw/${runId}/`;
    const before = await client.send(new ListObjectsV2Command({
      Bucket: env.s3Bucket,
      Prefix: prefix,
    }));
    expect(before.Contents ?? []).toEqual([]);

    const child = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "src/apps/browser-runner/main.ts",
        "fixture-finance",
        "--run-id", runId,
        "--year", "2026",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          APP_MODE: "fixture",
          LIST_ORG_LIVE_ENABLED: "false",
          DATABASE_URL: temporaryDatabase.connectionString,
          S3_ENDPOINT: env.s3Endpoint,
          S3_BUCKET: env.s3Bucket,
          S3_ACCESS_KEY_ID: env.s3AccessKeyId,
          S3_SECRET_ACCESS_KEY: env.s3SecretAccessKey,
        },
      },
    );

    expect(child.status, child.stderr).toBe(1);
    expect(JSON.parse(child.stdout)).toEqual({ ok: false, error: "operation failed" });
    const after = await client.send(new ListObjectsV2Command({
      Bucket: env.s3Bucket,
      Prefix: prefix,
    }));
    expect(after.Contents ?? []).toEqual([]);
  }, 25_000);

  it("recovers expired discovery from page one with lease renewal and write-ahead actions", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const crashed = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 2, maxCompanies: 50 },
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
      leaseSeconds: 1,
    });
    await database.query(
      `UPDATE audience.crawl_tasks SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [crashed.id],
    );
    const actualSource = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });
    const delayedSource = {
      collect: async (...args: Parameters<typeof actualSource.collect>) => {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        return actualSource.collect(...args);
      },
    };
    const recovery = runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, {
      repository,
      source: delayedSource,
      rawStorage,
      leaseSeconds: 1,
      leaseRenewalIntervalMs: 100,
    });

    await waitForTaskAttempts(database, crashed.id, 2);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(repository.acquireTask(crashed.id, 1)).resolves.toBeNull();
    await expect(recovery).resolves.toMatchObject({
      runId,
      status: "succeeded",
      discoveredCompanies: 3,
    });

    const task = await database.query<{
      count: string;
      attempts: number;
      status: string;
      action_ledger: unknown;
    }>(
      `SELECT count(*) OVER ()::text AS count, attempts, status::text,
              result_json->'actionLedger' AS action_ledger
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toHaveLength(1);
    expect(task.rows[0]).toMatchObject({ count: "1", attempts: 2, status: "succeeded" });
    const actions = task.rows[0]!.action_ledger as Array<{
      id: string;
      fencingToken: number;
      kind: string;
      target: string;
      outcome: string;
    }>;
    const recoveredActions = actions.filter((action) => action.fencingToken === 2);
    expect(recoveredActions[0]).toMatchObject({
      kind: "navigate",
      target: `${fixture.origin}/search`,
      outcome: "intent",
    });
    for (const completed of recoveredActions.filter((action) => action.outcome === "completed")) {
      const intentIndex = recoveredActions.findIndex(
        (action) => action.id === completed.id && action.outcome === "intent",
      );
      expect(intentIndex).toBeGreaterThanOrEqual(0);
      expect(intentIndex).toBeLessThan(recoveredActions.indexOf(completed));
    }
    await expect(reconcileRun(runId, repository)).resolves.toMatchObject({
      tasks: { nonTerminal: 0 },
      consistent: true,
    });
  }, 20_000);

  it("fails discovery before persistence when raw identity belongs to another run", async () => {
    const runId = randomUUID();
    const foreignRunId = randomUUID();
    const rawInput = {
      sourceKind: "list-org-browser",
      parserVersion: "list-org-browser/1.0.0",
      finalUrl: "http://127.0.0.1/fixtures/results/page-1",
      capturedAt: "2026-08-24T09:00:00.000Z",
      navigationStatus: 200,
      sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><main>safe</main>"),
      redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pageFingerprintSha256: "a".repeat(64),
      identity: { runId: foreignRunId, page: 1 },
      sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
      candidateEvidence: null,
      actions: [],
    };
    const raw = checksumBrowserRawBundle(rawInput);
    const source = {
      collect: async () => ({
        status: "succeeded" as const,
        reason: "terminal_marker",
        companies: [],
        pages: [{ page: 1, raw, occurrences: [] }],
        rawBundles: [raw],
        rejects: [],
        blockers: [],
      }),
    };
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);

    await expect(runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 1,
      maxCompanies: 1,
      fixtureVersion: "identity-fixture/1.0.0",
      parserVersion: "list-org-browser/1.0.0",
    }, { repository, source, rawStorage })).rejects.toThrow(
      "raw bundle identity does not belong to discovery run",
    );
    const audit = await database.query<{ fetches: string; non_terminal: string }>(
      `SELECT
         (SELECT count(*) FROM audience.source_fetches WHERE run_id = $1)::text AS fetches,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = $1 AND status IN ('pending', 'running'))::text AS non_terminal`,
      [runId],
    );
    expect(audit.rows[0]).toEqual({ fetches: "0", non_terminal: "0" });
  });

  it("reconciles an invalid browser record as one reject and publishes only accepted rows", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=invalid-inn`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });

    await expect(runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage })).resolves.toMatchObject({
      status: "succeeded",
      discoveredCompanies: 2,
    });
    await expect(replayRun({ runId, dryRun: false }, { repository, rawStorage }))
      .resolves.toMatchObject({ companies: 2, companyOkveds: 2, runCompanyMatches: 2 });
    await expect(reconcileRun(runId, repository)).resolves.toMatchObject({
      discovery: {
        occurrences: 4,
        uniqueSourceRecords: 3,
        acceptedCompanies: 2,
        duplicates: 1,
        rejected: 1,
      },
      companies: 2,
      companyOkveds: 2,
      runCompanyMatches: 2,
      tasks: { nonTerminal: 0 },
      consistent: true,
    });
  });

  it("keeps discovery audit-only and replays the original run idempotently from verified raw storage", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });

    const discovery = await runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage });

    expect(discovery).toMatchObject({
      runId,
      status: "succeeded",
      discoveredCompanies: 3,
      publishedCompanies: 0,
    });
    expect(await auditCounts(database, runId)).toMatchObject({ runs: 1, tasks: 1 });
    expect((await auditCounts(database, runId)).sourceFetches).toBeGreaterThan(0);
    const stagedAudit = await database.query<{ discovery: unknown }>(
      `SELECT result_json->'discovery' AS discovery
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(stagedAudit.rows[0]?.discovery).toEqual({
      occurrences: 4,
      uniqueSourceRecords: 3,
      acceptedCompanies: 3,
      duplicates: 1,
      rejected: 0,
    });
    expect(await domainCounts(database, runId)).toEqual({
      companies: 0,
      companyOkveds: 0,
      runCompanyMatches: 0,
    });

    await fixture.close();
    fixtureClosed = true;

    const firstReplay = await replayRun(
      { runId, dryRun: false },
      { repository, rawStorage },
    );
    expect(firstReplay).toMatchObject({
      runId,
      companies: 3,
      companyOkveds: 3,
      runCompanyMatches: 3,
    });
    const firstSnapshot = await domainSnapshot(database, runId);
    expect(await domainCounts(database, runId)).toEqual({
      companies: 3,
      companyOkveds: 3,
      runCompanyMatches: 3,
    });
    await expect(reconcileRun(runId, repository)).resolves.toMatchObject({
      stagedCompanies: 3,
      companies: 3,
      runCompanyMatches: 3,
      published: true,
      consistent: true,
    });

    await replayRun({ runId, dryRun: false }, { repository, rawStorage });

    expect(await domainSnapshot(database, runId)).toEqual(firstSnapshot);
    expect(await auditCounts(database, runId)).toMatchObject({ runs: 1, tasks: 3 });

    const rawManifest = await database.query<{ object_key: string }>(
      `SELECT object_key FROM audience.source_fetches
       WHERE run_id = $1 AND source_kind = 'list-org-browser'
       ORDER BY created_at, id LIMIT 1`,
      [runId],
    );
    const domKey = rawManifest.rows[0]!.object_key.replace(/\/manifest\.json$/, "/dom.html");
    await client.send(new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: domKey,
      Body: "corrupted replay evidence",
      ContentType: "text/html; charset=utf-8",
    }));

    await expect(replayRun({ runId, dryRun: false }, { repository, rawStorage }))
      .rejects.toThrow("raw object checksum verification failed");
    expect(await domainSnapshot(database, runId)).toEqual(firstSnapshot);
    const failedReplay = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'replay_write' AND status = 'failed'`,
      [runId],
    );
    expect(failedReplay.rows[0]?.count).toBe("1");
  });
});

async function seedSelectedOkved(database: PostgresDatabase): Promise<void> {
  const provenanceRunId = randomUUID();
  const sourceFetchId = randomUUID();
  const datasetReleaseId = randomUUID();
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO audience.crawl_runs (id, scope_json, fixture_version, parser_version, status)
       VALUES ($1, '{}'::jsonb, 'selected-okveds-fixture', 'selected-okveds/1.0.0', 'succeeded')`,
      [provenanceRunId],
    );
    await transaction.query(
      `INSERT INTO audience.source_fetches (
         id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
         mime_type, final_url, navigation_status, captured_at, parser_version
       ) VALUES ($1, $2, 'okved-csv', 'OKVED-2-2025', $3, $4,
         'text/csv', 'http://127.0.0.1/fixtures/selected-okveds.csv', 200, now(), 'selected-okveds/1.0.0')`,
      [sourceFetchId, provenanceRunId, `raw/okved-csv/${sourceFetchId}.csv`, "a".repeat(64)],
    );
    await transaction.query(
      `INSERT INTO audience.dataset_releases (
         id, source_kind, source_version, source_fetch_id, published_at
       ) VALUES ($1, 'okved-csv', 'OKVED-2-2025', $2, now())`,
      [datasetReleaseId, sourceFetchId],
    );
  });

  await importSelectedOkveds(
    "code,name,source_version\n43.11,Разборка и снос зданий,OKVED-2-2025\n",
    new PostgresOkvedRepository(database),
    datasetReleaseId,
  );
}

async function auditCounts(database: PostgresDatabase, runId: string) {
  const result = await database.query<{
    runs: string;
    tasks: string;
    source_fetches: string;
  }>(
    `SELECT
       (SELECT count(*) FROM audience.crawl_runs WHERE id = $1)::text AS runs,
       (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = $1)::text AS tasks,
       (SELECT count(*) FROM audience.source_fetches WHERE run_id = $1)::text AS source_fetches`,
    [runId],
  );
  const row = result.rows[0]!;
  return {
    runs: Number(row.runs),
    tasks: Number(row.tasks),
    sourceFetches: Number(row.source_fetches),
  };
}

async function domainCounts(database: PostgresDatabase, runId: string) {
  const result = await database.query<{
    companies: string;
    company_okveds: string;
    run_company_matches: string;
  }>(
    `SELECT
       (SELECT count(DISTINCT company_inn)
        FROM audience.run_company_matches WHERE run_id = $1)::text AS companies,
       (SELECT count(*)
        FROM audience.company_okveds relation
        JOIN audience.run_company_matches match
          ON match.company_inn = relation.company_inn
             AND match.matched_okved_code = relation.okved_code
        WHERE match.run_id = $1)::text AS company_okveds,
       (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS run_company_matches`,
    [runId],
  );
  const row = result.rows[0]!;
  return {
    companies: Number(row.companies),
    companyOkveds: Number(row.company_okveds),
    runCompanyMatches: Number(row.run_company_matches),
  };
}

async function domainSnapshot(database: PostgresDatabase, runId: string) {
  const [companies, companyOkveds, matches] = await Promise.all([
    database.query(
      `SELECT inn, name, website, phone, email, source_fetch_id, source_record_key
       FROM audience.companies ORDER BY inn`,
    ),
    database.query(
      `SELECT company_inn, okved_code, is_primary, source_fetch_id, source_record_key
       FROM audience.company_okveds ORDER BY company_inn, okved_code`,
    ),
    database.query(
      `SELECT run_id, company_inn, matched_okved_code, source_fetch_id, source_record_key
       FROM audience.run_company_matches WHERE run_id = $1
       ORDER BY company_inn, matched_okved_code`,
      [runId],
    ),
  ]);
  return { companies: companies.rows, companyOkveds: companyOkveds.rows, matches: matches.rows };
}

async function waitForTaskAttempts(
  database: PostgresDatabase,
  taskId: string,
  attempts: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await database.query<{ attempts: number }>(
      "SELECT attempts FROM audience.crawl_tasks WHERE id = $1",
      [taskId],
    );
    if (result.rows[0]?.attempts === attempts) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for task ${taskId} to reach attempt ${attempts}`);
}
