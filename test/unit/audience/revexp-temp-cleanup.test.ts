import { access, rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ temporaryDirectories: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: async (prefix: string) => {
      const directory = await actual.mkdtemp(prefix);
      observed.temporaryDirectories.push(directory);
      return directory;
    },
    open: async () => {
      throw new Error("injected temporary-file open failure");
    },
  };
});

import {
  downloadRevexpArchive,
  type RevexpRelease,
  type RevexpTransport,
} from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-release";

const archiveUrl = "https://file.nalog.ru/opendata/7707329152-revexp/data-2025.zip";

describe("revexp temporary archive cleanup", () => {
  afterEach(async () => {
    await Promise.all(observed.temporaryDirectories.map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }));
    observed.temporaryDirectories.length = 0;
  });

  it("removes the newly-created directory when opening the archive file fails", async () => {
    const archive = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const release: RevexpRelease = {
      datasetId: "7707329152-revexp",
      reportYear: 2025,
      structureVersion: "5.10",
      xsdUrl: "https://www.nalog.gov.ru/opendata/7707329152-revexp/structure-5.10.xsd",
      publishedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      metadataUrl: "https://www.nalog.gov.ru/opendata/7707329152-revexp/",
      finalArchiveUrl: archiveUrl,
      contentType: "application/zip",
      contentLength: archive.byteLength,
      etag: '"archive-etag"',
      lastModified: "2026-03-15T00:00:00.000Z",
      capture: {
        metadata: {
          method: "GET",
          finalUrl: "https://www.nalog.gov.ru/opendata/7707329152-revexp/",
          status: 200,
          capturedAt: "2026-08-26T08:59:58.000Z",
          redirectChain: ["https://www.nalog.gov.ru/opendata/7707329152-revexp/"],
          headers: {
            contentType: "text/html; charset=utf-8",
            contentLength: 100,
            etag: null,
            lastModified: null,
          },
        },
        archiveResolution: {
          method: "HEAD",
          finalUrl: archiveUrl,
          status: 200,
          capturedAt: "2026-08-26T08:59:59.000Z",
          redirectChain: [archiveUrl],
          headers: {
            contentType: "application/zip",
            contentLength: archive.byteLength,
            etag: '"archive-etag"',
            lastModified: "2026-03-15T00:00:00.000Z",
          },
        },
      },
    };
    const transport: RevexpTransport = {
      request: async () => ({
        url: archiveUrl,
        status: 200,
        capturedAt: "2026-08-26T09:00:00.000Z",
        headers: {
          "content-type": "application/zip",
          "content-length": String(archive.byteLength),
          etag: '"archive-etag"',
          "last-modified": "Sun, 15 Mar 2026 00:00:00 GMT",
        },
        body: chunks(archive),
      }),
    };

    await expect(downloadRevexpArchive(release, transport)).rejects.toThrow(
      "injected temporary-file open failure",
    );

    expect(observed.temporaryDirectories).toHaveLength(1);
    await expect(access(observed.temporaryDirectories[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
