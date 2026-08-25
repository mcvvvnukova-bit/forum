import { randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { replayRun } from "../../../src/modules/audience/application/replay-run";
import { enqueueReplayWrite } from "../../../src/apps/browser-runner/enqueue-replay-write";
import { createCandidateEvidence } from "../../../src/modules/audience/domain/candidate-evidence";
import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { MANDATORY_SENSITIVE_QUERY_PARAMETERS } from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import {
  checksumBrowserRawBundle,
  sha256,
} from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import type { AppEnv } from "../../../src/shared/config/env";
import { PgBossJobQueue } from "../../../src/shared/jobs/pg-boss-job-queue";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("task fencing and pg-boss delivery", () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: PostgresDatabase;
  let repository: PostgresAudienceRepository;
  let env: AppEnv;
  let client: S3Client;

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
      s3Bucket: `okved-job-delivery-${randomUUID()}`,
      s3AccessKeyId: "okved-local",
      s3SecretAccessKey: "okved-local-secret",
      listOrgLiveEnabled: false,
    };
    client = s3Client(env);
    await client.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
    await seedOkved(database);
  });

  afterAll(async () => {
    if (client !== undefined && env !== undefined) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: env.s3Bucket }));
      const objects = (listed.Contents ?? []).flatMap((item) =>
        item.Key === undefined ? [] : [{ Key: item.Key }]
      );
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({ Bucket: env.s3Bucket, Delete: { Objects: objects } }));
      }
      await client.send(new DeleteBucketCommand({ Bucket: env.s3Bucket }));
      client.destroy();
    }
    await database?.close();
    await temporaryDatabase?.drop();
  });

  it("lets only the newest fencing token mutate an expired task", async () => {
    const runId = randomUUID();
    const stale = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 1, maxCompanies: 1 },
      fixtureVersion: "fencing-fixture/1.0.0",
      parserVersion: "fencing/1.0.0",
      leaseSeconds: 60,
    });
    await database.query(
      `UPDATE audience.crawl_tasks SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [stale.id],
    );

    const current = await repository.acquireTask(stale.id, 60);

    expect(current?.fencingToken).toBe(stale.fencingToken + 1);
    await expect(repository.failTask(stale, "stale_failure", true)).resolves.toBe(false);
    const state = await database.query<{ status: string; fencing_token: string }>(
      "SELECT status::text, fencing_token::text FROM audience.crawl_tasks WHERE id = $1",
      [stale.id],
    );
    expect(state.rows[0]).toEqual({ status: "running", fencing_token: String(current?.fencingToken) });
  });

  it("keeps block reasons terminal and instructs resume callers to create a new run", async () => {
    const runId = randomUUID();
    const task = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 1, maxCompanies: 1 },
      fixtureVersion: "blocked-fixture/1.0.0",
      parserVersion: "list-org-browser/1.0.0",
      leaseSeconds: 60,
    });
    await expect(repository.completeDiscovery({
      task,
      status: "blocked",
      reason: "captcha",
      dryRun: true,
      candidates: [],
      rawObjects: [],
      discovery: {
        occurrences: 0,
        uniqueSourceRecords: 0,
        acceptedCompanies: 0,
        duplicates: 0,
        rejected: 0,
      },
    })).resolves.toBe(true);

    await expect(repository.createTask(runId, "replay_write", 60)).rejects.toThrow(
      "blocked run cannot be resumed (captcha); create a new run",
    );
    await expect(repository.acquireTask(task.id, 60)).resolves.toBeNull();
    await expect(repository.runStatus(runId)).resolves.toEqual({
      status: "blocked",
      terminalReason: "captcha",
    });
  });

  it("rolls back the replay task when enqueue fails before the shared commit", async () => {
    const { runId } = await stageSingleCandidateRun(database, repository, env, client);
    const taskId = randomUUID();
    const realQueue = new PgBossJobQueue(temporaryDatabase.connectionString);

    try {
      await realQueue.ensureQueue("audience-replay-write");
      const failingQueue = {
        ensureQueue: (name: string) => realQueue.ensureQueue(name),
        publishInTransaction: async () => {
          throw new Error("synthetic enqueue crash");
        },
      };
      await expect(enqueueReplayWrite(runId, database, failingQueue, taskId))
        .rejects.toThrow("synthetic enqueue crash");

      const task = await database.query(
        "SELECT id FROM audience.crawl_tasks WHERE id = $1",
        [taskId],
      );
      const job = await database.query(
        "SELECT id FROM pgboss.job WHERE id = $1",
        [taskId],
      );
      expect(task.rowCount).toBe(0);
      expect(job.rowCount).toBe(0);
    } finally {
      await realQueue.close();
    }
  });

  it("reacquires one expired replay task and makes a completed delivery source-free", async () => {
    const { runId, rawStorage, stored } = await stageSingleCandidateRun(
      database,
      repository,
      env,
      client,
    );
    const crashed = await repository.createTask(runId, "replay_write", 1);
    await database.query(
      `UPDATE audience.crawl_tasks SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [crashed.id],
    );

    const command = { runId, dryRun: false as const, taskId: crashed.id };
    const dependencies = {
      repository,
      rawStorage,
      leaseSeconds: 1,
      leaseRenewalIntervalMs: 100,
    };
    const recovered = await replayRun(command, dependencies);

    expect(recovered).toMatchObject({
      runId,
      companies: 1,
      companyOkveds: 1,
      runCompanyMatches: 1,
      verifiedRawObjects: 1,
    });
    const taskState = await database.query<{
      count: string;
      attempts: string;
      non_terminal: string;
    }>(
      `SELECT count(*)::text AS count,
              max(attempts)::text AS attempts,
              count(*) FILTER (WHERE status IN ('pending', 'running'))::text AS non_terminal
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'replay_write'`,
      [runId],
    );
    expect(taskState.rows[0]).toEqual({ count: "1", attempts: "2", non_terminal: "0" });

    await client.send(new DeleteObjectsCommand({
      Bucket: env.s3Bucket,
      Delete: {
        Objects: [
          { Key: stored.manifestKey },
          { Key: stored.domKey },
          { Key: stored.screenshotKey },
        ],
      },
    }));

    await expect(replayRun(command, dependencies)).resolves.toEqual(recovered);
    const afterNoop = await database.query<{ count: string; non_terminal: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE status IN ('pending', 'running'))::text AS non_terminal
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'replay_write'`,
      [runId],
    );
    expect(afterNoop.rows[0]).toEqual({ count: "1", non_terminal: "0" });
  });

  it("atomically enqueues and delivers one stable replay business task through pg-boss", async () => {
    const { runId, rawStorage } = await stageSingleCandidateRun(
      database,
      repository,
      env,
      client,
    );
    const taskId = randomUUID();
    const queue = new PgBossJobQueue(temporaryDatabase.connectionString);
    let deliveries = 0;
    try {
      const enqueued = await enqueueReplayWrite(runId, database, queue, taskId);
      expect(enqueued).toMatchObject({ runId, taskId, jobId: taskId, queued: true });
      const jobs = await database.query<{ data: { runId: string; taskId: string } }>(
        "SELECT data FROM pgboss.job WHERE id = $1",
        [taskId],
      );
      expect(jobs.rows[0]?.data).toEqual({ runId, taskId });

      await queue.work<{ runId: string; taskId: string }>("audience-replay-write", async (job) => {
        await replayRun({
          runId: job.data.runId,
          taskId: job.data.taskId,
          dryRun: false,
        }, { repository, rawStorage });
        deliveries += 1;
      });
      await waitForDeliveries(() => deliveries, 1);

      const tasks = await database.query<{
        count: string;
        attempts: string;
        non_terminal: string;
      }>(
        `SELECT count(*)::text AS count,
                max(attempts)::text AS attempts,
                count(*) FILTER (WHERE status IN ('pending', 'running'))::text AS non_terminal
         FROM audience.crawl_tasks
         WHERE run_id = $1 AND task_kind = 'replay_write'`,
        [runId],
      );
      expect(tasks.rows[0]).toEqual({ count: "1", attempts: "1", non_terminal: "0" });
    } finally {
      await queue.close();
    }
  }, 20_000);

  it("redelivers a completed replay task through ordinary publish without rereading raw", async () => {
    const { runId, rawStorage, stored } = await stageSingleCandidateRun(
      database,
      repository,
      env,
      client,
    );
    const taskId = randomUUID();
    const queue = new PgBossJobQueue(temporaryDatabase.connectionString);
    let deliveries = 0;
    try {
      await queue.work<{ runId: string; taskId: string }>("audience-replay-write", async (job) => {
        await replayRun({
          runId: job.data.runId,
          taskId: job.data.taskId,
          dryRun: false,
        }, { repository, rawStorage });
        deliveries += 1;
      });
      await enqueueReplayWrite(runId, database, queue, taskId);
      await waitForDeliveries(() => deliveries, 1);

      await client.send(new DeleteObjectsCommand({
        Bucket: env.s3Bucket,
        Delete: {
          Objects: [
            { Key: stored.manifestKey },
            { Key: stored.domKey },
            { Key: stored.screenshotKey },
          ],
        },
      }));
      await queue.publish(
        "audience-replay-write",
        { runId, taskId },
        { singletonKey: `audience:${runId}:replay_write` },
      );
      await waitForDeliveries(() => deliveries, 2);

      const tasks = await database.query<{
        count: string;
        attempts: string;
        non_terminal: string;
      }>(
        `SELECT count(*)::text AS count,
                max(attempts)::text AS attempts,
                count(*) FILTER (WHERE status IN ('pending', 'running'))::text AS non_terminal
         FROM audience.crawl_tasks
         WHERE run_id = $1 AND task_kind = 'replay_write'`,
        [runId],
      );
      expect(tasks.rows[0]).toEqual({ count: "1", attempts: "1", non_terminal: "0" });
    } finally {
      await queue.close();
    }
  }, 20_000);

  it("delivers the same replay payload twice while domain publication remains idempotent", async () => {
    const runId = randomUUID();
    const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const candidate = {
      sourceRecordKey: "1001",
      inn: parseLegalEntityInn("7707083893"),
      name: "АО Альфа",
      website: "https://alpha.example",
      phone: "+7 (495) 111-22-33",
      email: "info@alpha.example",
      okvedCode: parseOkvedCode("43.11"),
      isPrimary: true,
    };
    const sanitizedDomUtf8 = new TextEncoder().encode(
      "<!doctype html><main>redacted</main>",
    );
    const bundle = checksumBrowserRawBundle({
      sourceKind: "list-org-browser",
      parserVersion: "list-org-browser/1.0.0",
      finalUrl: "http://127.0.0.1/fixtures/company/1001",
      capturedAt: "2026-08-24T09:00:00.000Z",
      navigationStatus: 200,
      sanitizedDomUtf8,
      redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pageFingerprintSha256: sha256(sanitizedDomUtf8),
      identity: { runId, page: 1, sourceRecordKey: "1001" },
      sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
      candidateEvidence: createCandidateEvidence(candidate),
      actions: [],
    });
    const stored = await rawStorage.put(bundle);
    const discoveryTask = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 1, maxCompanies: 1 },
      fixtureVersion: "job-fixture/1.0.0",
      parserVersion: "list-org-browser/1.0.0",
      leaseSeconds: 60,
    });
    await expect(repository.completeDiscovery({
      task: discoveryTask,
      status: "succeeded",
      reason: "terminal_marker",
      dryRun: true,
      candidates: [{
        ...candidate,
        rawFetchKey: bundle.checksumSha256,
        parserVersion: bundle.parserVersion,
      }],
      rawObjects: [{
        id: randomUUID(),
        sourceKind: "list-org-browser",
        sourceRecordKey: "1001",
        finalUrl: bundle.finalUrl,
        navigationStatus: bundle.navigationStatus,
        capturedAt: bundle.capturedAt,
        parserVersion: bundle.parserVersion,
        stored,
      }],
      discovery: {
        occurrences: 1,
        uniqueSourceRecords: 1,
        acceptedCompanies: 1,
        duplicates: 0,
        rejected: 0,
      },
    })).resolves.toBe(true);

    const queue = new PgBossJobQueue(temporaryDatabase.connectionString);
    const queueName = `audience-replay-${randomUUID()}`;
    try {
      await queue.work<{ runId: string }>(queueName, async (job) => {
        await replayRun({ runId: job.data.runId, dryRun: false }, { repository, rawStorage });
      });
      const singletonKey = `audience:${runId}:replay_write`;
      await queue.publish(queueName, { runId }, { singletonKey });
      await queue.publish(queueName, { runId }, { singletonKey });

      await waitForReplayTasks(database, runId, 2);

      const counts = await database.query<{
        companies: string;
        relations: string;
        matches: string;
      }>(
        `SELECT
           (SELECT count(*) FROM audience.companies)::text AS companies,
           (SELECT count(*) FROM audience.company_okveds)::text AS relations,
           (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS matches`,
        [runId],
      );
      expect(counts.rows[0]).toEqual({ companies: "1", relations: "1", matches: "1" });
    } finally {
      await queue.close();
    }
  }, 20_000);
});

function s3Client(env: AppEnv): S3Client {
  return new S3Client({
    endpoint: env.s3Endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
  });
}

async function seedOkved(database: PostgresDatabase): Promise<void> {
  const runId = randomUUID();
  const sourceFetchId = randomUUID();
  const datasetReleaseId = randomUUID();
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO audience.crawl_runs (id, scope_json, fixture_version, parser_version, status)
       VALUES ($1, '{}'::jsonb, 'okved-fixture', 'okved/1.0.0', 'succeeded')`,
      [runId],
    );
    await transaction.query(
      `INSERT INTO audience.source_fetches (
         id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
         mime_type, final_url, navigation_status, captured_at, parser_version
       ) VALUES ($1, $2, 'okved-csv', 'OKVED-2-2025', $3, $4,
         'text/csv', 'http://127.0.0.1/fixtures/okved.csv', 200, now(), 'okved/1.0.0')`,
      [sourceFetchId, runId, `raw/okved/${sourceFetchId}.csv`, "f".repeat(64)],
    );
    await transaction.query(
      `INSERT INTO audience.dataset_releases (id, source_kind, source_version, source_fetch_id)
       VALUES ($1, 'okved-csv', 'OKVED-2-2025', $2)`,
      [datasetReleaseId, sourceFetchId],
    );
    await transaction.query(
      `INSERT INTO audience.okveds (code, name, source_version, dataset_release_id)
       VALUES ('43.11', 'Разборка и снос зданий', 'OKVED-2-2025', $1)`,
      [datasetReleaseId],
    );
  });
}

