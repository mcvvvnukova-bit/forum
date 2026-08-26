import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";

import type {
  CapturedRawObject,
  FencedTask,
} from "../../../src/modules/audience/application/ports/audience-repository";
import { createRawUploadPlan } from "../../../src/modules/audience/application/ports/raw-object-storage";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("transactional blocked lifecycle", () => {
  let temporary: TemporaryDatabase;
  let database: PostgresDatabase;
  let repository: PostgresAudienceRepository;

  beforeAll(async () => {
    temporary = await createTemporaryDatabase();
    await runner({
      databaseUrl: temporary.connectionString,
      dir: "migrations",
      direction: "up",
      migrationsTable: "okved_migrations",
      migrationsSchema: "public",
    });
    database = new PostgresDatabase(temporary.connectionString);
    repository = new PostgresAudienceRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    await temporary?.drop();
  });

  it("atomically registers safe raw evidence and blocks both owned task and run", async () => {
    const runId = randomUUID();
    const task = await repository.createDiscoveryRun({
      runId,
      scope: {
        okved: "43.11",
        year: 2025,
        dryRun: true,
        maxPages: 2,
        maxCompanies: 10,
        onlyActive: false,
      },
      fixtureVersion: "list-org-live/1.0.0",
      parserVersion: "list-org-live/1.0.0",
      taskKind: "live_discovery",
      leaseSeconds: 300,
    });
    const raw = await verifiedRaw(repository, task, capturedRaw(runId));

    await expect(repository.blockRun(
      task,
      "transport_failure",
      [raw],
      "https://user:password@example.test/private?token=secret#fragment",
    )).resolves.toBe(true);

    const state = await database.query<{
      task_status: string;
      run_status: string;
      terminal_reason: string;
      detail: string;
      raw_count: string;
    }>(
      `SELECT task.status::text AS task_status, run.status::text AS run_status,
              run.terminal_reason, task.error_json->>'detail' AS detail,
              (SELECT count(*)::text FROM audience.source_fetches raw
               WHERE raw.run_id = run.id) AS raw_count
       FROM audience.crawl_tasks task
       JOIN audience.crawl_runs run ON run.id = task.run_id
       WHERE task.id = $1`,
      [task.id],
    );
    expect(state.rows).toEqual([{
      task_status: "blocked",
      run_status: "blocked",
      terminal_reason: "transport_failure",
      detail: "https://example.test/private",
      raw_count: "1",
    }]);
  });

  it("rejects an untyped blocker without terminalizing the task", async () => {
    const runId = randomUUID();
    const task = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 2, maxCompanies: 10, onlyActive: false },
      fixtureVersion: "list-org-live/1.0.0",
      parserVersion: "list-org-live/1.0.0",
      taskKind: "live_discovery",
      leaseSeconds: 300,
    });

    await expect(repository.blockRun(
      task,
      "not-a-terminal-reason" as "transport_failure",
      [],
    )).rejects.toThrow("terminal block reason");
    await expect(repository.taskState(task.id)).resolves.toMatchObject({ status: "running" });
  });

  it("atomically registers the shared revexp archive before downstream parsing", async () => {
    const runId = randomUUID();
    const discoveryTask = await repository.createDiscoveryRun({
      runId,
      scope: { okved: "43.11", year: 2025, dryRun: true, maxPages: 2, maxCompanies: 10, onlyActive: false },
      fixtureVersion: "list-org-live/1.0.0",
      parserVersion: "list-org-live/1.0.0",
      taskKind: "live_discovery",
      leaseSeconds: 300,
    });
    await repository.completeDiscovery({
      task: discoveryTask,
      status: "succeeded",
      reason: "terminal_marker",
      dryRun: true,
      candidates: [],
      rawObjects: [],
      discovery: {
        occurrences: 0,
        uniqueSourceRecords: 0,
        acceptedCompanies: 0,
        duplicates: 0,
        rejected: 0,
        blockedOrConflicted: 0,
      },
    });
    const captureTask = await repository.createTask(runId, "live_revexp_capture", 300);
    const raw = await verifiedRaw(repository, captureTask, capturedFileRaw(runId));

    await expect(repository.completeRawCapture(captureTask, raw)).resolves.toBe(true);
    const downstreamFailure = async () => { throw new Error("parser failed after capture"); };
    await expect(downstreamFailure()).rejects.toThrow("parser failed after capture");

    const state = await database.query<{ task_status: string; raw_count: string }>(
      `SELECT task.status::text AS task_status,
              (SELECT count(*)::text FROM audience.source_fetches raw
               WHERE raw.run_id = task.run_id AND raw.source_kind = 'fns-revexp') AS raw_count
       FROM audience.crawl_tasks task WHERE task.id = $1`,
      [captureTask.id],
    );
    expect(state.rows).toEqual([{ task_status: "succeeded", raw_count: "1" }]);
  });
});

