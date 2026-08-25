import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type {
  RawObjectStorage,
  StoredRawObject,
  VerifiedRawObject,
} from "../../application/ports/raw-object-storage";
import type {
  BrowserActionEvent,
  CandidateContactEvidence,
  CandidateEvidence,
  ChecksummedBrowserRawBundle,
} from "../../domain/discovery";
import type { AppEnv } from "../../../../shared/config/env";
import { assertBrowserCaptureSafe } from "../sources/list-org-browser/browser-raw-sanitizer";
import { checksumBrowserRawBundle, RAW_MANIFEST_VERSION, sha256 } from "./raw-bundle";

export class S3RawObjectStorage implements RawObjectStorage {
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

  async put(bundle: ChecksummedBrowserRawBundle): Promise<StoredRawObject> {
    this.#assertOpen();
    validateBundle(bundle);
    if (bundle.sourceKind !== this.#sourceKind) {
      throw new Error("raw bundle source identity does not match storage");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(bundle.identity.runId)) {
      throw new Error("run id must be safe for an object key");
    }

    const prefix = [
      "raw",
      bundle.identity.runId,
      this.#sourceKind,
      bundle.checksumSha256,
    ].join("/");
    const manifestKey = `${prefix}/manifest.json`;
    const domKey = `${prefix}/dom.html`;
    const screenshotKey = `${prefix}/screenshot.png`;

    await this.#putImmutable(domKey, bundle.sanitizedDomUtf8, "text/html; charset=utf-8");
    await this.#putImmutable(screenshotKey, bundle.redactedScreenshotPng, "image/png");
    await this.#putImmutable(manifestKey, bundle.manifestUtf8, "application/json; charset=utf-8");

    return {
      runId: bundle.identity.runId,
      sourceKind: bundle.sourceKind,
      sourceRecordKey: bundle.identity.sourceRecordKey ?? `page:${bundle.identity.page}`,
      parserVersion: bundle.parserVersion,
      checksumSha256: bundle.checksumSha256,
      prefix,
      manifestKey,
      domKey,
      screenshotKey,
    };
  }

