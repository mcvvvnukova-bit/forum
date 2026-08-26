import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RevexpTransport,
  RevexpTransportRequest,
  RevexpTransportResponse,
} from "../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-release";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/fns-revexp");

export interface RevexpContractServer {
  readonly metadataUrl: string;
  readonly archiveResolutionUrl: string;
  readonly archiveDownloadUrl: string;
  readonly transport: RevexpTransport;
  metadataDispatchCount(): number;
  archiveHeadCount(): number;
  archiveDownloadAttempts(): number;
  successfulArchiveDownloads(): number;
  maxConcurrentRequests(): number;
  close(): Promise<void>;
}

export async function startRevexpContractServer(): Promise<RevexpContractServer> {
  const [metadataTemplate, archive] = await Promise.all([
    readFile(join(fixtureDirectory, "metadata-2025.html"), "utf8"),
    readFile(join(fixtureDirectory, "revexp-2025.zip")),
  ]);
  let origin = "";
  let metadataDispatches = 0;
  let archiveHeads = 0;
  let archiveDownloadAttempts = 0;
  let successfulArchiveDownloads = 0;
  let inFlight = 0;
  let maximumInFlight = 0;

  const server = createServer((request, response) => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      inFlight -= 1;
    };
    response.once("finish", finish);
    response.once("close", finish);
    const url = new URL(request.url ?? "/", "http://fixture.invalid");

    if (request.method === "GET" && url.pathname === "/opendata/7707329152-revexp/") {
      metadataDispatches += 1;
      if (metadataDispatches <= 2) {
        response.writeHead(503, { "content-length": "0" });
        response.end();
        return;
      }
      const html = metadataTemplate
        .replaceAll("{{ARCHIVE_URL}}", `${origin}/download/revexp-2025.zip`)
        .replaceAll("{{XSD_URL}}", `${origin}/opendata/7707329152-revexp/structure-5.10.xsd`);
      const bytes = new TextEncoder().encode(html);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(bytes.byteLength),
      });
      response.end(bytes);
      return;
    }

    if (request.method === "HEAD" && url.pathname === "/download/revexp-2025.zip") {
      archiveHeads += 1;
      response.writeHead(302, { location: `${origin}/files/revexp-2025.zip` });
      response.end();
      return;
    }
    if (request.method === "HEAD" && url.pathname === "/files/revexp-2025.zip") {
      archiveHeads += 1;
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": String(archive.byteLength),
        etag: '"fixture-revexp-2025"',
        "last-modified": "Sun, 15 Mar 2026 00:00:00 GMT",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/files/revexp-2025.zip") {
      archiveDownloadAttempts += 1;
      if (successfulArchiveDownloads > 0) {
        response.writeHead(409, { "content-length": "0" });
        response.end();
        return;
      }
      response.writeHead(302, { location: `${origin}/downloads/revexp-2025.zip` });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/downloads/revexp-2025.zip") {
      successfulArchiveDownloads += 1;
      response.writeHead(200, {
        "content-type": "application/zip; profile=download",
        "content-length": String(archive.byteLength),
        etag: '"fixture-revexp-2025"',
        "last-modified": "Mon, 16 Mar 2026 00:00:00 GMT",
      });
      for (let offset = 0; offset < archive.byteLength; offset += 37) {
        response.write(archive.subarray(offset, Math.min(offset + 37, archive.byteLength)));
      }
      response.end();
      return;
    }

    response.writeHead(404, { "content-length": "0" });
    response.end();
  });
  await listen(server);
  origin = serverOrigin(server);
  const transport = new LocalRevexpTransport(origin);

  return {
    metadataUrl: `${origin}/opendata/7707329152-revexp/`,
    archiveResolutionUrl: `${origin}/files/revexp-2025.zip`,
    archiveDownloadUrl: `${origin}/downloads/revexp-2025.zip`,
    transport,
    metadataDispatchCount: () => metadataDispatches,
    archiveHeadCount: () => archiveHeads,
    archiveDownloadAttempts: () => archiveDownloadAttempts,
    successfulArchiveDownloads: () => successfulArchiveDownloads,
    maxConcurrentRequests: () => maximumInFlight,
    close: async () => { await closeServer(server); },
  };
}

class LocalRevexpTransport implements RevexpTransport {
  readonly testPolicy: { allowedOrigins: readonly string[] };

  constructor(origin: string) {
    this.testPolicy = { allowedOrigins: [origin] };
  }

  async request(input: RevexpTransportRequest): Promise<RevexpTransportResponse> {
    const response = await fetch(input.url, { method: input.method, redirect: "manual" });
    const headers = Object.fromEntries(response.headers.entries());
    const pathname = new URL(input.url).pathname;
    const capturedAt = input.method === "HEAD" && pathname === "/files/revexp-2025.zip"
      ? "2026-08-26T08:00:02.000Z"
      : input.method === "GET" && pathname === "/downloads/revexp-2025.zip"
        ? "2026-08-26T09:00:02.000Z"
        : "2026-08-26T07:00:00.000Z";
    return {
      url: response.url,
      status: response.status,
      headers,
      capturedAt,
      ...(response.body === null ? {} : { body: webBody(response.body) }),
    };
  }
}

async function* webBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serverOrigin(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("contract server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
