import { createServer, type IncomingMessage, type Server } from "node:http";

import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PolicyBrowserSessionFactory,
  type BrowserOriginPolicy,
} from "../../../src/modules/audience/infrastructure/sources/browser/policy-browser";

describe("PolicyBrowserSessionFactory", () => {
  let allowed: LocalServer;
  let external: LocalServer;

  beforeAll(async () => {
    external = await startServer(() => "external");
    allowed = await startServer((request, requestNumber): LocalServerResponse => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      const externalUrl = external!.url;
      const scenario = url.searchParams.get("scenario");
      if (url.pathname === "/same-origin-redirect") {
        return { status: 302, headers: { location: "/forbidden-target" } };
      }
      if (url.pathname === "/external-redirect") {
        return { status: 302, headers: { location: `${externalUrl}/forbidden-target` } };
      }
      if (url.pathname === "/transient-5xx") {
        return requestNumber < 3
          ? { status: 503, headers: {}, body: "transient" }
          : "recovered";
      }
      if (url.pathname === "/persistent-5xx") {
        return { status: 503, headers: {}, body: "still unavailable" };
      }
      if (url.pathname === "/retry-entry") {
        return '<main><a href="/click-transient">Retry target</a></main>';
      }
      if (url.pathname === "/click-transient") {
        return requestNumber < 3
          ? { status: 502, headers: {}, body: "transient click navigation" }
          : "recovered click navigation";
      }
      if (url.pathname === "/transient-network") {
        return requestNumber < 3 ? { destroySocket: true } : "recovered";
      }
      if (url.pathname === "/persistent-network") {
        return { destroySocket: true };
      }
      if (url.pathname === "/non-transient-status") {
        return { status: 418, headers: {}, body: "do not retry" };
      }
      if (url.pathname === "/forbidden-target") {
        return { status: 403, headers: {}, body: "forbidden" };
      }
      if (url.pathname === "/download-only-entry") {
        return '<main><a href="/download-only-html">Ordinary navigation</a></main>';
      }
      if (url.pathname === "/download-only-redirect") {
        return { status: 302, headers: { location: "/download-only-html" } };
      }
      if (url.pathname === "/download-only-html") {
        return '<main>download-only active HTML</main><script>fetch("/download-active")</script>';
      }
      if (url.pathname === "/retry-terminal-entry") {
        return `<main><a href="/retry-after-terminal">Retry after terminal</a></main><script>
          document.querySelector("a").addEventListener("click", () => {
            setTimeout(() => navigator.serviceWorker.register("/worker.js").catch(() => undefined), 150);
          });
        </script>`;
      }
      if (url.pathname === "/retry-after-terminal") {
        return { status: 503, headers: {}, body: "retry must stop" };
      }
      if (url.pathname === "/blocker-race") {
        return {
          status: 403,
          headers: { "content-type": "text/html; charset=utf-8" },
          body: `<!doctype html><html><body><main>ordinary blocker</main><script>
            setTimeout(() => navigator.serviceWorker.register("/worker.js").catch(() => undefined), 75);
          </script></body></html>`,
        };
      }
      if (scenario === "script") return `<script src="${externalUrl}/script.js"></script>`;
      if (scenario === "data-script") {
        return '<script src="data:text/javascript,document.body.append(`active-data-script-ran`)"></script>';
      }
      if (scenario === "data-document") {
        return '<a id="dataDocument" href="data:text/html,forbidden-document">data document</a><script>dataDocument.click()</script>';
      }
      if (scenario === "xhr") return `<script>fetch(${JSON.stringify(externalUrl)})</script>`;
      if (scenario === "websocket") return `<script>new WebSocket(${JSON.stringify(externalUrl.replace("http:", "ws:"))})</script>`;
      if (scenario === "service-worker") return `<script>navigator.serviceWorker.register("/worker.js")</script>`;
      if (scenario === "popup") return `<script>window.open(${JSON.stringify(externalUrl)})</script>`;
      if (scenario === "download") return `<a id="download" href="/download" download>download</a><script>download.click()</script>`;
      if (scenario === "freeze-after-terminal") {
        return `<script>
          navigator.serviceWorker.register("/worker.js").catch(() => undefined);
          setTimeout(() => {
            document.body.append("post-terminal-script-ran");
            fetch("/after-terminal").catch(() => undefined);
          }, 150);
        </script><main>freeze fixture</main>`;
      }
      if (scenario === "projection-hidden-duplicate") {
        return '<main><p class="projected-value" style="display:none">hidden-secret</p><p class="projected-value">visible-value</p></main>';
      }
      if (scenario === "projection-visible-duplicate") {
        return '<main><p class="projected-value">first</p><p class="projected-value">second</p></main>';
      }
      if (scenario === "projection-relative-anchor") {
        return '<main><a class="projected-value" href="/company/1001">Company 1001</a></main>';
      }
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
    expect(() => new PolicyBrowserSessionFactory({
      allowedOrigins: ["http://example.test"],
      allowedNavigationUrls: ["http://example.test/"],
    }))
      .toThrow("HTTPS");
    expect(() => new PolicyBrowserSessionFactory({
      allowedOrigins: ["https://example.test/path"],
      allowedNavigationUrls: ["https://example.test/"],
    }))
      .toThrow("exact origin");
    expect(() => new PolicyBrowserSessionFactory(testPolicy(allowed.url))).not.toThrow();
  });

  it("launches the reusable policy browser headed by default", async () => {
    const launch = vi.spyOn(chromium, "launch").mockRejectedValueOnce(new Error("headed launch probe"));
    try {
      await expect(new PolicyBrowserSessionFactory(testPolicy(allowed.url)).open())
        .rejects.toThrow("headed launch probe");
      expect(launch).toHaveBeenCalledWith({ headless: false });
    } finally {
      launch.mockRestore();
    }
  });

  it("rejects navigation contracts that are not canonical URLs on an allowed exact origin", () => {
    expect(() => new PolicyBrowserSessionFactory(testPolicy(allowed.url, [
      `${allowed.url}/search#fragment`,
    ]))).toThrow("canonical navigation URL");
    expect(() => new PolicyBrowserSessionFactory(testPolicy(allowed.url, [
      `${external.url}/search`,
    ]))).toThrow("navigation URL origin");
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
    const allowedTarget = `${allowed.url}/?scenario=${scenario}`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [allowedTarget])).open();
    try {
      const target = scenario === "document" ? external.url : allowedTarget;
      await expect(session.navigate(target))
        .rejects.toMatchObject({ origins: expect.any(Array) });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("terminally rejects an active data request and records its typed violation", async () => {
    const target = `${allowed.url}/?scenario=data-script`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      expect(await session.policyViolations()).toContainEqual({
        disposition: "terminal",
        resourceType: "script",
        origin: expect.stringContaining("data:text/javascript"),
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("prevalidates data document navigation before page.goto", async () => {
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url)).open();
    try {
      await expect(session.navigate("data:text/html,forbidden"))
        .rejects.toMatchObject({ origins: ["data:text/html,forbidden"] });
      expect(await session.policyViolations()).toContainEqual({
        disposition: "terminal",
        resourceType: "document",
        origin: "data:text/html,forbidden",
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("terminally rejects a page-activated data document before browser navigation", async () => {
    const target = `${allowed.url}/?scenario=data-document`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      expect(await session.policyViolations()).toContainEqual({
        disposition: "terminal",
        resourceType: "document",
        origin: "data:text/html,forbidden-document",
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it.each([
    ["same-origin", "/same-origin-redirect", () => allowed.requestCount("/forbidden-target")],
    ["cross-origin", "/external-redirect", () => external.requestCount("/forbidden-target")],
  ] as const)("invokes a %s redirect but blocks its forbidden destination before dispatch", async (
    _case,
    path,
    forbiddenRequests,
  ) => {
    const target = `${allowed.url}${path}`;
    const beforeRedirect = allowed.requestCount(path);
    const beforeForbidden = forbiddenRequests();
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      expect(allowed.requestCount(path) - beforeRedirect).toBe(1);
      expect(forbiddenRequests() - beforeForbidden).toBe(0);
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("blocks an unauthorized same-origin download before its endpoint receives a request", async () => {
    const target = `${allowed.url}/?scenario=download`;
    const before = allowed.requestCount("/download");
    const session = await new PolicyBrowserSessionFactory({
      ...testPolicy(allowed.url, [target]),
      allowedDownloadOrigins: [allowed.url],
    }).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      expect(allowed.requestCount("/download") - before).toBe(0);
      expect(await session.policyViolations()).toContainEqual({
        disposition: "terminal",
        resourceType: "download",
        origin: `${allowed.url}/download`,
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("dispatches only a download URL authorized by the separate exact contract", async () => {
    const target = `${allowed.url}/?scenario=download`;
    const downloadUrl = `${allowed.url}/download`;
    const before = allowed.requestCount("/download");
    const session = await new PolicyBrowserSessionFactory({
      ...testPolicy(allowed.url, [target]),
      allowedDownloadUrls: [downloadUrl],
    }).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(200);
      expect(allowed.requestCount("/download") - before).toBe(1);
      expect(await session.policyViolations()).not.toContainEqual(expect.objectContaining({
        resourceType: "download",
      }));
    } finally {
      await session.close();
    }
  });

  it.each([
    ["visible link", "/download-only-entry"],
    ["redirect", "/download-only-redirect"],
  ] as const)("never treats a download-only URL as ordinary %s authorization", async (
    kind,
    entryPath,
  ) => {
    const entryUrl = `${allowed.url}${entryPath}`;
    const downloadOnlyUrl = `${allowed.url}/download-only-html`;
    const beforeDocument = allowed.requestCount("/download-only-html");
    const beforeActive = allowed.requestCount("/download-active");
    const session = await new PolicyBrowserSessionFactory({
      ...testPolicy(allowed.url, [entryUrl]),
      allowedDownloadUrls: [downloadOnlyUrl],
    }).open();
    try {
      if (kind === "visible link") {
        await session.navigate(entryUrl);
        await expect(session.clickLink("Ordinary navigation"))
          .rejects.toMatchObject({ origins: [downloadOnlyUrl] });
      } else {
        await expect(session.navigate(entryUrl))
          .rejects.toMatchObject({ origins: [downloadOnlyUrl] });
      }
      expect(allowed.requestCount("/download-only-html") - beforeDocument).toBe(0);
      expect(allowed.requestCount("/download-active") - beforeActive).toBe(0);
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("surfaces a pre-existing terminal violation instead of acknowledging an ordinary blocker", async () => {
    const target = `${allowed.url}/?scenario=service-worker`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
      await expect(session.captureBlocker({ runId: "ordinary", page: 1 }, "test/1"))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("acknowledges only the exact policy-terminal state supplied by its caller", async () => {
    const target = `${allowed.url}/?scenario=service-worker`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
      await expect(session.captureBlocker(
        { runId: "policy", page: 1 },
        "test/1",
        ["service-worker-registration"],
      )).resolves.toMatchObject({ identity: { runId: "policy", page: 1 } });
    } finally {
      await session.close();
    }
  });

  it("acknowledges a live projection policy block without capturing full-page artifacts", async () => {
    const target = `${allowed.url}/?scenario=service-worker`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      sourceKind: "list-org-live",
    }).open();
    try {
      await expect(session.navigate(target))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
      await expect(session.acknowledgePolicyBlock(["wrong-origin"]))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
      await expect(session.acknowledgePolicyBlock(["service-worker-registration"]))
        .resolves.toEqual({ finalUrl: target, navigationStatus: 200 });
    } finally {
      await session.close();
    }
  });

  it("surfaces a policy terminal that races with ordinary 403 blocker capture", async () => {
    const target = `${allowed.url}/blocker-race`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(403);
      await expect(session.captureBlocker({ runId: "race", page: 1 }, "test/1"))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("freezes page script and later same-origin network activity after a terminal violation", async () => {
    const target = `${allowed.url}/?scenario=freeze-after-terminal`;
    const before = allowed.requestCount("/after-terminal");
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const blocker = await session.captureBlocker(
        { runId: "freeze", page: 1 },
        "test/1",
        ["service-worker-registration"],
      );
      expect(new TextDecoder().decode(blocker.sanitizedDomUtf8)).not.toContain("post-terminal-script-ran");
      expect(allowed.requestCount("/after-terminal") - before).toBe(0);
      await expect(session.hasVisibleText("freeze fixture"))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it.each([
    ["websocket", "websocket"],
    ["service-worker", "service-worker"],
  ] as const)("records a typed %s policy violation", async (scenario, resourceType) => {
    const target = `${allowed.url}/?scenario=${scenario}`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ origins: expect.any(Array) });
      expect(await session.policyViolations()).toContainEqual(expect.objectContaining({
        disposition: "terminal",
        resourceType,
      }));
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it.each([
    ["5xx", "/transient-5xx"],
    ["network error", "/transient-network"],
  ] as const)("retries a transient %s sequentially at most twice", async (_case, path) => {
    const target = `${allowed.url}${path}`;
    const before = allowed.requestCount(path);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      transportRetryDelayMs: 0,
    }).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(200);
      expect(allowed.requestCount(path) - before).toBe(3);
    } finally {
      await session.close();
    }
  });

  it("stops after two retries when a 5xx remains transient", async () => {
    const path = "/persistent-5xx";
    const target = `${allowed.url}${path}`;
    const before = allowed.requestCount(path);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      transportRetryDelayMs: 0,
    }).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(503);
      expect(allowed.requestCount(path) - before).toBe(3);
    } finally {
      await session.close();
    }
  });

  it("propagates an exhausted transient network failure with its typed retry outcome", async () => {
    const path = "/persistent-network";
    const target = `${allowed.url}${path}`;
    const before = allowed.requestCount(path);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      transportRetryDelayMs: 0,
    }).open();
    try {
      await expect(session.navigate(target)).rejects.toMatchObject({ name: "BrowserTransportError" });
      expect(allowed.requestCount(path) - before).toBe(3);
    } finally {
      await session.close();
    }
  });

  it("does not retry a non-transient HTTP failure", async () => {
    const path = "/non-transient-status";
    const target = `${allowed.url}${path}`;
    const before = allowed.requestCount(path);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      transportRetryDelayMs: 0,
    }).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(418);
      expect(allowed.requestCount(path) - before).toBe(1);
    } finally {
      await session.close();
    }
  });

  it("captures only the unique visible projection match when a hidden duplicate precedes it", async () => {
    const target = `${allowed.url}/?scenario=projection-hidden-duplicate`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await session.navigate(target);
      const projection = await session.captureProjection([".projected-value"]);
      const dom = new TextDecoder().decode(projection.sanitizedDomUtf8);
      expect(dom).toContain("visible-value");
      expect(dom).not.toContain("hidden-secret");
    } finally {
      await session.close();
    }
  });

  it("rejects a projection selector with multiple visible matches", async () => {
    const target = `${allowed.url}/?scenario=projection-visible-duplicate`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await session.navigate(target);
      await expect(session.captureProjection([".projected-value"]))
        .rejects.toThrow("projection selector must match exactly one visible element");
    } finally {
      await session.close();
    }
  });

  it("canonicalizes a projected relative anchor against the policy-valid visible page", async () => {
    const target = `${allowed.url}/?scenario=projection-relative-anchor`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await session.navigate(target);
      const projection = await session.captureProjection([".projected-value"]);
      const dom = new TextDecoder().decode(projection.sanitizedDomUtf8);
      expect(dom).toContain(`href="${allowed.url}/company/1001"`);
      expect(dom).not.toContain("<base");
    } finally {
      await session.close();
    }
  });

  it("applies the same sequential retry ceiling to visible link navigation", async () => {
    const entry = `${allowed.url}/retry-entry`;
    const destinationPath = "/click-transient";
    const before = allowed.requestCount(destinationPath);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [
      entry,
      `${allowed.url}${destinationPath}`,
    ]), { transportRetryDelayMs: 0 }).open();
    try {
      await session.navigate(entry);
      await expect(session.clickLink("Retry target")).resolves.toBe(200);
      expect(allowed.requestCount(destinationPath) - before).toBe(3);
    } finally {
      await session.close();
    }
  });

  it("dispatches no retry after a concurrent terminal policy event", async () => {
    const entry = `${allowed.url}/retry-terminal-entry`;
    const retryPath = "/retry-after-terminal";
    const before = allowed.requestCount(retryPath);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [
      entry,
      `${allowed.url}${retryPath}`,
    ]), { transportRetryDelayMs: 300 }).open();
    try {
      await session.navigate(entry);
      await expect(session.clickLink("Retry after terminal"))
        .rejects.toMatchObject({ origins: ["service-worker-registration"] });
      expect(allowed.requestCount(retryPath) - before).toBe(1);
    } finally {
      await session.close().catch(() => undefined);
    }
  });

  it("never retries 403 responses", async () => {
    const path = "/forbidden-target";
    const target = `${allowed.url}${path}`;
    const before = allowed.requestCount(path);
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target]), {
      transportRetryDelayMs: 0,
    }).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(403);
      expect(allowed.requestCount(path) - before).toBe(1);
    } finally {
      await session.close();
    }
  });

  it("logs and aborts passive cross-origin resources without failing navigation", async () => {
    const target = `${allowed.url}/?scenario=passive`;
    const session = await new PolicyBrowserSessionFactory(testPolicy(allowed.url, [target])).open();
    try {
      await expect(session.navigate(target)).resolves.toBe(200);
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

function testPolicy(origin: string, allowedNavigationUrls: readonly string[] = [`${origin}/`]): BrowserOriginPolicy {
  return {
    allowedOrigins: [origin],
    allowedNavigationUrls,
    allowInsecureHttpForTesting: true,
  };
}

interface LocalServer {
  url: string;
  requestCount(pathname: string): number;
  close(): Promise<void>;
}

type LocalServerResponse = string | {
  status: number;
  headers: Record<string, string>;
  body?: string;
} | {
  destroySocket: true;
};

async function startServer(
  handler: (request: IncomingMessage, requestNumber: number) => LocalServerResponse,
): Promise<LocalServer> {
  const requestCounts = new Map<string, number>();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    const requestNumber = (requestCounts.get(pathname) ?? 0) + 1;
    requestCounts.set(pathname, requestNumber);
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
    const output = handler(request, requestNumber);
    if (typeof output !== "string" && "destroySocket" in output) {
      request.socket.destroy();
      return;
    }
    if (typeof output === "string") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>${output}</body></html>`);
      return;
    }
    response.writeHead(output.status, output.headers);
    response.end(output.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not allocate a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requestCount: (pathname) => requestCounts.get(pathname) ?? 0,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
