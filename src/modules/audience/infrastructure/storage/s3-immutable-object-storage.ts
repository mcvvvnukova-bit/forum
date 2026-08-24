import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { ImmutableObjectStorage } from "../../application/release-selected-okveds";
import type { AppEnv } from "../../../../shared/config/env";
import { sha256 } from "./raw-bundle";

export class S3ImmutableObjectStorage implements ImmutableObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #ownsClient: boolean;
  #closed = false;

  constructor(env: AppEnv, client?: S3Client) {
    this.#bucket = env.s3Bucket;
    this.#client = client ?? new S3Client(clientConfig(env));
    this.#ownsClient = client === undefined;
  }

  async putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.#closed) throw new Error("immutable object storage is closed");
    const keyMatch = /^raw\/okved-csv\/([0-9a-f]{64})\/selected-okveds\.csv$/.exec(key);
    if (keyMatch === null) {
      throw new Error("selected OKVED object key is not checksum-addressed");
    }
    if (keyMatch[1] !== sha256(bytes)) {
      throw new Error("selected OKVED object key checksum does not match bytes");
    }
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

  async ensureBucket(): Promise<void> {
    if (this.#closed) throw new Error("immutable object storage is closed");
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
    } catch {
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    }
  }

  close(): void {
    if (!this.#closed && this.#ownsClient) this.#client.destroy();
    this.#closed = true;
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
