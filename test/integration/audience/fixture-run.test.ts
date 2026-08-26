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
import { publishFinancialEvidence } from "../../../src/modules/audience/application/publish-financial-evidence";
import { reconcileRun } from "../../../src/modules/audience/application/reconcile-run";
import { replayRun } from "../../../src/modules/audience/application/replay-run";
import { runFixtureDiscovery } from "../../../src/modules/audience/application/run-fixture-discovery";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { PostgresOkvedRepository } from "../../../src/modules/audience/infrastructure/postgres/okved-repository";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import {
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  browserVisualSafetyTarget,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
import {
  ExternalBrowserRequestError,
  type BrowserRawBundle,
  type OrganizationSource,
} from "../../../src/modules/audience/domain/discovery";
import { parseMoneyText } from "../../../src/modules/audience/domain/financial";
import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import { sanitizePolicyViolationIdentifier } from "../../../src/modules/audience/domain/terminal-block-reason";
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
      fnsLiveEnabled: false,
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

  it("keeps discovery task kind and active-scope policy immutable across a live retry", async () => {
    const runId = randomUUID();
    const input = {
      runId,
      scope: {
        okved: "43.11",
        year: 2025,
        dryRun: true,
        maxPages: 2,
        maxCompanies: 10,
        onlyActive: false,
        requiredFinancialMetrics: ["revenue", "income", "expenses"] as const,
      },
      fixtureVersion: "list-org-live/1.0.0",
      parserVersion: "list-org-live/1.0.0",
      taskKind: "live_discovery" as const,
      leaseSeconds: 300,
    };

    const started = await repository.startDiscoveryRun(input);
    expect(started).toMatchObject({ state: "acquired", task: { taskKind: "live_discovery" } });
    if (started.state !== "acquired") throw new Error("expected acquired live discovery");
    await expect(repository.failTask(started.task, "test_terminal", true)).resolves.toBe(true);
    await expect(repository.startDiscoveryRun({
      ...input,
      scope: { ...input.scope, onlyActive: true },
    })).rejects.toThrow("active-scope policy");
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

  it("completes an external-resource fixture run after fencing passive external resources", async () => {
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
      status: "succeeded",
      reason: "terminal_marker",
      discoveredCompanies: 3,
      publishedCompanies: 0,
    });
    await expect(repository.runStatus(runId)).resolves.toEqual({
      status: "succeeded",
      terminalReason: "terminal_marker",
    });
    const task = await database.query<{ status: string; reason: string | null }>(
      `SELECT status, result_json->>'reason' AS reason
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toEqual([{ status: "succeeded", reason: "terminal_marker" }]);
  });

  it("durably records a caught service-worker registration as a policy block", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=service-worker-caught`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);

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
      status: "blocked",
      reason: "policy_block",
    });
    const task = await database.query<{ blockers: unknown }>(
      `SELECT result_json->'blockers' AS blockers FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows[0]?.blockers).toEqual([
      expect.objectContaining({
        reason: "policy_block",
        detail: sanitizePolicyViolationIdentifier("service-worker-registration"),
        rawFetchKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
  }, 20_000);

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

  it("publishes parser-derived no-data through the fixture-finance executable", async () => {
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
      year: 2024,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 50,
      fixtureVersion: "list-org-browser-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage });
    await replayRun({ runId, dryRun: false }, { repository, rawStorage });

    const child = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "src/apps/browser-runner/main.ts",
        "fixture-finance",
        "--run-id", runId,
        "--year", "2024",
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
    expect(JSON.parse(child.stdout)).toEqual({
      ok: true,
      result: { runId, publishedEvidence: 2 },
    });
    const task = await database.query<{
      status: string;
      fencing_token: string;
      metric_outcomes: {
        revenue: {
          outcome: string;
          evidence: number;
          sourceAttempt: {
            sourceKind: string;
            rawSourceKind: string;
            sourceRecordKey: string;
            observedAt: string;
            capturedAt: string;
            rawFetchKey: string;
            parserVersion: string;
          };
        };
        income: { outcome: string; evidence: number };
        expenses: { outcome: string; evidence: number };
      };
    }>(
      `SELECT status::text, fencing_token::text,
              result_json->'metricOutcomes' AS metric_outcomes
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_finance'`,
      [runId],
    );
    expect(task.rows).toEqual([{
      status: "succeeded",
      fencing_token: "1",
      metric_outcomes: {
        revenue: {
          outcome: "no_data",
          evidence: 0,
          sourceAttempt: {
            sourceKind: "fns_bfo",
            rawSourceKind: "fns-bfo",
            sourceRecordKey: "7707083893:2024:bfo-fixture",
            observedAt: "2026-08-24T00:00:00.000Z",
            capturedAt: "2026-08-24T00:00:00.000Z",
            rawFetchKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
            parserVersion: "fns-bfo/1.0.0",
          },
        },
        income: { outcome: "published", evidence: 1 },
        expenses: { outcome: "published", evidence: 1 },
      },
    }]);
    const revenueAttempt = task.rows[0]!.metric_outcomes.revenue.sourceAttempt;
    const rawAttempt = await database.query<{
      source_kind: string;
      source_record_key: string;
      captured_at: string;
      checksum_sha256: string;
      parser_version: string;
    }>(
      `SELECT source_kind, source_record_key, captured_at::text,
              checksum_sha256, parser_version
       FROM audience.source_fetches
       WHERE run_id = $1 AND source_kind = 'fns-bfo'`,
      [runId],
    );
    expect(rawAttempt.rows).toEqual([{
      source_kind: "fns-bfo",
      source_record_key: revenueAttempt.sourceRecordKey,
      captured_at: "2026-08-24 00:00:00+00",
      checksum_sha256: revenueAttempt.rawFetchKey,
      parser_version: revenueAttempt.parserVersion,
    }]);
    const evidenceCounts = await database.query<{ metric: string; count: string }>(
      `SELECT metric::text, count(*)::text AS count
       FROM audience.financial_evidence evidence
       JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
       WHERE raw.run_id = $1 GROUP BY metric ORDER BY metric`,
      [runId],
    );
    expect(evidenceCounts.rows).toEqual([
      { metric: "expenses", count: "1" },
      { metric: "income", count: "1" },
    ]);
    await expect(reconcileRun(runId, repository)).resolves.toMatchObject({
      financial: { revenue: 0, income: 1, expenses: 1 },
      consistent: true,
    });
  }, 40_000);

  it("rejects a successful canary when required fixture finance is absent", async () => {
    const runId = randomUUID();
    await database.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
       ) VALUES ($1, $2::jsonb, 'required-finance-fixture/1.0.0',
         'list-org-browser/1.0.0', 'succeeded', 'terminal_marker', now())`,
      [runId, JSON.stringify({
        year: 2025,
        requiredFinancialMetrics: ["revenue", "income", "expenses"],
      })],
    );

    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "required fixture_finance task is absent",
    );
  });

  it("fails the aggregate run and reconciliation after forced fixture_finance_failed", async () => {
    const runId = randomUUID();
    await database.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
       ) VALUES ($1, $2::jsonb, 'required-finance-fixture/1.0.0',
         'list-org-browser/1.0.0', 'succeeded', 'terminal_marker', now())`,
      [runId, JSON.stringify({
        year: 2025,
        requiredFinancialMetrics: ["revenue", "income", "expenses"],
      })],
    );

    await expect(publishFinancialEvidence({
      runId,
      reportYear: 2025,
      evidence: [{
        inn: parseLegalEntityInn("7707083893"),
        reportYear: 2025,
        metric: "revenue",
        value: parseMoneyText("1", "dot"),
        sourceKind: "fns_bfo",
        rawSourceKind: "fns-bfo",
        sourceRecordKey: "7707083893:2025:0710002:forced-failure",
        observedAt: "2026-04-01T09:00:00.000Z",
        rawFetchKey: "raw/forced-missing-finance.json",
        parserVersion: "fns-bfo/1.0.0",
      }],
      metricOutcomes: {
        revenue: { outcome: "published", evidence: 1 },
        income: {
          outcome: "no_data",
          evidence: 0,
          sourceAttempt: missingFinancialSourceAttempt("fns_revexp", "income"),
        },
        expenses: {
          outcome: "no_data",
          evidence: 0,
          sourceAttempt: missingFinancialSourceAttempt("fns_revexp", "expenses"),
        },
      },
    }, { repository })).rejects.toThrow(/financial metric no-data source attempt is missing/);

    await expect(repository.runStatus(runId)).resolves.toEqual({
      status: "failed",
      terminalReason: "fixture_finance_failed",
    });
    const task = await database.query<{ status: string; error_code: string | null }>(
      `SELECT status::text, error_json->>'code' AS error_code
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_finance'`,
      [runId],
    );
    expect(task.rows).toEqual([{ status: "failed", error_code: "fixture_finance_failed" }]);
    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "required fixture_finance task failed: 1",
    );
  });

  it.each([
    ["success", "action-ledger-secret", "succeeded", "terminal_marker"],
    ["failure", "action-ledger-secret-failure", "blocked", "http_403"],
  ])("keeps the durable PostgreSQL action ledger clean on the %s path", async (
    _case,
    scenario,
    expectedStatus,
    expectedReason,
  ) => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=${scenario}`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);

    let summary: Awaited<ReturnType<typeof runFixtureDiscovery>> | undefined;
    let executionError: unknown;
    try {
      summary = await runFixtureDiscovery({
        runId,
        okved: "43.11",
        year: 2025,
        dryRun: true,
        maxPages: 2,
        maxCompanies: 50,
        fixtureVersion: "list-org-browser-fixture/1.0.0",
        parserVersion,
      }, { repository, source, rawStorage });
    } catch (error) {
      executionError = error;
    }

    const task = await database.query<{ action_ledger: unknown; result_json: unknown }>(
      `SELECT result_json->'actionLedger' AS action_ledger, result_json
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toHaveLength(1);
    expect(JSON.stringify(task.rows[0])).not.toContain("dom-only-action-secret");
    expect(executionError).toBeUndefined();
    expect(summary).toMatchObject({ status: expectedStatus, reason: expectedReason });
  }, 20_000);

  it("persists the rejected page identity before any skipped-page occurrence is processed", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=pagination-skips-page`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: () => new Date("2026-08-24T09:00:00.000Z"),
      }),
      runId,
      parserVersion,
    });
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);

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
      status: "blocked",
      reason: "contract_drift",
    });

    const audit = await database.query<{ page_identities: unknown }>(
      `SELECT result_json->'discovery'->'pageIdentities' AS page_identities
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(audit.rows[0]?.page_identities).toEqual([
      expect.objectContaining({ page: 1, orderedSourceRecordKeys: ["1001", "1002"] }),
      expect.objectContaining({
        page: 2,
        orderedSourceRecordKeys: ["1002", "1003"],
        resultFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
  }, 20_000);

  it("recovers expired discovery from page one with lease renewal and write-ahead actions", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const crashed = await repository.createDiscoveryRun({
      runId,
      scope: {
        okved: "43.11",
        year: 2025,
        dryRun: true,
        maxPages: 2,
        maxCompanies: 50,
        requiredFinancialMetrics: ["revenue", "income", "expenses"],
      },
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
    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "required fixture_finance task is absent",
    );
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
      actions: visualSafetyProof(),
    };
    const raw = checksumBrowserRawBundle(rawInput);
    const source = {
      collect: async () => ({
        status: "succeeded" as const,
        reason: "terminal_marker",
        companies: [],
        pages: [{
          page: 1,
          raw,
          occurrences: [],
          orderedSourceRecordKeys: [],
          resultFingerprintSha256: raw.pageFingerprintSha256,
        }],
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

  it("does not conceal an unexplained occurrence as a blocker or conflict", async () => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const raw = checksumBrowserRawBundle({
      sourceKind: "list-org-browser",
      parserVersion,
      finalUrl: "http://127.0.0.1/fixtures/results/page-1",
      capturedAt: "2026-08-24T09:00:00.000Z",
      navigationStatus: 200,
      sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><main>safe</main>"),
      redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pageFingerprintSha256: "a".repeat(64),
      identity: { runId, page: 1 },
      sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
      candidateEvidence: null,
      actions: visualSafetyProof(),
    });
    const source: OrganizationSource = {
      collect: async () => ({
        status: "succeeded",
        reason: "terminal_marker",
        companies: [],
        pages: [{
          page: 1,
          raw,
          orderedSourceRecordKeys: ["orphan-occurrence"],
          resultFingerprintSha256: raw.pageFingerprintSha256,
          occurrences: [{
            sourceRecordKey: "orphan-occurrence",
            resultFingerprintBefore: "a".repeat(64),
            resultFingerprintAfter: "a".repeat(64),
          }],
        }],
        rawBundles: [raw],
        rejects: [],
        blockers: [],
      }),
    };
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);

    await runFixtureDiscovery({
      runId,
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 1,
      maxCompanies: 1,
      fixtureVersion: "unexplained-occurrence-fixture/1.0.0",
      parserVersion,
    }, { repository, source, rawStorage });

    const audit = await database.query<{ discovery: unknown }>(
      `SELECT result_json->'discovery' AS discovery
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(audit.rows[0]?.discovery).toEqual({
      occurrences: 1,
      uniqueSourceRecords: 1,
      acceptedCompanies: 0,
      acceptedSourceRecordKeys: [],
      duplicates: 0,
      rejected: 0,
      blockedOrConflicted: 0,
      pageIdentities: [{
        page: 1,
        orderedSourceRecordKeys: ["orphan-occurrence"],
        resultFingerprintSha256: raw.pageFingerprintSha256,
      }],
    });
    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "unaccounted discovery occurrences: 1",
    );
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
    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "required fixture_finance task is absent",
    );
  });

  it.each([
    ["accepted then rejected", "accepted-then-rejected", "duplicate_conflict", {
      occurrences: 3,
      uniqueSourceRecords: 2,
      acceptedCompanies: 1,
      duplicates: 1,
      rejected: 0,
      blockedOrConflicted: 1,
    }],
    ["rejected then accepted", "rejected-then-accepted", "duplicate_conflict", {
      occurrences: 3,
      uniqueSourceRecords: 2,
      acceptedCompanies: 1,
      duplicates: 1,
      rejected: 0,
      blockedOrConflicted: 1,
    }],
    ["conflicting rejected reasons", "rejected-reason-conflict", "duplicate_conflict", {
      occurrences: 3,
      uniqueSourceRecords: 2,
      acceptedCompanies: 1,
      duplicates: 1,
      rejected: 0,
      blockedOrConflicted: 1,
    }],
    ["mid-page 403", "mid-page-403", "http_403", {
      occurrences: 1,
      uniqueSourceRecords: 1,
      acceptedCompanies: 1,
      duplicates: 0,
      rejected: 0,
      blockedOrConflicted: 0,
    }],
  ] as const)("persists and reconciles blocked discovery for %s", async (
    _case,
    scenario,
    reason,
    expectedDiscovery,
  ) => {
    const runId = randomUUID();
    const parserVersion = "list-org-browser/1.0.0";
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search?scenario=${scenario}`,
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
      status: "blocked",
      reason,
      discoveredCompanies: 1,
    });

    const task = await database.query<{
      status: string;
      result_json: {
        reason: string;
        candidates: Array<{ sourceRecordKey: string }>;
        rejects: unknown[];
        blockers: Array<{ reason: string; sourceRecordKey: string }>;
        discovery: unknown;
      };
    }>(
      `SELECT status::text, result_json
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'`,
      [runId],
    );
    expect(task.rows).toHaveLength(1);
    expect(task.rows[0]).toMatchObject({
      status: "blocked",
      result_json: {
        reason,
        candidates: [expect.objectContaining({ sourceRecordKey: "1001" })],
        rejects: [],
        blockers: [expect.objectContaining({ reason })],
        discovery: expectedDiscovery,
      },
    });
    await expect(reconcileRun(runId, repository)).resolves.toMatchObject({
      status: "blocked",
      terminalReason: reason,
      discovery: expectedDiscovery,
      tasks: { nonTerminal: 0 },
      consistent: true,
    });
  }, 20_000);

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
      acceptedSourceRecordKeys: ["1001", "1002", "1003"],
      duplicates: 1,
      rejected: 0,
      blockedOrConflicted: 0,
      pageIdentities: [
        {
          page: 1,
          orderedSourceRecordKeys: ["1001", "1002"],
          resultFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        {
          page: 2,
          orderedSourceRecordKeys: ["1002", "1003"],
          resultFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      ],
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
    await expect(reconcileRun(runId, repository)).rejects.toThrow(
      "required fixture_finance task is absent",
    );

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

function visualSafetyProof(): BrowserRawBundle["actions"] {
  const id = "123e4567-e89b-42d3-a456-426614174009";
  const event = {
    id,
    at: "2026-08-24T09:00:00.000Z",
    kind: "verify-visual-safety",
    target: browserVisualSafetyTarget("a".repeat(64)),
    navigationStatus: 200,
  } as const;
  return [
    { ...event, outcome: "intent" },
    { ...event, outcome: "completed" },
  ];
}

function missingFinancialSourceAttempt(
  sourceKind: "fns_bfo" | "fns_revexp",
  metric: string,
) {
  return {
    sourceKind,
    rawSourceKind: sourceKind === "fns_bfo" ? "fns-bfo" as const : "fns-revexp" as const,
    sourceRecordKey: `missing-${metric}`,
    observedAt: "2026-04-01T09:00:00.000Z",
    capturedAt: "2026-04-01T09:00:00.000Z",
    rawFetchKey: `raw/missing-${metric}.json`,
    parserVersion: sourceKind === "fns_bfo" ? "fns-bfo/1.0.0" : "fns-revexp/1.0.0",
  } as const;
}

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
