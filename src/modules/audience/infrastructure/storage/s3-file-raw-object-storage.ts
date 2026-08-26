import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type {
  StoredFileRawObject,
  StoredRawObject,
  VerifiedRawObject,
} from "../../application/ports/raw-object-storage";
import type { AppEnv } from "../../../../shared/config/env";
import {
  checksumFileRawEvidence,
  FILE_RAW_MANIFEST_VERSION,
  isCanonicalFileCaptureTime,
  isCanonicalFileMimeType,
  isSafeFileRetainedText,
  type ChecksummedFileRawEvidence,
} from "./file-raw-evidence";
import { sha256 } from "./raw-bundle";

export class S3FileRawObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #sourceKind: string;
  readonly #ownsClient: boolean;
  #closed = false;

  constructor(env: AppEnv, sourceKind: string, client?: S3Client) {
    if (!/^[a-z0-9-]+$/.test(sourceKind)) {
      throw new Error("source kind must be safe for an object key");
    }
    this.#bucket = env.s3Bucket;
    this.#sourceKind = sourceKind;
    this.#client = client ?? new S3Client(clientConfig(env));
    this.#ownsClient = client === undefined;
  }

  async put(evidence: ChecksummedFileRawEvidence): Promise<StoredFileRawObject> {
    this.#assertOpen();
    validateChecksummedEvidence(evidence);
    if (evidence.sourceKind !== this.#sourceKind) {
      throw new Error("raw bundle source identity does not match storage");
    }
    const prefix = [
      "raw",
      evidence.identity.runId,
      evidence.sourceKind,
      evidence.checksumSha256,
    ].join("/");
    const dataKey = `${prefix}/data`;
    const manifestKey = `${prefix}/manifest.json`;

    await this.#putImmutable(dataKey, evidence.data, evidence.mimeType);
    await this.#putImmutable(
      manifestKey,
      evidence.manifestUtf8,
      "application/json; charset=utf-8",
    );

    return {
      kind: "file",
      runId: evidence.identity.runId,
      sourceKind: evidence.sourceKind,
      sourceRecordKey: evidence.identity.sourceRecordKey,
      parserVersion: evidence.parserVersion,
      checksumSha256: evidence.checksumSha256,
      prefix,
      manifestKey,
      dataKey,
      mimeType: evidence.mimeType,
      byteLength: evidence.data.byteLength,
    };
  }

  async verify(object: StoredRawObject): Promise<VerifiedRawObject> {
    this.#assertOpen();
    if (object.kind !== "file") {
      throw new Error("raw object artifact kind is invalid");
    }
    validateStoredFileObject(object);
    if (object.sourceKind !== this.#sourceKind) {
      throw new Error("raw object identity verification failed");
    }
    const [manifestBytes, dataBytes] = await Promise.all([
      this.#get(object.manifestKey),
      this.#get(object.dataKey),
    ]);
    const manifest = parseFileManifest(manifestBytes);
    if (manifest === null
      || sha256(manifestBytes) !== object.checksumSha256
      || manifest.artifact.file !== "data"
      || manifest.artifact.byteLength !== dataBytes.byteLength
      || manifest.artifact.checksumSha256 !== sha256(dataBytes)) {
      throw new Error("raw object checksum verification failed");
    }
    if (manifest.identity.runId !== object.runId
      || manifest.sourceKind !== object.sourceKind
      || manifest.identity.sourceRecordKey !== object.sourceRecordKey
      || manifest.parserVersion !== object.parserVersion
      || manifest.artifact.mimeType !== object.mimeType
      || manifest.artifact.byteLength !== object.byteLength) {
      throw new Error("raw object identity verification failed");
    }
    return {
      runId: manifest.identity.runId,
      sourceKind: manifest.sourceKind,
      sourceRecordKey: manifest.identity.sourceRecordKey,
      checksumSha256: object.checksumSha256,
      parserVersion: manifest.parserVersion,
      candidateEvidence: null,
    };
  }

  close(): void {
    if (!this.#closed && this.#ownsClient) this.#client.destroy();
    this.#closed = true;
  }

  async #get(key: string): Promise<Uint8Array> {
    const response = await this.#client.send(new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key,
    }));
    const bytes = await response.Body?.transformToByteArray();
    if (bytes === undefined) throw new Error("raw object checksum verification failed");
    return bytes;
  }

  async #putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.#client.send(new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        IfNoneMatch: "*",
        Metadata: { "checksum-sha256": sha256(bytes) },
      }));
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
      const existing = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: key,
      }));
      const existingBytes = await existing.Body?.transformToByteArray();
      if (existingBytes === undefined || !bytesEqual(existingBytes, bytes)) {
        throw new Error(`immutable object collision at ${key}`);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("raw object storage is closed");
  }
}

