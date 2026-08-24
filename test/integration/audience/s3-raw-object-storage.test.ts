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
      candidateEvidence: unknown;
    };
    expect(manifest.artifacts.sanitizedDom.checksumSha256).toBe(
      bundle.artifacts.sanitizedDomSha256,
    );
    expect(manifest.candidateEvidence).toEqual(bundle.candidateEvidence);
    expect(JSON.stringify(manifest)).not.toMatch(/\+7 \(495\) 111-22-33|info@alpha\.example/i);
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

  it("does not publish the manifest commit marker when an artifact write fails", async () => {
    const faultClient = new S3Client({
      endpoint: env.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
    faultClient.middlewareStack.add(
      (next) => async (args) => {
        const input = args.input as { Key?: string };
        if (input.Key?.endsWith("/screenshot.png") === true) {
          throw new Error("injected screenshot artifact failure");
        }
        return next(args);
      },
      { step: "initialize", name: "injectScreenshotArtifactFailure" },
    );
    const bundle = sampleBundle("s3-artifact-failure");
    const prefix = `raw/${bundle.identity.runId}/list-org-browser/${bundle.checksumSha256}`;

    try {
      const storage = new S3RawObjectStorage(env, "list-org-browser", faultClient);
      await expect(storage.put(bundle)).rejects.toThrow("injected screenshot artifact failure");

      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/` }));
      expect(listed.Contents?.map((item) => item.Key)).toEqual([`${prefix}/dom.html`]);
    } finally {
      faultClient.destroy();
    }
  });

  it("rejects replay verification when a referenced raw artifact no longer matches its manifest", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser");
    const stored = await storage.put(sampleBundle("s3-verified-read"));

    await expect(storage.verify(stored)).resolves.toMatchObject({
      checksumSha256: stored.checksumSha256,
      parserVersion: "list-org-browser/1.0.0",
      candidateEvidence: sampleBundle("ignored").candidateEvidence,
    });

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: stored.domKey,
      Body: "corrupted after capture",
      ContentType: "text/html; charset=utf-8",
    }));

    await expect(storage.verify(stored)).rejects.toThrow("raw object checksum verification failed");
  });
});

function sampleBundle(runId: string) {
  const raw: BrowserRawBundle = {
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "http://127.0.0.1:33333/results/page-1",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><main>safe evidence</main>"),
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: "a".repeat(64),
    identity: { runId, page: 1 },
    candidateEvidence: {
      sourceRecordKey: "1001",
      inn: "7707083893",
      name: "АО Альфа",
      website: "https://alpha.example",
      okvedCode: "43.11",
      isPrimary: true,
      phone: { kind: "sha256", normalizedValueSha256: "b".repeat(64) },
      email: { kind: "sha256", normalizedValueSha256: "c".repeat(64) },
    },
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
