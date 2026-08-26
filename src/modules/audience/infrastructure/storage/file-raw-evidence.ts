import { sha256 } from "./raw-bundle";

export const FILE_RAW_MANIFEST_VERSION = 1;
export const REVEXP_FILE_RAW_MANIFEST_VERSION = 2;

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

export interface FileRawCaptureProvenance {
  finalUrl: string;
  status: number;
  capturedAt: string;
  contentType: string;
  contentLength: number;
  redirectChain: readonly string[];
}

export interface RevexpRawProvenance {
  datasetId: "7707329152-revexp";
  reportYear: 2025;
  publishedAt: string;
  updatedAt: string;
  structureVersion: string;
  xsdUrl: string;
  metadata: FileRawCaptureProvenance;
  archive: FileRawCaptureProvenance & {
    etag: string | null;
    lastModified: string | null;
  };
}

export interface FilePathRawEvidence extends Omit<FileRawEvidence, "data"> {
  filePath: string;
  byteLength: number;
  dataChecksumSha256: string;
  provenance: RevexpRawProvenance;
}

export interface ChecksummedFilePathRawEvidence extends FilePathRawEvidence {
  checksumSha256: string;
  manifestUtf8: Uint8Array;
}

export type ChecksummedFileEvidence =
  | ChecksummedFileRawEvidence
  | ChecksummedFilePathRawEvidence;

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

/** Builds the immutable revexp manifest from a bounded temporary file without
 * ever materializing the archive as one Uint8Array. */
export function checksumFileRawEvidenceFromPath(
  evidence: FilePathRawEvidence,
): ChecksummedFilePathRawEvidence {
  validateFilePathRawEvidence(evidence);
  const manifest = {
    version: REVEXP_FILE_RAW_MANIFEST_VERSION,
    sourceKind: evidence.sourceKind,
    parserVersion: evidence.parserVersion,
    finalUrl: evidence.finalUrl,
    capturedAt: evidence.capturedAt,
    navigationStatus: evidence.navigationStatus,
    identity: {
      runId: evidence.identity.runId,
      sourceRecordKey: evidence.identity.sourceRecordKey,
    },
    provenance: evidence.provenance,
    artifact: {
      file: "data",
      mimeType: evidence.mimeType,
      byteLength: evidence.byteLength,
      checksumSha256: evidence.dataChecksumSha256,
    },
  };
  const manifestUtf8 = new TextEncoder().encode(JSON.stringify(manifest));
  return {
    ...evidence,
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

function validateFilePathRawEvidence(evidence: FilePathRawEvidence): void {
  validateFileIdentityFields(evidence);
  if (evidence.sourceKind !== "fns-revexp"
    || !isSafeFileRetainedText(evidence.filePath)
    || !Number.isSafeInteger(evidence.byteLength)
    || evidence.byteLength <= 0
    || !/^[0-9a-f]{64}$/u.test(evidence.dataChecksumSha256)
    || !isRevexpRawProvenance(evidence.provenance)
    || evidence.parserVersion !== `fns-revexp/structure-${evidence.provenance.structureVersion}`
    || evidence.finalUrl !== evidence.provenance.archive.finalUrl
    || evidence.capturedAt !== evidence.provenance.archive.capturedAt
    || evidence.navigationStatus !== evidence.provenance.archive.status
    || evidence.mimeType !== evidence.provenance.archive.contentType
    || evidence.byteLength !== evidence.provenance.archive.contentLength) {
    throw new Error("file raw evidence is invalid");
  }
}

function validateFileIdentityFields(evidence: Omit<FileRawEvidence, "data">): void {
  if (!/^[a-z0-9-]+$/u.test(evidence.sourceKind)) {
    throw new Error("source kind must be safe for an object key");
  }
  if (!hasExactlyKeys(evidence.identity, ["runId", "sourceRecordKey"])) {
    throw new Error("file raw evidence is invalid");
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(evidence.identity.runId)) {
    throw new Error("run id must be safe for an object key");
  }
  if (!isSafeFileRetainedText(evidence.identity.sourceRecordKey)
    || !isSafeFileRetainedText(evidence.parserVersion)
    || !isSafeHttpOriginPath(evidence.finalUrl)
    || !isCanonicalFileCaptureTime(evidence.capturedAt)
    || !isNavigationStatus(evidence.navigationStatus)
    || !isCanonicalFileMimeType(evidence.mimeType)) {
    throw new Error("file raw evidence is invalid");
  }
}

export function isRevexpRawProvenance(value: unknown): value is RevexpRawProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || !hasExactlyKeys(value, [
      "datasetId", "reportYear", "publishedAt", "updatedAt", "structureVersion",
      "xsdUrl", "metadata", "archive",
    ])) return false;
  const record = value as Record<string, unknown>;
  return record.datasetId === "7707329152-revexp"
    && record.reportYear === 2025
    && isCanonicalFileCaptureTime(record.publishedAt)
    && isCanonicalFileCaptureTime(record.updatedAt)
    && typeof record.structureVersion === "string"
    && /^[1-9][0-9]*(?:\.[0-9]+)+$/u.test(record.structureVersion)
    && isSafeHttpOriginPath(record.xsdUrl)
    && isCaptureProvenance(record.metadata, false)
    && isCaptureProvenance(record.archive, true);
}

function isCaptureProvenance(value: unknown, archive: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = archive
    ? ["archive", "capturedAt", "contentLength", "contentType", "etag", "finalUrl", "lastModified", "redirectChain", "status"]
    : ["capturedAt", "contentLength", "contentType", "finalUrl", "redirectChain", "status"];
  // The archive marker above is not a persisted field; keep the exact-key list
  // explicit here to make accidental header retention fail closed.
  const exactKeys = archive ? keys.filter((key) => key !== "archive") : keys;
  return hasExactlyKeys(record, exactKeys)
    && isSafeHttpOriginPath(record.finalUrl)
    && Number.isSafeInteger(record.status)
    && Number(record.status) >= 100 && Number(record.status) <= 599
    && isCanonicalFileCaptureTime(record.capturedAt)
    && isCanonicalFileMimeType(record.contentType)
    && Number.isSafeInteger(record.contentLength)
    && Number(record.contentLength) > 0
    && Array.isArray(record.redirectChain)
    && record.redirectChain.length > 0
    && record.redirectChain.every(isSafeHttpOriginPath)
    && record.redirectChain.at(-1) === record.finalUrl
    && (!archive || ((record.etag === null
      || (typeof record.etag === "string" && /^[\x21-\x7e]{1,256}$/u.test(record.etag)))
      && (record.lastModified === null || isCanonicalFileCaptureTime(record.lastModified))));
}

function isSafeHttpOriginPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.hostname !== ""
      && url.username === "" && url.password === ""
      && url.search === "" && url.hash === ""
      && value === `${url.origin}${url.pathname}`;
  } catch {
    return false;
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
