import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  resolveRevexpRelease,
  type RevexpTransport,
  type RevexpTransportRequest,
  type RevexpTransportResponse,
} from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-release";

const metadataUrl = "https://www.nalog.gov.ru/opendata/7707329152-revexp/";
const discoveredArchiveUrl = "https://www.nalog.gov.ru/opendata/7707329152-revexp/data-2025.zip";
const finalArchiveUrl = "https://file.nalog.ru/opendata/7707329152-revexp/data-2025.zip";
const xsdUrl = "https://www.nalog.gov.ru/opendata/7707329152-revexp/structure-5.10.xsd";

describe("resolveRevexpRelease", () => {
  it("resolves the official 2025 release and retains exact metadata/HEAD capture provenance", async () => {
    const html = await officialMetadata();
    const transport = new FixtureTransport([
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.byteLength),
      }, html, "2026-08-26T09:00:00.000Z"),
      response(discoveredArchiveUrl, 302, { location: finalArchiveUrl }, undefined, "2026-08-26T09:00:01.000Z"),
      response(finalArchiveUrl, 200, {
        "content-type": "application/zip",
        "content-length": "1048576",
        etag: '"archive-etag"',
        "last-modified": "Sun, 15 Mar 2026 00:00:00 GMT",
      }, undefined, "2026-08-26T09:00:02.000Z"),
    ]);

    await expect(resolveRevexpRelease(metadataUrl, transport)).resolves.toEqual({
      datasetId: "7707329152-revexp",
      reportYear: 2025,
      structureVersion: "5.10",
      xsdUrl,
      publishedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      metadataUrl,
      finalArchiveUrl,
      contentType: "application/zip",
      contentLength: 1_048_576,
      etag: '"archive-etag"',
      lastModified: "2026-03-15T00:00:00.000Z",
      capture: {
        metadata: {
          finalUrl: metadataUrl,
          status: 200,
          capturedAt: "2026-08-26T09:00:00.000Z",
          contentType: "text/html; charset=utf-8",
          contentLength: html.byteLength,
          redirectChain: [metadataUrl],
        },
        archive: {
          finalUrl: finalArchiveUrl,
          status: 200,
          capturedAt: "2026-08-26T09:00:02.000Z",
          contentType: "application/zip",
          contentLength: 1_048_576,
          redirectChain: [discoveredArchiveUrl, finalArchiveUrl],
        },
      },
    });
    expect(transport.requests).toEqual([
      `GET ${metadataUrl}`,
      `HEAD ${discoveredArchiveUrl}`,
      `HEAD ${finalArchiveUrl}`,
    ]);
  });

  it.each([
    ["wrong dataset", { replace: ["<dd>7707329152-revexp</dd>", "<dd>7707329152-other</dd>"] }, "dataset"],
    ["wrong report year", { replace: ["<dt>Отчетный год</dt><dd>2025</dd>", "<dt>Отчетный год</dt><dd>2024</dd>"] }, "2025"],
    ["missing report year", { replace: ["<dt>Отчетный год</dt><dd>2025</dd>", ""] }, "2025"],
    ["missing structure version", { replace: ["<dt>Версия структуры</dt><dd>5.10</dd>", ""] }, "structure"],
    ["an XSD version mismatch", { replace: ["structure-5.10.xsd", "structure-4.0.xsd"] }, "XSD version"],
    ["ambiguous archive", { append: `<a href="${finalArchiveUrl}?copy=2">copy.zip</a>` }, "exactly one"],
  ])("rejects metadata with %s", async (_case, mutation, expected) => {
    let html = new TextDecoder().decode(await officialMetadata());
    if ("replace" in mutation) html = html.replace(mutation.replace[0]!, mutation.replace[1]!);
    if ("append" in mutation) html += mutation.append;
    const body = new TextEncoder().encode(html);
    const transport = new FixtureTransport([
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.byteLength),
      }, body),
    ]);

    await expect(resolveRevexpRelease(metadataUrl, transport)).rejects.toThrow(expected);
  });

  it.each([
    ["HTTP downgrade", "http://file.nalog.ru/opendata/7707329152-revexp/data.zip", "HTTPS"],
    ["unapproved redirect host", "https://evil.example/revexp.zip", "host"],
  ])("rejects an archive %s", async (_case, location, expected) => {
    const html = await officialMetadata();
    const transport = new FixtureTransport([
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.byteLength),
      }, html),
      response(discoveredArchiveUrl, 302, { location }),
    ]);

    await expect(resolveRevexpRelease(metadataUrl, transport)).rejects.toThrow(expected);
    expect(transport.requests).toHaveLength(2);
  });

  it.each([
    ["missing content type", { "content-length": "100" }, "content type"],
    ["wrong content type", { "content-type": "text/html", "content-length": "100" }, "content type"],
    ["missing content length", { "content-type": "application/zip" }, "content length"],
    ["oversized content length", { "content-type": "application/zip", "content-length": String(256 * 1024 * 1024 + 1) }, "256 MiB"],
  ])("rejects archive HEAD metadata with %s", async (_case, headers, expected) => {
    const html = await officialMetadata();
    const transport = new FixtureTransport([
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.byteLength),
      }, html),
      response(discoveredArchiveUrl, 302, { location: finalArchiveUrl }),
      response(finalArchiveUrl, 200, headers),
    ]);

    await expect(resolveRevexpRelease(metadataUrl, transport)).rejects.toThrow(expected);
  });

  it("retries transient responses sequentially twice and never retries a policy failure", async () => {
    const html = await officialMetadata();
    const transport = new FixtureTransport([
      response(metadataUrl, 503, {}),
      response(metadataUrl, 503, {}),
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.byteLength),
      }, html),
      response(discoveredArchiveUrl, 302, { location: "https://attacker.example/archive.zip" }),
    ]);

    await expect(resolveRevexpRelease(metadataUrl, transport)).rejects.toThrow("host");
    expect(transport.requests).toEqual([
      `GET ${metadataUrl}`,
      `GET ${metadataUrl}`,
      `GET ${metadataUrl}`,
      `HEAD ${discoveredArchiveUrl}`,
    ]);
    expect(transport.maxInFlight).toBe(1);
  });

  it("normalizes official Russian display dates to canonical source timestamps", async () => {
    const html = new TextEncoder().encode(new TextDecoder().decode(await officialMetadata())
      .replace("2026-03-01", "01.03.2026")
      .replace("2026-03-15", "15.03.2026"));
    const transport = new FixtureTransport([
      response(metadataUrl, 200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.byteLength),
      }, html),
      response(discoveredArchiveUrl, 302, { location: finalArchiveUrl }),
      response(finalArchiveUrl, 200, {
        "content-type": "application/zip",
        "content-length": "100",
      }),
    ]);

    const release = await resolveRevexpRelease(metadataUrl, transport);
    expect([release.publishedAt, release.updatedAt]).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
    ]);
  });
});

