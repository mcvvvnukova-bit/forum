import { createHash } from "node:crypto";

import type {
  CandidateEvidence,
  ChecksummedBrowserRawBundle,
  ChecksummedProjectionRawBundle,
} from "../../domain/discovery";

export interface StoredRawObjectIdentity {
  runId: string;
  sourceKind: string;
  sourceRecordKey: string;
  parserVersion: string;
  checksumSha256: string;
  prefix: string;
  manifestKey: string;
}

export type StoredBrowserRawObject = StoredRawObjectIdentity & {
  kind: "browser";
  domKey: string;
  screenshotKey: string;
};

export type StoredProjectionRawObject = StoredRawObjectIdentity & {
  kind: "projection";
  projectionKey: string;
};

export type StoredFileRawObject = StoredRawObjectIdentity & {
  kind: "file";
  dataKey: string;
  mimeType: string;
  byteLength: number;
};

export type StoredRawObject = StoredBrowserRawObject | StoredProjectionRawObject | StoredFileRawObject;

export interface RawUploadObjectDigest {
  readonly key: string;
  readonly checksumSha256: string;
}

export interface RawUploadPlan<TStored extends StoredRawObject = StoredRawObject> {
  readonly stored: TStored;
  readonly objects: readonly RawUploadObjectDigest[];
  readonly planChecksumSha256: string;
}

export type RawUploadFailurePhase =
  | "storage_write"
  | "after_data_write"
  | "after_manifest_write"
  | "verify"
  | "verification_record"
  | "before_db_commit";

export interface RawUploadStorageFaults {
  readonly afterDataWrite?: () => void | Promise<void>;
  readonly afterManifestWrite?: () => void | Promise<void>;
}

export class RawUploadStorageError extends Error {
  override readonly name = "RawUploadStorageError";

  constructor(readonly phase: "after_data_write" | "after_manifest_write", options?: ErrorOptions) {
    super(`raw upload storage failed at ${phase}`, options);
  }
}

export function createRawUploadPlan<TStored extends StoredRawObject>(
  stored: TStored,
  objects: readonly RawUploadObjectDigest[],
): RawUploadPlan<TStored> {
  if (objects.length === 0
    || new Set(objects.map((object) => object.key)).size !== objects.length
    || objects.some((object) => object.key.trim() === ""
      || !/^[0-9a-f]{64}$/u.test(object.checksumSha256)
      || !object.key.startsWith(`${stored.prefix}/`))
    || !objects.some((object) => object.key === stored.manifestKey
      && object.checksumSha256 === stored.checksumSha256)) {
    throw new Error("raw upload plan is invalid");
  }
  const planDocument = { stored, objects };
  return Object.freeze({
    ...planDocument,
    planChecksumSha256: createHash("sha256")
      .update(JSON.stringify(planDocument))
      .digest("hex"),
  });
}

export interface VerifiedRawObject {
  runId: string;
  sourceKind: string;
  sourceRecordKey: string;
  checksumSha256: string;
  parserVersion: string;
  candidateEvidence: CandidateEvidence | null;
}

export interface RawObjectStorage {
  plan(bundle: ChecksummedBrowserRawBundle): RawUploadPlan<StoredBrowserRawObject>;
  plan(bundle: ChecksummedProjectionRawBundle): RawUploadPlan<StoredProjectionRawObject>;
  plan(
    bundle: ChecksummedBrowserRawBundle | ChecksummedProjectionRawBundle,
  ): RawUploadPlan<StoredBrowserRawObject | StoredProjectionRawObject>;
  put(bundle: ChecksummedBrowserRawBundle): Promise<StoredBrowserRawObject>;
  put(bundle: ChecksummedProjectionRawBundle): Promise<StoredProjectionRawObject>;
  put(
    bundle: ChecksummedBrowserRawBundle | ChecksummedProjectionRawBundle,
  ): Promise<StoredBrowserRawObject | StoredProjectionRawObject>;
  verify(object: StoredRawObject): Promise<VerifiedRawObject>;
}