  async verify(object: StoredRawObject): Promise<VerifiedRawObject> {
    this.#assertOpen();
    validateStoredObject(object);
    if (object.sourceKind !== this.#sourceKind) {
      throw new Error("raw object identity verification failed");
    }
    const [manifestBytes, domBytes, screenshotBytes] = await Promise.all([
      this.#get(object.manifestKey),
      this.#get(object.domKey),
      this.#get(object.screenshotKey),
    ]);

    const manifest = parseRawManifest(manifestBytes);

    if (
      manifest === null
      || sha256(manifestBytes) !== object.checksumSha256
      || manifest.artifacts.sanitizedDom.file !== "dom.html"
      || manifest.artifacts.redactedScreenshot.file !== "screenshot.png"
      || sha256(domBytes) !== manifest.artifacts.sanitizedDom.checksumSha256
      || sha256(screenshotBytes) !== manifest.artifacts.redactedScreenshot.checksumSha256
    ) {
      throw new Error("raw object checksum verification failed");
    }
    const manifestRecordKey = manifest.identity.sourceRecordKey
      ?? `page:${manifest.identity.page}`;
    if (manifest.identity.runId !== object.runId
      || manifest.sourceKind !== object.sourceKind
      || manifestRecordKey !== object.sourceRecordKey
      || manifest.parserVersion !== object.parserVersion
      || (manifest.candidateEvidence !== null
        && manifest.candidateEvidence.sourceRecordKey !== manifestRecordKey)) {
      throw new Error("raw object identity verification failed");
    }
    if (manifest.sourceKind === "list-org-browser") {
      assertBrowserCaptureSafe({
        sourceKind: manifest.sourceKind,
        finalUrl: manifest.finalUrl,
        sanitizedDomUtf8: domBytes,
        candidateEvidence: manifest.candidateEvidence,
        actions: manifest.actions,
        sensitiveFormFieldNames: manifest.sensitiveFormFieldNames,
      });
    }
    return {
      runId: manifest.identity.runId,
      sourceKind: manifest.sourceKind,
      sourceRecordKey: manifestRecordKey,
      checksumSha256: object.checksumSha256,
      parserVersion: manifest.parserVersion,
      candidateEvidence: manifest.candidateEvidence,
    };
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

  close(): void {
    if (!this.#closed && this.#ownsClient) this.#client.destroy();
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("raw object storage is closed");
  }
}

interface RawManifest {
  sourceKind: string;
  parserVersion: string;
  sensitiveFormFieldNames: readonly string[];
  finalUrl: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  candidateEvidence: CandidateEvidence | null;
  actions: readonly BrowserActionEvent[];
  artifacts: {
    sanitizedDom: { file: string; checksumSha256: string };
    redactedScreenshot: { file: string; checksumSha256: string };
  };
}

function parseRawManifest(bytes: Uint8Array): RawManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  // Version 1 did not require a persisted browser form-policy. Its screenshots
  // therefore cannot be re-verified fail-closed and are deliberately quarantined.
  if (value.version === 1 && value.sourceKind === "list-org-browser") {
    throw new Error("raw manifest version 1 is unsupported for browser evidence");
  }
  const isLegacyNonBrowser = value.version === 1;
  if ((!isLegacyNonBrowser && value.version !== RAW_MANIFEST_VERSION)
    || typeof value.sourceKind !== "string"
    || typeof value.parserVersion !== "string"
    || (!isLegacyNonBrowser && !isStringArray(value.sensitiveFormFieldNames))
    || (isLegacyNonBrowser
      && value.sensitiveFormFieldNames !== undefined
      && !isStringArray(value.sensitiveFormFieldNames))
    || typeof value.finalUrl !== "string"
    || !isRawIdentity(value.identity)
    || !isCandidateEvidenceOrNull(value.candidateEvidence)
    || !Array.isArray(value.actions)
    || !value.actions.every(isBrowserActionEvent)
    || !isRecord(value.artifacts)
    || !isArtifact(value.artifacts.sanitizedDom)
    || !isArtifact(value.artifacts.redactedScreenshot)) {
    return null;
  }
  return {
    sourceKind: value.sourceKind,
    parserVersion: value.parserVersion,
    sensitiveFormFieldNames: isStringArray(value.sensitiveFormFieldNames)
      ? value.sensitiveFormFieldNames
      : [],
    finalUrl: value.finalUrl,
    identity: value.identity,
    candidateEvidence: value.candidateEvidence,
    actions: value.actions,
    artifacts: {
      sanitizedDom: value.artifacts.sanitizedDom,
      redactedScreenshot: value.artifacts.redactedScreenshot,
    },
  };
}

function isBrowserActionEvent(value: unknown): value is BrowserActionEvent {
  return isRecord(value)
    && hasExactlyKeys(value, [
      "id", "at", "kind", "target", "outcome", "navigationStatus",
    ])
    && typeof value.id === "string"
    && typeof value.at === "string"
    && typeof value.kind === "string"
    && typeof value.target === "string"
    && ["intent", "completed", "contract-drift", "failed"].includes(String(value.outcome))
    && (value.navigationStatus === null
      || (Number.isSafeInteger(value.navigationStatus)
        && Number(value.navigationStatus) >= 100
        && Number(value.navigationStatus) <= 599));
}

function isRawIdentity(
  value: unknown,
): value is { runId: string; page: number; sourceRecordKey?: string } {
  if (!isRecord(value)
    || typeof value.runId !== "string"
    || !Number.isSafeInteger(value.page)
    || (value.sourceRecordKey !== undefined && typeof value.sourceRecordKey !== "string")) {
    return false;
  }
  return hasExactlyKeys(
    value,
    value.sourceRecordKey === undefined ? ["runId", "page"] : ["runId", "page", "sourceRecordKey"],
  );
}

function isCandidateEvidenceOrNull(value: unknown): value is CandidateEvidence | null {
  if (value === null) return true;
  return isRecord(value)
    && hasExactlyKeys(value, [
      "sourceRecordKey", "inn", "name", "website", "okvedCode", "isPrimary", "phone", "email",
    ])
    && typeof value.sourceRecordKey === "string"
    && typeof value.inn === "string"
    && typeof value.name === "string"
    && (typeof value.website === "string" || value.website === null)
    && typeof value.okvedCode === "string"
    && typeof value.isPrimary === "boolean"
    && isContactEvidence(value.phone)
    && isContactEvidence(value.email);
}

function isContactEvidence(value: unknown): value is CandidateContactEvidence {
  if (!isRecord(value) || (value.kind !== "null" && value.kind !== "sha256")) return false;
  if (value.kind === "null") return hasExactlyKeys(value, ["kind"]);
  return hasExactlyKeys(value, ["kind", "normalizedValueSha256"])
    && typeof value.normalizedValueSha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.normalizedValueSha256);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isArtifact(value: unknown): value is { file: string; checksumSha256: string } {
  return isRecord(value)
    && typeof value.file === "string"
    && typeof value.checksumSha256 === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

function validateBundle(bundle: ChecksummedBrowserRawBundle): void {
  const recalculated = checksumBrowserRawBundle({
    sourceKind: bundle.sourceKind,
    parserVersion: bundle.parserVersion,
    finalUrl: bundle.finalUrl,
    capturedAt: bundle.capturedAt,
    navigationStatus: bundle.navigationStatus,
    sanitizedDomUtf8: bundle.sanitizedDomUtf8,
    redactedScreenshotPng: bundle.redactedScreenshotPng,
    pageFingerprintSha256: bundle.pageFingerprintSha256,
    identity: bundle.identity,
    candidateEvidence: bundle.candidateEvidence,
    actions: bundle.actions,
    sensitiveFormFieldNames: bundle.sensitiveFormFieldNames,
  });
  if (
    bundle.checksumSha256 !== recalculated.checksumSha256
    || bundle.artifacts.sanitizedDomSha256 !== recalculated.artifacts.sanitizedDomSha256
    || bundle.artifacts.redactedScreenshotSha256 !== recalculated.artifacts.redactedScreenshotSha256
    || bundle.artifacts.manifestSha256 !== recalculated.artifacts.manifestSha256
    || !bytesEqual(bundle.manifestUtf8, recalculated.manifestUtf8)
  ) {
    throw new Error("raw bundle checksum validation failed");
  }
}

function validateStoredObject(object: StoredRawObject): void {
  const expectedPrefix = [
    "raw",
    object.runId,
    object.sourceKind,
    object.checksumSha256,
  ].join("/");
  if (
    !/^[A-Za-z0-9._-]+$/.test(object.runId)
    || !/^[a-z0-9-]+$/.test(object.sourceKind)
    || object.sourceRecordKey.trim() === ""
    || object.parserVersion.trim() === ""
    || !/^[0-9a-f]{64}$/.test(object.checksumSha256)
    || expectedPrefix !== object.prefix
    || object.manifestKey !== `${object.prefix}/manifest.json`
    || object.domKey !== `${object.prefix}/dom.html`
    || object.screenshotKey !== `${object.prefix}/screenshot.png`
  ) {
    throw new Error("raw object identity verification failed");
  }
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
