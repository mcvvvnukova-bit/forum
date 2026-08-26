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

import {
  finalizeRawUploads,
  stageRawUpload,
} from "../../../src/modules/audience/application/raw-upload-coordinator";
import type {
  CapturedRawObject,
  FencedTask,
} from "../../../src/modules/audience/application/ports/audience-repository";
import {
  createRawUploadPlan,
  type StoredProjectionRawObject,
} from "../../../src/modules/audience/application/ports/raw-object-storage";
import { MANDATORY_SENSITIVE_QUERY_PARAMETERS } from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import { checksumProjectionRawBundle, sha256 } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
import type { AppEnv } from "../../../src/shared/config/env";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe.sequential("fenced raw upload intents", () => {
  let temporary: TemporaryDatabase;
  let database: PostgresDatabase;
  let client: S3Client;
  const bucket = `okved-upload-intent-${randomUUID()}`;
  const env: AppEnv = {
    appMode: "fixture",
    databaseUrl: "postgresql://unused",
    s3Endpoint: "http://127.0.0.1:9000",
    s3Bucket: bucket,
    s3AccessKeyId: "okved-local",
    s3SecretAccessKey: "okved-local-secret",
    listOrgLiveEnabled: false,
    fnsLiveEnabled: false,
  };

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
    client = new S3Client({
      endpoint: env.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    const listed = await client?.send(new ListObjectsV2Command({ Bucket: bucket }));
    const objects = (listed?.Contents ?? []).flatMap((item) =>
      item.Key === undefined ? [] : [{ Key: item.Key }]);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    await client?.send(new DeleteBucketCommand({ Bucket: bucket }));
    client?.destroy();
    await database?.close();
    await temporary?.drop();
  });

  it("commits the exact verified intent in the same transaction as its source fetch", async () => {
    const repository = new PostgresAudienceRepository(database);
    const task = await startLiveDiscovery(repository);
    const fixture = rawFixture(task);
    const intentId = await repository.reserveRawUpload(task, fixture.plan);
    expect(intentId).not.toBeNull();
    await expect(repository.markRawUploadVerified(
      task,
      intentId!,
      fixture.plan,
      fixture.verified,
    )).resolves.toBe(true);

    await expect(repository.completeDiscovery(discoveryCompletion(
      task,
      { ...fixture.raw, uploadIntentId: intentId! },
    ))).resolves.toBe(true);

    const persisted = await database.query<{
      state: string;
      intent_fetch_id: string;
      fetch_id: string;
      linked_intent_id: string;
    }>(
      `SELECT intent.state, intent.source_fetch_id AS intent_fetch_id,
              raw_fetch.id AS fetch_id, raw_fetch.raw_upload_intent_id AS linked_intent_id
       FROM audience.raw_upload_intents intent
       JOIN audience.source_fetches raw_fetch ON raw_fetch.raw_upload_intent_id = intent.id
       WHERE intent.id = $1`,
      [intentId],
    );
    expect(persisted.rows).toEqual([{
      state: "committed",
      intent_fetch_id: fixture.raw.id,
      fetch_id: fixture.raw.id,
      linked_intent_id: intentId,
    }]);
  });

  it("rolls back source fetch publication and terminally explains a pre-commit failure", async () => {
    const repository = new PostgresAudienceRepository(database, {
      beforeRawUploadCommit: () => { throw new Error("injected before commit"); },
    });
    const task = await startLiveDiscovery(repository);
    const fixture = rawFixture(task);
    const intentId = await repository.reserveRawUpload(task, fixture.plan);
    expect(intentId).not.toBeNull();
    await repository.markRawUploadVerified(task, intentId!, fixture.plan, fixture.verified);

    await expect(finalizeRawUploads(task, repository, () =>
      repository.completeDiscovery(discoveryCompletion(
        task,
        { ...fixture.raw, uploadIntentId: intentId! },
      )))).rejects.toThrow("injected before commit");

    const intent = await database.query<{ state: string; failure_phase: string; failure_code: string }>(
      "SELECT state, failure_phase, failure_code FROM audience.raw_upload_intents WHERE id = $1",
      [intentId],
    );
    expect(intent.rows).toEqual([{
      state: "failed",
      failure_phase: "before_db_commit",
      failure_code: "raw_upload_before_db_commit",
    }]);
    const fetches = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.source_fetches WHERE run_id = $1",
      [task.runId],
    );
    expect(fetches.rows[0]?.count).toBe("0");
    await expect(repository.runStatus(task.runId)).resolves.toEqual({
      status: "failed",
      terminalReason: "raw_upload_before_db_commit",
    });
  });

  it("rejects a live capture that has no matching verified intent", async () => {
    const repository = new PostgresAudienceRepository(database);
    const task = await startLiveDiscovery(repository);
    const fixture = rawFixture(task);

    await expect(repository.completeDiscovery(
      discoveryCompletion(task, fixture.raw),
    )).rejects.toThrow("verified raw upload intent is required");

    const fetches = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.source_fetches WHERE run_id = $1",
      [task.runId],
    );
    expect(fetches.rows[0]?.count).toBe("0");
    await repository.failTask(task, "test_cleanup", true);
  });

  it.each(["after_data_write", "after_manifest_write"] as const)(
    "persists exact intent and terminal failure when injection occurs %s",
    async (phase) => {
      const repository = new PostgresAudienceRepository(database);
      const task = await startLiveDiscovery(repository);
      const bytes = new TextEncoder().encode("<!doctype html><main>safe projection</main>");
      const bundle = checksumProjectionRawBundle({
        artifactKind: "projection",
        sourceKind: "list-org-live",
        parserVersion: "list-org-live/1.0.0",
        finalUrl: "https://www.list-org.com/company/1001",
        capturedAt: "2026-08-27T00:00:00.000Z",
        navigationStatus: 200,
        sanitizedDomUtf8: bytes,
        pageFingerprintSha256: sha256(bytes),
        identity: { runId: task.runId, page: 1, sourceRecordKey: "1001" },
        candidateEvidence: null,
        sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
      });
      const storage = new S3RawObjectStorage(env, "list-org-live", client, phase === "after_data_write"
        ? { afterDataWrite: () => { throw new Error("injected after data"); } }
        : { afterManifestWrite: () => { throw new Error("injected after manifest"); } });
      const plan = storage.plan(bundle);

      await expect(stageRawUpload({ task, input: bundle, storage, repository }))
        .rejects.toMatchObject({ name: "RawUploadStorageError", phase });

      const intent = await database.query<{
        state: string;
        failure_phase: string;
        failure_code: string;
        object_keys_json: string[];
        object_checksums_json: Record<string, string>;
      }>(
        `SELECT state, failure_phase, failure_code, object_keys_json, object_checksums_json
         FROM audience.raw_upload_intents WHERE run_id = $1`,
        [task.runId],
      );
      expect(intent.rows).toEqual([{
        state: "failed",
        failure_phase: phase,
        failure_code: `raw_upload_${phase}`,
        object_keys_json: plan.objects.map((object) => object.key),
        object_checksums_json: Object.fromEntries(
          plan.objects.map((object) => [object.key, object.checksumSha256]),
        ),
      }]);
      const fetches = await database.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audience.source_fetches WHERE run_id = $1",
        [task.runId],
      );
      expect(fetches.rows[0]?.count).toBe("0");
      const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${plan.stored.prefix}/` }));
      const expectedKeys = phase === "after_data_write"
        ? [plan.stored.kind === "projection" ? plan.stored.projectionKey : ""]
        : plan.objects.map((object) => object.key).sort();
      expect(objects.Contents?.map((object) => object.Key).sort()).toEqual(expectedKeys);
      await expect(repository.runStatus(task.runId)).resolves.toEqual({
        status: "failed",
        terminalReason: `raw_upload_${phase}`,
      });
    },
  );
});

async function startLiveDiscovery(repository: PostgresAudienceRepository): Promise<FencedTask> {
  const runId = randomUUID();
  const started = await repository.startDiscoveryRun({
    runId,
    scope: {
      okved: "43.11",
      year: 2025,
      dryRun: true,
      maxPages: 2,
      maxCompanies: 10,
      onlyActive: false,
      requiredFinancialMetrics: ["revenue", "income", "expenses"],
    },
    fixtureVersion: "list-org-live/1.0.0",
    parserVersion: "list-org-live/1.0.0",
    taskKind: "live_discovery",
    leaseSeconds: 300,
  });
  if (started.state !== "acquired") throw new Error("test discovery task was not acquired");
  return started.task;
}

function rawFixture(task: FencedTask) {
  const checksum = randomUUID().replaceAll("-", "").repeat(2);
  const prefix = `raw/${task.runId}/list-org-live/${checksum}`;
  const stored: StoredProjectionRawObject = {
    kind: "projection",
    runId: task.runId,
    sourceKind: "list-org-live",
    sourceRecordKey: "1001",
    parserVersion: "list-org-live/1.0.0",
    checksumSha256: checksum,
    prefix,
    manifestKey: `${prefix}/manifest.json`,
    projectionKey: `${prefix}/projection.html`,
  };
  const plan = createRawUploadPlan(stored, [
    { key: stored.projectionKey, checksumSha256: "b".repeat(64) },
    { key: stored.manifestKey, checksumSha256: stored.checksumSha256 },
  ]);
  const raw: CapturedRawObject = {
    id: randomUUID(),
    sourceKind: stored.sourceKind,
    sourceRecordKey: stored.sourceRecordKey,
    mimeType: "application/json",
    finalUrl: "https://www.list-org.com/company/1001",
    navigationStatus: 200,
    capturedAt: "2026-08-27T00:00:00.000Z",
    parserVersion: stored.parserVersion,
    stored,
  };
  return {
    stored,
    plan,
    raw,
    verified: {
      runId: stored.runId,
      sourceKind: stored.sourceKind,
      sourceRecordKey: stored.sourceRecordKey,
      checksumSha256: stored.checksumSha256,
      parserVersion: stored.parserVersion,
      candidateEvidence: null,
    },
  } as const;
}

function discoveryCompletion(task: FencedTask, raw: CapturedRawObject) {
  return {
    task,
    status: "succeeded" as const,
    reason: "max_companies_reached",
    dryRun: true,
    candidates: [],
    rawObjects: [raw],
    discovery: {
      occurrences: 0,
      uniqueSourceRecords: 0,
      acceptedCompanies: 0,
      duplicates: 0,
      rejected: 0,
      blockedOrConflicted: 0,
    },
  };
}