interface FileManifest {
  version: number;
  sourceKind: string;
  parserVersion: string;
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  identity: { runId: string; sourceRecordKey: string };
  artifact: {
    file: string;
    mimeType: string;
    byteLength: number;
    checksumSha256: string;
  };
}

function parseFileManifest(bytes: Uint8Array): FileManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(value)
    || !hasExactlyKeys(value, [
      "version", "sourceKind", "parserVersion", "finalUrl", "capturedAt",
      "navigationStatus", "identity", "artifact",
    ])
    || value.version !== FILE_RAW_MANIFEST_VERSION
    || typeof value.sourceKind !== "string"
    || !/^[a-z0-9-]+$/.test(value.sourceKind)
    || !isSafeFileRetainedText(value.parserVersion)
    || !isSafeFileRetainedText(value.finalUrl)
    || !isCanonicalFileCaptureTime(value.capturedAt)
    || !isNavigationStatus(value.navigationStatus)
    || !isFileIdentity(value.identity)
    || !isFileArtifact(value.artifact)) {
    return null;
  }
  return {
    version: value.version,
    sourceKind: value.sourceKind,
    parserVersion: value.parserVersion,
    finalUrl: value.finalUrl,
    capturedAt: value.capturedAt,
    navigationStatus: value.navigationStatus,
    identity: value.identity,
    artifact: value.artifact,
  };
}

function validateChecksummedEvidence(evidence: ChecksummedFileRawEvidence): void {
  const recalculated = checksumFileRawEvidence({
    sourceKind: evidence.sourceKind,
    parserVersion: evidence.parserVersion,
    finalUrl: evidence.finalUrl,
    capturedAt: evidence.capturedAt,
    navigationStatus: evidence.navigationStatus,
    identity: evidence.identity,
    mimeType: evidence.mimeType,
    data: evidence.data,
  });
  if (evidence.dataChecksumSha256 !== recalculated.dataChecksumSha256
    || evidence.checksumSha256 !== recalculated.checksumSha256
    || !bytesEqual(evidence.manifestUtf8, recalculated.manifestUtf8)) {
    throw new Error("raw bundle checksum validation failed");
  }
}

function validateStoredFileObject(object: StoredFileRawObject): void {
  const expectedPrefix = [
    "raw",
    object.runId,
    object.sourceKind,
    object.checksumSha256,
  ].join("/");
  if (!hasExactlyKeys(object, [
    "kind", "runId", "sourceKind", "sourceRecordKey", "parserVersion",
    "checksumSha256", "prefix", "manifestKey", "dataKey", "mimeType", "byteLength",
  ])
    || !/^[A-Za-z0-9._-]+$/.test(object.runId)
    || !/^[a-z0-9-]+$/.test(object.sourceKind)
    || !isSafeFileRetainedText(object.sourceRecordKey)
    || !isSafeFileRetainedText(object.parserVersion)
    || !/^[0-9a-f]{64}$/.test(object.checksumSha256)
    || expectedPrefix !== object.prefix
    || object.manifestKey !== `${object.prefix}/manifest.json`
    || object.dataKey !== `${object.prefix}/data`
    || !isCanonicalFileMimeType(object.mimeType)
    || !Number.isSafeInteger(object.byteLength)
    || object.byteLength <= 0) {
    throw new Error("raw object identity verification failed");
  }
}

function isFileIdentity(value: unknown): value is FileManifest["identity"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["runId", "sourceRecordKey"])
    && typeof value.runId === "string"
    && /^[A-Za-z0-9._-]+$/.test(value.runId)
    && isSafeFileRetainedText(value.sourceRecordKey);
}

function isFileArtifact(value: unknown): value is FileManifest["artifact"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["file", "mimeType", "byteLength", "checksumSha256"])
    && value.file === "data"
    && isCanonicalFileMimeType(value.mimeType)
    && Number.isSafeInteger(value.byteLength)
    && Number(value.byteLength) > 0
    && typeof value.checksumSha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.checksumSha256);
}

function isNavigationStatus(value: unknown): value is number | null {
  return value === null
    || (Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isPreconditionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function clientConfig(env: AppEnv): S3ClientConfig {
  return {
    endpoint: env.s3Endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
  };
}
