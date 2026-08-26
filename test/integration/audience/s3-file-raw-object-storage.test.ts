import { createHash, randomUUID } from "node:crypto";

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

import type {
  StoredFileRawObject,
  StoredRawObject,
} from "../../../src/modules/audience/application/ports/raw-object-storage";
import type { AppEnv } from "../../../src/shared/config/env";
import {
  checksumFileRawEvidence,
  type FileRawEvidence,
} from "../../../src/modules/audience/infrastructure/storage/file-raw-evidence";
import { S3FileRawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-file-raw-object-storage";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";

describe("S3FileRawObjectStorage", () => {
  const bucket = `okved-file-raw-test-${randomUUID()}`;
  const env: AppEnv = {
    appMode: "fixture",
    databaseUrl: "postgresql://unused",
    s3Endpoint: "http://127.0.0.1:9000",
    s3Bucket: bucket,
    s3AccessKeyId: "okved-local",
    s3SecretAccessKey: "okved-local-secret",
    listOrgLiveEnabled: false,
    fnsLiveEnabled: false,
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
    const objects = (listed.Contents ?? []).flatMap((item) =>
      item.Key === undefined ? [] : [{ Key: item.Key }]);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  });

  it("stores immutable file bytes and an exact checksummed manifest idempotently", async () => {
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client);
    const evidence = checksumFileRawEvidence(sampleEvidence("file-idempotent"));

    const plan = storage.plan(evidence);
    expect(plan.objects).toEqual([
      { key: plan.stored.kind === "file" ? plan.stored.dataKey : "", checksumSha256: evidence.dataChecksumSha256 },
      { key: plan.stored.manifestKey, checksumSha256: evidence.checksumSha256 },
    ]);

    const first = await storage.put(evidence);
    const second = await storage.put(evidence);

    expect(second).toEqual(first);
    expect(first).toEqual({
      kind: "file",
      runId: "file-idempotent",
      sourceKind: "fns-bfo",
      sourceRecordKey: "7707083893:2025:0710002",
      parserVersion: "fns-bfo/1.0.0",
      checksumSha256: evidence.checksumSha256,
      prefix: `raw/file-idempotent/fns-bfo/${evidence.checksumSha256}`,
      manifestKey: `raw/file-idempotent/fns-bfo/${evidence.checksumSha256}/manifest.json`,
      dataKey: `raw/file-idempotent/fns-bfo/${evidence.checksumSha256}/data`,
      mimeType: "application/zip",
      byteLength: 8,
    });
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${first.prefix}/`,
    }));
    expect(listed.Contents?.map((item) => item.Key).sort()).toEqual([
      first.dataKey,
      first.manifestKey,
    ].sort());

    const manifestResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: first.manifestKey,
    }));
    expect(JSON.parse(await manifestResponse.Body!.transformToString())).toEqual({
      version: 1,
      sourceKind: "fns-bfo",
      parserVersion: "fns-bfo/1.0.0",
      finalUrl: "https://service.nalog.ru/bfo/7707083893/2025",
      capturedAt: "2026-08-26T09:00:00.000Z",
      navigationStatus: 200,
      identity: {
        runId: "file-idempotent",
        sourceRecordKey: "7707083893:2025:0710002",
      },
      artifact: {
        file: "data",
        mimeType: "application/zip",
        byteLength: 8,
        checksumSha256: sha256(evidence.data),
      },
    });
    await expect(storage.verify(first)).resolves.toEqual({
      runId: "file-idempotent",
      sourceKind: "fns-bfo",
      sourceRecordKey: "7707083893:2025:0710002",
      checksumSha256: evidence.checksumSha256,
      parserVersion: "fns-bfo/1.0.0",
      candidateEvidence: null,
    });
  });

  it("exposes a precise failure phase after the manifest write", async () => {
    const evidence = checksumFileRawEvidence(sampleEvidence("file-after-manifest"));
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client, {
      afterManifestWrite: () => { throw new Error("injected after manifest"); },
    });

    await expect(storage.put(evidence)).rejects.toMatchObject({
      name: "RawUploadStorageError",
      phase: "after_manifest_write",
    });
    const plan = storage.plan(evidence);
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${plan.stored.prefix}/` }));
    expect(listed.Contents?.map((item) => item.Key).sort()).toEqual(
      plan.objects.map((object) => object.key).sort(),
    );
  });

  it("rejects immutable-key collisions when existing bytes differ", async () => {
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client);
    const evidence = checksumFileRawEvidence(sampleEvidence("file-collision"));
    const dataKey = `raw/file-collision/fns-bfo/${evidence.checksumSha256}/data`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: dataKey, Body: "wrong" }));

    await expect(storage.put(evidence)).rejects.toThrow(`immutable object collision at ${dataKey}`);
  });

  it("rejects publication when file bytes no longer match the manifest", async () => {
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client);
    const stored = await storage.put(checksumFileRawEvidence(sampleEvidence("file-corrupt")));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.dataKey, Body: "corrupt" }));

    await expect(storage.verify(stored)).rejects.toThrow("raw object checksum verification failed");
  });

  it.each([
    ["run id", { identity: { runId: "../escape", sourceRecordKey: "record" } }],
    ["source kind", { sourceKind: "../fns-bfo" }],
  ])("rejects unsafe %s keys", async (_case, override) => {
    const input = { ...sampleEvidence(`file-unsafe-${_case.replace(" ", "-")}`), ...override };
    expect(() => checksumFileRawEvidence(input)).toThrow(/safe for an object key/);
  });

  it("rejects unknown source identity fields before creating a manifest", () => {
    const input = {
      ...sampleEvidence("file-extra-input-identity"),
      identity: {
        runId: "file-extra-input-identity",
        sourceRecordKey: "7707083893:2025:0710002",
        persistedSecret: "must-not-be-stored",
      },
    };

    expect(() => checksumFileRawEvidence(input)).toThrow("file raw evidence is invalid");
  });

  it.each([
    ["run", { runId: "another-run" }],
    ["source", { sourceKind: "fns-revexp" }],
    ["record", { sourceRecordKey: "another-record" }],
    ["parser", { parserVersion: "fns-bfo/9.9.9" }],
  ])("rejects a checksum-valid manifest with the wrong expected %s identity", async (
    _case,
    override,
  ) => {
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client);
    const stored = await storage.put(checksumFileRawEvidence(sampleEvidence(`file-owner-${_case}`)));

    await expect(storage.verify({ ...stored, ...override })).rejects.toThrow(
      "raw object identity verification failed",
    );
  });

  it.each([
    ["an unknown field", (manifest: Record<string, unknown>) => {
      manifest.persistedSecret = "must-not-survive-verification";
    }],
    ["an invalid MIME type", (manifest: Record<string, unknown>) => {
      (manifest.artifact as Record<string, unknown>).mimeType = "not a mime type";
    }],
    ["an invalid byte length", (manifest: Record<string, unknown>) => {
      (manifest.artifact as Record<string, unknown>).byteLength = -1;
    }],
  ])("rejects a checksum-consistent file manifest with %s", async (_case, mutate) => {
    const runSlug = _case.replaceAll(/[^a-z0-9]+/g, "-");
    const evidence = checksumFileRawEvidence(sampleEvidence(`file-manifest-${runSlug}`));
    const manifest = JSON.parse(new TextDecoder().decode(evidence.manifestUtf8)) as Record<string, unknown>;
    mutate(manifest);
    const stored = await putManifestBytes(evidence, new TextEncoder().encode(JSON.stringify(manifest)));
    const storage = new S3FileRawObjectStorage(env, "fns-bfo", client);

    await expect(storage.verify(stored)).rejects.toThrow("raw object checksum verification failed");
  });

  it("rejects browser/file cross-kind verification", async () => {
    const fileStorage = new S3FileRawObjectStorage(env, "fns-bfo", client);
    const file = await fileStorage.put(checksumFileRawEvidence(sampleEvidence("file-cross-kind")));
    const browserStorage = new S3RawObjectStorage(env, "fns-bfo", client);
    const fakeBrowser = {
      ...file,
      kind: "browser",
      domKey: `${file.prefix}/dom.html`,
      screenshotKey: `${file.prefix}/screenshot.png`,
    } as StoredRawObject;

    await expect(browserStorage.verify(file)).rejects.toThrow("raw object artifact kind is invalid");
    await expect(fileStorage.verify(fakeBrowser)).rejects.toThrow("raw object artifact kind is invalid");
  });

  async function putManifestBytes(
    evidence: ReturnType<typeof checksumFileRawEvidence>,
    manifestBytes: Uint8Array,
  ): Promise<StoredFileRawObject> {
    const checksumSha256 = sha256(manifestBytes);
    const prefix = `raw/${evidence.identity.runId}/fns-bfo/${checksumSha256}`;
    const stored: StoredFileRawObject = {
      kind: "file",
      runId: evidence.identity.runId,
      sourceKind: evidence.sourceKind,
      sourceRecordKey: evidence.identity.sourceRecordKey,
      parserVersion: evidence.parserVersion,
      checksumSha256,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      dataKey: `${prefix}/data`,
      mimeType: evidence.mimeType,
      byteLength: evidence.data.byteLength,
    };
    await Promise.all([
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.dataKey, Body: evidence.data })),
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.manifestKey, Body: manifestBytes })),
    ]);
    return stored;
  }
});

function sampleEvidence(runId: string): FileRawEvidence {
  return {
    sourceKind: "fns-bfo",
    parserVersion: "fns-bfo/1.0.0",
    finalUrl: "https://service.nalog.ru/bfo/7707083893/2025",
    capturedAt: "2026-08-26T09:00:00.000Z",
    navigationStatus: 200,
    identity: { runId, sourceRecordKey: "7707083893:2025:0710002" },
    mimeType: "application/zip",
    data: new Uint8Array([80, 75, 3, 4, 20, 0, 0, 0]),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
