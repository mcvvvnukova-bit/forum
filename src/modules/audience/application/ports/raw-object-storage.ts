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

export interface VerifiedRawObject {
  runId: string;
  sourceKind: string;
  sourceRecordKey: string;
  checksumSha256: string;
  parserVersion: string;
  candidateEvidence: CandidateEvidence | null;
}

export interface RawObjectStorage {
  put(bundle: ChecksummedBrowserRawBundle): Promise<StoredBrowserRawObject>;
  put(bundle: ChecksummedProjectionRawBundle): Promise<StoredProjectionRawObject>;
  put(
    bundle: ChecksummedBrowserRawBundle | ChecksummedProjectionRawBundle,
  ): Promise<StoredBrowserRawObject | StoredProjectionRawObject>;
  verify(object: StoredRawObject): Promise<VerifiedRawObject>;
}
