import { createServer, type IncomingMessage, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PolicyBrowserSessionFactory,
  type BrowserOriginPolicy,
} from "../../../src/modules/audience/infrastructure/sources/browser/policy-browser";

describe("PolicyBrowserSessionFactory", () => {
  let allowed: LocalServer;
  let external: LocalServer;

  beforeAll(async () => {
    external = await startServer(() => "external");
    allowed = await startServer((request) => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const externalUrl = external!.url;
      const scenario = url.searchParams.get("scenario");
      if (scenario === "redirect") return { status: 302, headers: { location: externalUrl } };
      if (scenario === "script") return `<script src="${externalUrl}/script.js"></script>`;
      if (scenario === "xhr") return `<script>fetch(${JSON.stringify(externalUrl)})</script>`;
      if (scenario === "websocket") return `<script>new WebSocket(${JSON.stringify(externalUrl.replace("http:", "ws:"))})</script>`;
      if (scenario === "service-worker") return `<script>navigator.serviceWorker.register("/worker.js")</script>`;
      if (scenario === "popup") return `<script>window.open(${JSON.stringify(externalUrl)})</script>`;
      if (scenario === "download") return `<a id="download" href="/download" download>download</a><script>download.click()</script>`;
      if (scenario === "passive") {
        return [
          `<img src="${externalUrl}/image.png">`,
          `<link rel="stylesheet" href="${externalUrl}/style.css">`,
          `<style>@font-face { font-family: test; src: url(${externalUrl}/font.woff2); }</style><p style="font-family:test">font</p>`,
          `<iframe src="${externalUrl}/frame"></iframe>`,
          "<main>allowed page</main>",
        ].join("\n");
      }
      return "<main>allowed page</main>";
    });
  });

  afterAll(async () => {
    await Promise.all([allowed.close(), external.close()]);
  });

  it("requires exact HTTPS origins unless an explicit test-only policy permits local HTTP", () => {
    expect(() => new PolicyBrowserSessionFactory({ allowedOrigins: ["http://example.test"] }))
      .toThrow("HTTPS");
    expect(() => new PolicyBrowserSessionFactory({ allowedOrigins: ["https://example.test/path"] }))
      .toThrow("exact origin");
    expect(() => new PolicyBrowserSessionFactory(testPolicy(allowed.url))).not.toThrow();
  });

  it.each([
    "document",
    "script",
    "xhr",
    "websocket",
    "service-worker",
    "popup",
    "download",
  ])("terminally rejects a cross-origin %s", async (scenario) => {
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url)).open();
    try {
      const target = scenario === "document" ? external.url : `${allowed.url}/?scenario=${scenario}`;
      await expect(session.navigate(target))
        .rejects.toMatchObject({ origins: expect.any(Array) });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("logs and aborts passive cross-origin resources without failing navigation", async () => {
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url)).open();
    try {
      await expect(session.navigate(`${allowed.url}/?scenario=passive`)).resolves.toBe(200);
      expect(await session.policyViolations()).toEqual(expect.arrayContaining([
        expect.objectContaining({ disposition: "passive", resourceType: "image", origin: external.url }),
        expect.objectContaining({ disposition: "passive", resourceType: "stylesheet", origin: external.url }),
        expect.objectContaining({ disposition: "passive", resourceType: "font", origin: external.url }),
        expect.objectContaining({ disposition: "passive", resourceType: "subframe", origin: external.url }),
      ]));
    } finally {
      await session.close();
    }
  });
});

function testPolicy(origin: string): BrowserOriginPolicy {
  return { allowedOrigins: [origin], allowInsecureHttpForTesting: true };
}

interface LocalServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(
  handler: (request: IncomingMessage) => string | {
    status: number;
    headers: Record<string, string>;
  },
): Promise<LocalServer> {
  const server = createServer((request, response) => {
    if (request.url === "/worker.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end("self.addEventListener('install', () => undefined)");
      return;
    }
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=fixture.bin",
      });
      response.end("download");
      return;
    }
    const output = handler(request);
    if (typeof output === "string") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>${output}</body></html>`);
      return;
    }
    response.writeHead(output.status, output.headers);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not allocate a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
