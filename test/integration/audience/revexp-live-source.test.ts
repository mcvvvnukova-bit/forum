import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../../../src/shared/config/env";
import {
  downloadRevexpArchive,
  resolveRevexpRelease,
} from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-release";
import { selectRevexpMetrics } from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser";
import { checksumFileRawEvidence } from "../../../src/modules/audience/infrastructure/storage/file-raw-evidence";
import { S3FileRawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-file-raw-object-storage";
import {
  startRevexpContractServer,
  type RevexpContractServer,
} from "../../support/fns-revexp-contract-server";

const targetInns = [
  "7700000016", "7700000023", "7700000030", "7700000048", "7700000055",
  "7700000062", "7700000070", "7700000087", "7700000094", "7700000104",
] as const;

describe("official revexp live source contract", () => {
  let server: RevexpContractServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("resolves, downloads once, stores complete bytes once, and target-selects one shared raw checksum", async () => {
    server = await startRevexpContractServer();
    const release = await resolveRevexpRelease(server.metadataUrl, server.transport);
    const downloaded = await downloadRevexpArchive(release, server.transport);
    const fakeS3 = new MemoryS3Client();
    const storage = new S3FileRawObjectStorage(fileEnv, "fns-revexp", fakeS3.client);
    const parserVersion = `fns-revexp/1.0.0+xsd-${release.structureVersion}`;
    const raw = checksumFileRawEvidence({
      sourceKind: "fns-revexp",
      parserVersion,
      finalUrl: downloaded.finalUrl,
      capturedAt: downloaded.capturedAt,
      navigationStatus: downloaded.status,
      identity: {
        runId: "revexp-live-contract",
        sourceRecordKey: `${release.datasetId}:${release.reportYear}`,
      },
      mimeType: downloaded.contentType,
      data: downloaded.data,
    });
    const stored = await storage.put(raw);
    await expect(storage.verify(stored)).resolves.toEqual(expect.objectContaining({
      checksumSha256: raw.checksumSha256,
      sourceRecordKey: "7707329152-revexp:2025",
    }));

    const evidence = await selectRevexpMetrics(chunked(downloaded.data, 29), targetInns, {
      reportYear: release.reportYear,
      sourceRecordKey: (inn) => `${inn}:${release.reportYear}:${release.datasetId}`,
      observedAt: release.updatedAt,
      rawFetchKey: stored.checksumSha256,
      parserVersion,
    });

    expect(evidence).toHaveLength(20);
    expect(evidence.map((item) => [item.inn, item.metric, item.value]).slice(0, 4)).toEqual([
      ["7700000016", "income", "1001.00"],
      ["7700000016", "expenses", "501.00"],
      ["7700000023", "income", "1002.00"],
      ["7700000023", "expenses", "502.00"],
    ]);
    expect(new Set(evidence.map((item) => item.rawFetchKey))).toEqual(new Set([stored.checksumSha256]));
    expect([...new Set(evidence.map((item) => item.sourceRecordKey))]).toHaveLength(10);
    expect(fakeS3.dataWrites).toBe(1);
    expect(fakeS3.objects.get(stored.dataKey)).toEqual(downloaded.data);
    expect(server.metadataDispatchCount()).toBe(3);
    expect(server.archiveHeadCount()).toBe(2);
    expect(server.successfulArchiveDownloads()).toBe(1);
    expect(server.maxConcurrentRequests()).toBe(1);

    await expect(downloadRevexpArchive(release, server.transport)).rejects.toThrow("409");
    expect(server.archiveDownloadAttempts()).toBe(2);
    expect(server.successfulArchiveDownloads()).toBe(1);
  });
});

class MemoryS3Client {
  readonly objects = new Map<string, Uint8Array>();
  dataWrites = 0;
  readonly client = {
    send: async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key;
        if (key === undefined || !(command.input.Body instanceof Uint8Array)) {
          throw new Error("unexpected S3 put input");
        }
        this.objects.set(key, command.input.Body);
        if (key.endsWith("/data")) this.dataWrites += 1;
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key;
        const bytes = key === undefined ? undefined : this.objects.get(key);
        if (bytes === undefined) throw new Error("missing memory S3 object");
        return { Body: { transformToByteArray: async () => bytes } };
      }
      throw new Error("unexpected S3 command");
    },
    destroy() {},
  // The integration fake implements only the two AWS commands exercised by
  // S3FileRawObjectStorage; the cast keeps the production constructor exact.
  } as unknown as S3Client;
}

const fileEnv: AppEnv = {
  appMode: "fixture",
  databaseUrl: "postgresql://unused",
  s3Endpoint: "http://127.0.0.1:9000",
  s3Bucket: "memory-revexp",
  s3AccessKeyId: "unused",
  s3SecretAccessKey: "unused",
  listOrgLiveEnabled: false,
  fnsLiveEnabled: false,
};

async function* chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}