async function waitForReplayTasks(
  database: PostgresDatabase,
  runId: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'replay_write' AND status = 'succeeded'`,
      [runId],
    );
    if (Number(result.rows[0]?.count) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${expected} replay tasks`);
}

async function waitForDeliveries(current: () => number, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (current() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${expected} pg-boss deliveries`);
}

async function stageSingleCandidateRun(
  database: PostgresDatabase,
  repository: PostgresAudienceRepository,
  env: AppEnv,
  client: S3Client,
) {
  const runId = randomUUID();
  const rawStorage = new S3RawObjectStorage(env, "list-org-browser", client);
  const candidate = {
    sourceRecordKey: "1001",
    inn: parseLegalEntityInn("7707083893"),
    name: "АО Альфа",
    website: "https://alpha.example",
    phone: "+7 (495) 111-22-33",
    email: "info@alpha.example",
    okvedCode: parseOkvedCode("43.11"),
    isPrimary: true,
  };
  const sanitizedDomUtf8 = new TextEncoder().encode(
    "<!doctype html><main>redacted</main>",
  );
  const bundle = checksumBrowserRawBundle({
    sourceKind: "list-org-browser",
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "http://127.0.0.1/fixtures/company/1001",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8,
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: sha256(sanitizedDomUtf8),
    identity: { runId, page: 1, sourceRecordKey: "1001" },
    sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
    candidateEvidence: createCandidateEvidence(candidate),
    actions: [],
  });
  const stored = await rawStorage.put(bundle);
  const discoveryTask = await repository.createDiscoveryRun({
    runId,
    scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 1, maxCompanies: 1 },
    fixtureVersion: "job-fixture/1.0.0",
    parserVersion: "list-org-browser/1.0.0",
    leaseSeconds: 60,
  });
  await repository.completeDiscovery({
    task: discoveryTask,
    status: "succeeded",
    reason: "terminal_marker",
    dryRun: true,
    candidates: [{
      ...candidate,
      rawFetchKey: bundle.checksumSha256,
      parserVersion: bundle.parserVersion,
    }],
    rawObjects: [{
      id: randomUUID(),
      sourceKind: "list-org-browser",
      sourceRecordKey: "1001",
      finalUrl: bundle.finalUrl,
      navigationStatus: bundle.navigationStatus,
      capturedAt: bundle.capturedAt,
      parserVersion: bundle.parserVersion,
      stored,
    }],
    discovery: {
      occurrences: 1,
      uniqueSourceRecords: 1,
      acceptedCompanies: 1,
      duplicates: 0,
      rejected: 0,
    },
  });
  return { runId, rawStorage, stored };
}
