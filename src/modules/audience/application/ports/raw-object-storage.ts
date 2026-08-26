import type { CandidateEvidence, ChecksummedBrowserRawBundle } from "../../domain/discovery";

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

export type StoredFileRawObject = StoredRawObjectIdentity & {
  kind: "file";
  dataKey: string;
  mimeType: string;
  byteLength: number;
};

export type StoredRawObject = StoredBrowserRawObject | StoredFileRawObject;

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
  verify(object: StoredRawObject): Promise<VerifiedRawObject>;
}