function capturedRaw(runId: string): CapturedRawObject {
  const checksum = "a".repeat(64);
  const prefix = `raw/${runId}/list-org-live/${checksum}`;
  return {
    id: randomUUID(),
    sourceKind: "list-org-live",
    sourceRecordKey: "page:1",
    mimeType: "text/html; charset=utf-8",
    finalUrl: "https://www.list-org.com/search",
    navigationStatus: 503,
    capturedAt: "2026-08-26T12:00:00.000Z",
    parserVersion: "list-org-live/1.0.0",
    stored: {
      kind: "browser",
      runId,
      sourceKind: "list-org-live",
      sourceRecordKey: "page:1",
      parserVersion: "list-org-live/1.0.0",
      checksumSha256: checksum,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      domKey: `${prefix}/dom.html`,
      screenshotKey: `${prefix}/screenshot.png`,
    },
  };
}

function capturedFileRaw(runId: string): CapturedRawObject {
  const checksum = "b".repeat(64);
  const prefix = `raw/${runId}/fns-revexp/${checksum}`;
  return {
    id: randomUUID(),
    sourceKind: "fns-revexp",
    sourceRecordKey: "7707329152-revexp:2025",
    mimeType: "application/zip",
    finalUrl: "https://file.nalog.ru/opendata/7707329152-revexp/data-2025.zip",
    navigationStatus: 200,
    capturedAt: "2026-08-26T12:00:00.000Z",
    parserVersion: "fns-revexp/structure-5.10",
    stored: {
      kind: "file",
      runId,
      sourceKind: "fns-revexp",
      sourceRecordKey: "7707329152-revexp:2025",
      parserVersion: "fns-revexp/structure-5.10",
      checksumSha256: checksum,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      dataKey: `${prefix}/data`,
      mimeType: "application/zip",
      byteLength: 512,
    },
  };
}

async function verifiedRaw(
  repository: PostgresAudienceRepository,
  task: FencedTask,
  raw: CapturedRawObject,
): Promise<CapturedRawObject> {
  const dataObjects = raw.stored.kind === "browser"
    ? [
        { key: raw.stored.domKey, checksumSha256: "c".repeat(64) },
        { key: raw.stored.screenshotKey, checksumSha256: "d".repeat(64) },
      ]
    : raw.stored.kind === "projection"
      ? [{ key: raw.stored.projectionKey, checksumSha256: "c".repeat(64) }]
      : [{ key: raw.stored.dataKey, checksumSha256: "c".repeat(64) }];
  const plan = createRawUploadPlan(raw.stored, [
    ...dataObjects,
    { key: raw.stored.manifestKey, checksumSha256: raw.stored.checksumSha256 },
  ]);
  const intentId = await repository.reserveRawUpload(task, plan);
  if (intentId === null) throw new Error("test raw upload intent was not reserved");
  const verified = await repository.markRawUploadVerified(task, intentId, plan, {
    runId: raw.stored.runId,
    sourceKind: raw.stored.sourceKind,
    sourceRecordKey: raw.stored.sourceRecordKey,
    checksumSha256: raw.stored.checksumSha256,
    parserVersion: raw.stored.parserVersion,
    candidateEvidence: null,
  });
  if (!verified) throw new Error("test raw upload intent was not verified");
  return { ...raw, uploadIntentId: intentId };
}