class FixtureTransport implements RevexpTransport {
  readonly requests: string[] = [];
  maxInFlight = 0;
  #inFlight = 0;

  constructor(private readonly queued: RevexpTransportResponse[]) {}

  async request(input: RevexpTransportRequest): Promise<RevexpTransportResponse> {
    this.requests.push(`${input.method} ${input.url}`);
    this.#inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.#inFlight);
    await Promise.resolve();
    this.#inFlight -= 1;
    const next = this.queued.shift();
    if (next === undefined) throw new Error("unexpected transport request");
    return next;
  }
}

async function officialMetadata(): Promise<Uint8Array> {
  const template = await readFile(new URL("../../fixtures/fns-revexp/metadata-2025.html", import.meta.url), "utf8");
  return new TextEncoder().encode(template
    .replaceAll("{{ARCHIVE_URL}}", discoveredArchiveUrl)
    .replaceAll("{{XSD_URL}}", xsdUrl));
}

function response(
  url: string,
  status: number,
  headers: Readonly<Record<string, string>>,
  body?: Uint8Array,
  capturedAt = "2026-08-26T09:00:00.000Z",
): RevexpTransportResponse {
  return {
    url,
    status,
    headers,
    capturedAt,
    ...(body === undefined ? {} : { body: chunks(body, 31) }),
  };
}

async function* chunks(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}
