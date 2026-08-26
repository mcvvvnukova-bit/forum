import { isDeepStrictEqual } from "node:util";

import type {
  AudienceRepository,
  FencedTask,
} from "./ports/audience-repository";
import {
  RawUploadStorageError,
  type RawUploadFailurePhase,
  type RawUploadPlan,
  type StoredRawObject,
  type VerifiedRawObject,
} from "./ports/raw-object-storage";
import { StaleTaskError } from "./stale-task-error";

interface UploadStorage<TInput, TStored extends StoredRawObject> {
  plan(input: TInput): RawUploadPlan<TStored>;
  put(input: TInput): Promise<TStored>;
  verify(object: TStored): Promise<VerifiedRawObject>;
}

interface StageRawUploadInput<TInput, TStored extends StoredRawObject> {
  readonly task: FencedTask;
  readonly input: TInput;
  readonly storage: UploadStorage<TInput, TStored>;
  readonly repository: Pick<
    AudienceRepository,
    "reserveRawUpload" | "markRawUploadVerified" | "failRawUploads"
  >;
}

export async function stageRawUpload<TInput, TStored extends StoredRawObject>(
  input: StageRawUploadInput<TInput, TStored>,
): Promise<{ intentId: string; stored: TStored }> {
  let phase: RawUploadFailurePhase = "storage_write";
  try {
    const plan = input.storage.plan(input.input);
    const intentId = await input.repository.reserveRawUpload(input.task, plan);
    if (intentId === null) throw new StaleTaskError(input.task.id);
    const stored = await input.storage.put(input.input);
    if (!isDeepStrictEqual(stored, plan.stored)) {
      throw new Error("raw upload storage result differs from its reserved plan");
    }
    phase = "verify";
    const verified = await input.storage.verify(stored);
    assertVerifiedIdentity(stored, verified);
    phase = "verification_record";
    if (!await input.repository.markRawUploadVerified(
      input.task,
      intentId,
      plan,
      verified,
    )) {
      throw new StaleTaskError(input.task.id);
    }
    return { intentId, stored };
  } catch (error) {
    const failurePhase = error instanceof RawUploadStorageError ? error.phase : phase;
    await input.repository.failRawUploads(
      input.task,
      failurePhase,
      `raw_upload_${failurePhase}`,
      true,
    );
    throw error;
  }
}

export async function finalizeRawUploads<T>(
  task: FencedTask,
  repository: Pick<AudienceRepository, "failRawUploads">,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await repository.failRawUploads(
      task,
      "before_db_commit",
      "raw_upload_before_db_commit",
      true,
    );
    throw error;
  }
}

function assertVerifiedIdentity(stored: StoredRawObject, verified: VerifiedRawObject): void {
  if (verified.runId !== stored.runId
    || verified.sourceKind !== stored.sourceKind
    || verified.sourceRecordKey !== stored.sourceRecordKey
    || verified.parserVersion !== stored.parserVersion
    || verified.checksumSha256 !== stored.checksumSha256) {
    throw new Error("raw upload verification identity mismatch");
  }
}
