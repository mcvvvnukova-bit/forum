import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { RawObjectStorage, StoredRawObject } from "../../application/ports/raw-object-storage";
import type { ChecksummedBrowserRawBundle } from "../../domain/discovery";
import type { AppEnv } from "../../../../shared/config/env";
import { checksumBrowserRawBundle, sha256 } from "./raw-bundle";

export class S3RawObjectStorage implements RawObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #sourceKind: string;

  constructor(env: AppEnv, sourceKind: string, client?: S3Client) {
    if (!/^[a-z0-9-]+$/.test(sourceKind)) {
      throw new Error("source kind must be safe for an object key");
    }
    this.#bucket = env.s3Bucket;
    this.#sourceKind = sourceKind;
    this.#client = client ?? new S3Client(clientConfig(env));
  }

  async put(bundle: ChecksummedBrowserRawBundle): Promise<StoredRawObject> {
    validateBundle(bundle);
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
      checksumSha256: bundle.checksumSha256,
      prefix,
      manifestKey,
      domKey,
      screenshotKey,
    };
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
    parserVersion: bundle.parserVersion,
    finalUrl: bundle.finalUrl,
    capturedAt: bundle.capturedAt,
    navigationStatus: bundle.navigationStatus,
    sanitizedDomUtf8: bundle.sanitizedDomUtf8,
    redactedScreenshotPng: bundle.redactedScreenshotPng,
    pageFingerprintSha256: bundle.pageFingerprintSha256,
    identity: bundle.identity,
    actions: bundle.actions,
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
