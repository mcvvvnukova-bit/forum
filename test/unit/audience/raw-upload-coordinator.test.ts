import { describe, expect, it } from "vitest";

import {
  finalizeRawUploads,
  stageRawUpload,
} from "../../../src/modules/audience/application/raw-upload-coordinator";
import type {
  AudienceRepository,
  FencedTask,
} from "../../../src/modules/audience/application/ports/audience-repository";
import {
  createRawUploadPlan,
  RawUploadStorageError,
  type StoredProjectionRawObject,
  type VerifiedRawObject,
} from "../../../src/modules/audience/application/ports/raw-object-storage";

describe("raw upload coordinator", () => {
  it("reserves before the first write and requires verification before recording it", async () => {
    const events: string[] = [];
    const fixture = coordinatorFixture(events);

    await expect(stageRawUpload({
      task: fixture.task,
      input: { bytes: "safe" },
      storage: fixture.storage,
      repository: fixture.repository,
    })).resolves.toEqual({ intentId: fixture.intentId, stored: fixture.stored });

    expect(events).toEqual(["plan", "reserve", "put", "verify", "record-verified"]);
  });

  it("terminally records the exact post-manifest phase when an S3 write partially succeeds", async () => {
    const events: string[] = [];
    const fixture = coordinatorFixture(events, {
      put: async () => {
        events.push("put");
        throw new RawUploadStorageError("after_manifest_write");
      },
    });

    await expect(stageRawUpload({
      task: fixture.task,
      input: { bytes: "safe" },
      storage: fixture.storage,
      repository: fixture.repository,
    })).rejects.toMatchObject({ phase: "after_manifest_write" });

    expect(events).toEqual([
      "plan", "reserve", "put", "fail:after_manifest_write:raw_upload_after_manifest_write",
    ]);
  });

  it("terminalizes earlier staged intents when planning a later upload fails", async () => {
    const events: string[] = [];
    const fixture = coordinatorFixture(events);
    const storage = {
      ...fixture.storage,
      plan: () => {
        events.push("plan");
        throw new Error("invalid later raw bundle");
      },
    };

    await expect(stageRawUpload({
      task: fixture.task,
      input: { bytes: "invalid" },
      storage,
      repository: fixture.repository,
    })).rejects.toThrow("invalid later raw bundle");

    expect(events).toEqual([
      "plan", "fail:storage_write:raw_upload_storage_write",
    ]);
  });

  it("marks all verified intents failed when the terminal DB transaction aborts before commit", async () => {
    const events: string[] = [];
    const fixture = coordinatorFixture(events);

    await expect(finalizeRawUploads(
      fixture.task,
      fixture.repository,
      async () => {
        events.push("terminal-transaction");
        throw new Error("injected before commit");
      },
    )).rejects.toThrow("injected before commit");

    expect(events).toEqual([
      "terminal-transaction", "fail:before_db_commit:raw_upload_before_db_commit",
    ]);
  });
});

function coordinatorFixture(
  events: string[],
  overrides: { put?: () => Promise<StoredProjectionRawObject> } = {},
) {
  const task: FencedTask = {
    id: "00000000-0000-4000-8000-000000000101",
    runId: "00000000-0000-4000-8000-000000000100",
    taskKind: "live_discovery",
    fencingToken: 7,
  };
  const stored: StoredProjectionRawObject = {
    kind: "projection",
    runId: task.runId,
    sourceKind: "list-org-live",
    sourceRecordKey: "1001",
    parserVersion: "list-org-live/1.0.0",
    checksumSha256: "a".repeat(64),
    prefix: `raw/${task.runId}/list-org-live/${"a".repeat(64)}`,
    manifestKey: `raw/${task.runId}/list-org-live/${"a".repeat(64)}/manifest.json`,
    projectionKey: `raw/${task.runId}/list-org-live/${"a".repeat(64)}/projection.html`,
  };
  const plan = createRawUploadPlan(stored, [
    { key: stored.projectionKey, checksumSha256: "b".repeat(64) },
    { key: stored.manifestKey, checksumSha256: stored.checksumSha256 },
  ]);
  const verified: VerifiedRawObject = {
    runId: stored.runId,
    sourceKind: stored.sourceKind,
    sourceRecordKey: stored.sourceRecordKey,
    checksumSha256: stored.checksumSha256,
    parserVersion: stored.parserVersion,
    candidateEvidence: null,
  };
  const intentId = "00000000-0000-4000-8000-000000000102";
  const repository = {
    reserveRawUpload: async () => { events.push("reserve"); return intentId; },
    markRawUploadVerified: async () => { events.push("record-verified"); return true; },
    failRawUploads: async (_task: FencedTask, phase: string, code: string) => {
      events.push(`fail:${phase}:${code}`);
      return true;
    },
  } as unknown as AudienceRepository;
  const storage = {
    plan: () => { events.push("plan"); return plan; },
    put: overrides.put ?? (async () => { events.push("put"); return stored; }),
    verify: async () => { events.push("verify"); return verified; },
  };
  return { task, stored, intentId, repository, storage };
}
