import { describe, expect, it } from "vitest";

import {
  checksumFileRawEvidenceFromPath,
  isRevexpRawProvenance,
  type RevexpRawProvenance,
} from "../../../src/modules/audience/infrastructure/storage/file-raw-evidence";

describe("revexp raw provenance", () => {
  it("preserves distinct HEAD resolution and GET download captures in the manifest", () => {
    const provenance = sampleProvenance();
    const evidence = checksumFileRawEvidenceFromPath({
      sourceKind: "fns-revexp",
      parserVersion: "fns-revexp/structure-5.10",
      finalUrl: provenance.archiveDownload.finalUrl,
      capturedAt: provenance.archiveDownload.capturedAt,
      navigationStatus: provenance.archiveDownload.status,
      identity: {
        runId: "revexp-split-provenance",
        sourceRecordKey: "7707329152-revexp:2025",
      },
      mimeType: provenance.archiveDownload.headers.contentType,
      filePath: "/tmp/revexp-split-provenance.zip",
      byteLength: provenance.archiveDownload.headers.contentLength,
      dataChecksumSha256: "a".repeat(64),
      provenance,
    });

    const manifest = JSON.parse(new TextDecoder().decode(evidence.manifestUtf8)) as {
      provenance: RevexpRawProvenance;
    };
    expect(manifest.provenance.archiveResolution).toEqual(provenance.archiveResolution);
    expect(manifest.provenance.archiveDownload).toEqual(provenance.archiveDownload);
    expect(manifest.provenance.archiveResolution).not.toEqual(
      manifest.provenance.archiveDownload,
    );
  });

  it("rejects the legacy hybrid archive capture", () => {
    const provenance = sampleProvenance() as unknown as Record<string, unknown>;
    const archiveResolution = provenance.archiveResolution;
    const archiveDownload = provenance.archiveDownload;
    delete provenance.archiveResolution;
    delete provenance.archiveDownload;
    provenance.archive = { ...(archiveResolution as object), ...(archiveDownload as object) };

    expect(isRevexpRawProvenance(provenance)).toBe(false);
  });

  it.each([
    ["a GET-labelled resolution", (provenance: Record<string, unknown>) => {
      (provenance.archiveResolution as Record<string, unknown>).method = "GET";
    }],
    ["an unknown capture field", (provenance: Record<string, unknown>) => {
      (provenance.archiveDownload as Record<string, unknown>).rawHeaders = {};
    }],
    ["an unknown header", (provenance: Record<string, unknown>) => {
      const capture = provenance.archiveResolution as Record<string, unknown>;
      (capture.headers as Record<string, unknown>).contentDisposition = "attachment";
    }],
  ])("strictly rejects %s", (_case, mutate) => {
    const provenance = structuredClone(sampleProvenance()) as unknown as Record<string, unknown>;
    mutate(provenance);

    expect(isRevexpRawProvenance(provenance)).toBe(false);
  });
});

function sampleProvenance(): RevexpRawProvenance {
  return {
    datasetId: "7707329152-revexp",
    reportYear: 2025,
    publishedAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    structureVersion: "5.10",
    xsdUrl: "https://data.nalog.ru/opendata/7707329152-revexp/structure-5.10.xsd",
    metadata: {
      method: "GET",
      finalUrl: "https://data.nalog.ru/opendata/7707329152-revexp/",
      status: 200,
      capturedAt: "2026-08-26T07:00:00.000Z",
      redirectChain: ["https://data.nalog.ru/opendata/7707329152-revexp/"],
      headers: {
        contentType: "text/html; charset=utf-8",
        contentLength: 4096,
        etag: null,
        lastModified: null,
      },
    },
    archiveResolution: {
      method: "HEAD",
      finalUrl: "https://data.nalog.ru/files/revexp-2025.zip",
      status: 200,
      capturedAt: "2026-08-26T08:00:02.000Z",
      redirectChain: [
        "https://data.nalog.ru/download/revexp-2025.zip",
        "https://data.nalog.ru/files/revexp-2025.zip",
      ],
      headers: {
        contentType: "application/zip",
        contentLength: 128,
        etag: "\"revexp-2025\"",
        lastModified: "2026-03-15T00:00:00.000Z",
      },
    },
    archiveDownload: {
      method: "GET",
      finalUrl: "https://data.nalog.ru/downloads/revexp-2025.zip",
      status: 200,
      capturedAt: "2026-08-26T09:00:02.000Z",
      redirectChain: [
        "https://data.nalog.ru/files/revexp-2025.zip",
        "https://data.nalog.ru/downloads/revexp-2025.zip",
      ],
      headers: {
        contentType: "application/zip; profile=download",
        contentLength: 128,
        etag: "\"revexp-2025\"",
        lastModified: "2026-03-16T00:00:00.000Z",
      },
    },
  };
}
