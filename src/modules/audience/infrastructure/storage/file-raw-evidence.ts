import { sha256 } from "./raw-bundle";

export const FILE_RAW_MANIFEST_VERSION = 1;

export interface FileRawEvidence {
  sourceKind: string;
  parserVersion: string;
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  identity: {
    runId: string;
    sourceRecordKey: string;
  };
  mimeType: string;
  data: Uint8Array;
}

export interface ChecksummedFileRawEvidence extends FileRawEvidence {
  dataChecksumSha256: string;
  checksumSha256: string;
  manifestUtf8: Uint8Array;
}

export function checksumFileRawEvidence(
  evidence: FileRawEvidence,
): ChecksummedFileRawEvidence {
  validateFileRawEvidence(evidence);
  const dataChecksumSha256 = sha256(evidence.data);
  const manifest = {
    version: FILE_RAW_MANIFEST_VERSION,
    sourceKind: evidence.sourceKind,
    parserVersion: evidence.parserVersion,
    finalUrl: evidence.finalUrl,
    capturedAt: evidence.capturedAt,
    navigationStatus: evidence.navigationStatus,
    identity: {
      runId: evidence.identity.runId,
      sourceRecordKey: evidence.identity.sourceRecordKey,
    },
    artifact: {
      file: "data",
      mimeType: evidence.mimeType,
      byteLength: evidence.data.byteLength,
      checksumSha256: dataChecksumSha256,
    },
  };
  const manifestUtf8 = new TextEncoder().encode(JSON.stringify(manifest));
  return {
    ...evidence,
    dataChecksumSha256,
    checksumSha256: sha256(manifestUtf8),
    manifestUtf8,
  };
}

export function isCanonicalFileMimeType(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[ \t]*[a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"\u0000-\u001f\u007f]*"))*$/i.test(value);
}

export function isCanonicalFileCaptureTime(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isSafeFileRetainedText(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() !== ""
    && !/[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(value);
}

function validateFileRawEvidence(evidence: FileRawEvidence): void {
  if (!/^[a-z0-9-]+$/.test(evidence.sourceKind)) {
    throw new Error("source kind must be safe for an object key");
  }
  if (!hasExactlyKeys(evidence.identity, ["runId", "sourceRecordKey"])) {
    throw new Error("file raw evidence is invalid");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(evidence.identity.runId)) {
    throw new Error("run id must be safe for an object key");
  }
  if (!isSafeFileRetainedText(evidence.identity.sourceRecordKey)
    || !isSafeFileRetainedText(evidence.parserVersion)
    || !isSafeFileRetainedText(evidence.finalUrl)
    || !isCanonicalFileCaptureTime(evidence.capturedAt)
    || !isNavigationStatus(evidence.navigationStatus)
    || !isCanonicalFileMimeType(evidence.mimeType)
    || !(evidence.data instanceof Uint8Array)
    || evidence.data.byteLength <= 0) {
    throw new Error("file raw evidence is invalid");
  }
}

function hasExactlyKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isNavigationStatus(value: unknown): value is number | null {
  return value === null
    || (Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599);
}
