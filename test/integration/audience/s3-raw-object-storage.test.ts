import { randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppEnv } from "../../../src/shared/config/env";
import type { BrowserRawBundle } from "../../../src/modules/audience/domain/discovery";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";

describe("S3RawObjectStorage", () => {
  const bucket = `okved-raw-test-${randomUUID()}`;
  const env: AppEnv = {
    appMode: "fixture",
    databaseUrl: "postgresql://unused",
    s3Endpoint: "http://127.0.0.1:9000",
    s3Bucket: bucket,
    s3AccessKeyId: "okved-local",
    s3SecretAccessKey: "okved-local-secret",
    listOrgLiveEnabled: false,
  };
  const client = new S3Client({
    endpoint: env.s3Endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
  });

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const objects = (listed.Contents ?? []).flatMap((item) => item.Key === undefined ? [] : [{ Key: item.Key }]);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  });

  it("writes a checksummed bundle once and treats identical conditional retries as success", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser");
    const bundle = sampleBundle("s3-idempotent");

    const first = await storage.put(bundle);
    const second = await storage.put(bundle);

    expect(second).toEqual(first);
    expect(first.prefix).toBe(
      `raw/s3-idempotent/list-org-browser/${bundle.checksumSha256}`,
    );
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${first.prefix}/`,
    }));
    expect(listed.Contents?.map((item) => item.Key).sort()).toEqual([
      first.domKey,
      first.manifestKey,
      first.screenshotKey,
    ].sort());

    const manifestResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: first.manifestKey,
    }));
    const manifest = JSON.parse(await manifestResponse.Body!.transformToString()) as {
      artifacts: { sanitizedDom: { checksumSha256: string } };
    };
    expect(manifest.artifacts.sanitizedDom.checksumSha256).toBe(
      bundle.artifacts.sanitizedDomSha256,
    );
  });

  it("fails an immutable-key collision when existing bytes differ", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser");
    const bundle = sampleBundle("s3-collision");
    const manifestKey = [
      "raw",
      bundle.identity.runId,
      "list-org-browser",
      bundle.checksumSha256,
      "manifest.json",
    ].join("/");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: "corrupt existing bytes",
      ContentType: "application/json",
    }));

    await expect(storage.put(bundle)).rejects.toThrow(`immutable object collision at ${manifestKey}`);
  });
});

function sampleBundle(runId: string) {
  const raw: BrowserRawBundle = {
    finalUrl: "http://127.0.0.1:33333/results/page-1",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><main>safe evidence</main>"),
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: "a".repeat(64),
    identity: { runId, page: 1 },
    actions: [
      {
        at: "2026-08-24T09:00:00.000Z",
        kind: "navigate",
        target: "/results/page-1",
        outcome: "completed",
      },
    ],
  };
  return checksumBrowserRawBundle(raw);
}
