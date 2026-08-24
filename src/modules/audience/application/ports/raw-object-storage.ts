import type { CandidateEvidence, ChecksummedBrowserRawBundle } from "../../domain/discovery";

export interface StoredRawObject {
  runId: string;
  sourceKind: string;
  sourceRecordKey: string;
  parserVersion: string;
  checksumSha256: string;
  prefix: string;
  manifestKey: string;
  domKey: string;
  screenshotKey: string;
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
  put(bundle: ChecksummedBrowserRawBundle): Promise<StoredRawObject>;
  verify(object: StoredRawObject): Promise<VerifiedRawObject>;
}
