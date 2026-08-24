import type { CandidateEvidence, ChecksummedBrowserRawBundle } from "../../domain/discovery";

export interface StoredRawObject {
  checksumSha256: string;
  prefix: string;
  manifestKey: string;
  domKey: string;
  screenshotKey: string;
}

export interface VerifiedRawObject {
  checksumSha256: string;
  parserVersion: string;
  candidateEvidence: CandidateEvidence | null;
}

export interface RawObjectStorage {
  put(bundle: ChecksummedBrowserRawBundle): Promise<StoredRawObject>;
  verify(object: StoredRawObject): Promise<VerifiedRawObject>;
}
