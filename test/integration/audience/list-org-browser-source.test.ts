import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

import type { BrowserSessionFactory } from "../../../src/modules/audience/application/ports/browser-session";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import {
  startListOrgFixtureServer,
  type ListOrgFixtureServer,
} from "../../support/list-org-fixture-server";

describe("ListOrgBrowserSource", () => {
  let fixture: ListOrgFixtureServer;

  beforeAll(async () => {
    fixture = await startListOrgFixtureServer();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("discovers unique companies in first-seen order through visible result pages", async () => {
    const result = await collect("/search");

    expect(result.status, result.reason).toBe("succeeded");
    expect(result.companies.map((company) => company.inn)).toEqual([
      "7707083893",
      "7710140679",
      "7704217370",
    ]);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.every((page) => page.raw.checksumSha256.length === 64)).toBe(true);
  });

  it("retains every duplicate occurrence while exposing one first-seen company", async () => {
    const result = await collect("/search");

    expect(result.pages.map((page) => page.occurrences.map((item) => item.sourceRecordKey))).toEqual([
      ["1001", "1002"],
      ["1002", "1003"],
    ]);
    expect(result.pages.flatMap((page) => page.occurrences).every(
      (item) => item.resultFingerprintBefore === item.resultFingerprintAfter,
    )).toBe(true);
    expect(result.companies.filter((company) => company.sourceRecordKey === "1002")).toHaveLength(1);
  });

  it("links each discovered row to a checksummed raw bundle and parser version", async () => {
    const result = await collect("/search");

    for (const company of result.companies) {
      const raw = result.rawBundles.find((bundle) => bundle.checksumSha256 === company.rawFetchKey);
      expect(raw, company.sourceRecordKey).toBeDefined();
      expect(company.parserVersion).toBe("list-org-browser/1.0.0");
      expect(raw?.parserVersion).toBe(company.parserVersion);
      expect(JSON.parse(new TextDecoder().decode(raw?.manifestUtf8))).toMatchObject({
        parserVersion: company.parserVersion,
      });
    }
  });

  it.each([
    ["CAPTCHA landmark", "/captcha", "captcha"],
    ["HTTP 403", "/forbidden", "http_403"],
    ["HTTP 200 soft block", "/soft-block", "soft_block"],
    ["missing required visible controls", "/contract-drift", "contract_drift"],
  ])("reports %s as blocked", async (_case, path, reason) => {
    const result = await collect(path);

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(reason);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["invalid legal-entity INN", "invalid-inn", "invalid_inn"],
    ["ambiguous OKVED", "ambiguous-okved", "ambiguous_okved"],
    ["OKVED outside requested scope", "mismatched-okved", "mismatched_okved"],
    ["unknown OKVED role", "unknown-role", "unknown_okved_role"],
  ])("turns %s into a typed record reject", async (_case, scenario, reason) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status, result.reason).toBe("succeeded");
    expect(result.companies.map((company) => company.sourceRecordKey)).toEqual(["1002", "1003"]);
    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0]).toMatchObject({ sourceRecordKey: "1001", reason });
    expect(result.rejects[0]?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks a duplicate source record whose normalized organization fields conflict", async () => {
    const result = await collect("/search?scenario=conflicting-duplicate");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("duplicate_conflict");
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({
      reason: "duplicate_conflict",
      sourceRecordKey: "1002",
    });
  });

  it.each([
    "accepted-then-rejected",
    "rejected-then-accepted",
    "rejected-reason-conflict",
  ])("blocks order-independent duplicate conflict for %s", async (scenario) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("duplicate_conflict");
    expect(result.blockers).toEqual([
      expect.objectContaining({
        reason: "duplicate_conflict",
        sourceRecordKey: "1002",
        raw: expect.objectContaining({ checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      }),
    ]);
  });

  it("removes a conflicted duplicate from companies and rejects in either arrival order", async () => {
    const [acceptedThenRejected, rejectedThenAccepted] = await Promise.all([
      collect("/search?scenario=accepted-then-rejected"),
      collect("/search?scenario=rejected-then-accepted"),
    ]);

    const expected = {
      companies: [{
        sourceRecordKey: "1001",
        inn: "7707083893",
        name: "ООО «Альфа Строй»",
        website: "https://alpha.example",
        phone: "+7 (495) 111-22-33",
        email: "info@alpha.example",
        okvedCode: "43.11",
        isPrimary: true,
        parserVersion: "list-org-browser/1.0.0",
      }],
      rejects: [],
      counts: { occurrences: 2, uniqueSourceRecords: 2, accepted: 1, duplicates: 0, rejected: 0 },
    };
    expect(domainProjection(acceptedThenRejected)).toEqual(expected);
    expect(domainProjection(rejectedThenAccepted)).toEqual(expected);
  });

  it("collapses an identical rejected duplicate by source key and reason", async () => {
    const result = await collect("/search?scenario=duplicate-rejected-same");

    expect(result.status, result.reason).toBe("succeeded");
    expect(result.rejects.filter((item) => item.sourceRecordKey === "1002"))
      .toHaveLength(1);
  });

  it("surfaces a 403 response reached through the search button with blocker evidence", async () => {
    const result = await collect("/search?scenario=403-after-click");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("http_403");
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.raw.navigationStatus).toBe(403);
    expect(result.blockers[0]?.raw.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "click-button",
        outcome: "completed",
        navigationStatus: 403,
      }),
    ]));
  });

  it("blocks a rendered search scope mismatch and retains checksummed evidence", async () => {
    const result = await collect("/search?scenario=mismatched-scope");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("contract_drift");
    expect(result.blockers[0]?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never reports success when the terminal pagination marker is absent", async () => {
    const result = await collect("/search?scenario=missing-terminal");

    expect(result.status).toBe("limited");
    expect(result.reason).toBe("max_pages");
  });

  it("closes partially started browser resources when context creation fails", async () => {
    const closeBrowser = vi.fn(async () => undefined);
    const factory = new PlaywrightBrowserSessionFactory(fixture.origin, {
      launch: async () => ({
        newContext: async () => { throw new Error("context startup failed"); },
        close: closeBrowser,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("context startup failed");
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("closes context and browser when session page creation fails", async () => {
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);
    const factory = new PlaywrightBrowserSessionFactory(fixture.origin, {
      launch: async () => ({
        newContext: async () => ({
          routeWebSocket: async () => undefined,
          newPage: async () => { throw new Error("page startup failed"); },
          close: closeContext,
        }),
        close: closeBrowser,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("page startup failed");
    expect(closeContext).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("installs WebSocket routing before page creation and cleans up registration failure", async () => {
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);
    const newPage = vi.fn(async () => {
      throw new Error("page created before WebSocket routing");
    });
    const factory = new PlaywrightBrowserSessionFactory(fixture.origin, {
      launch: async () => ({
        newContext: async () => ({
          routeWebSocket: async () => { throw new Error("WebSocket route startup failed"); },
          newPage,
          close: closeContext,
        }),
        close: closeBrowser,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("WebSocket route startup failed");
    expect(newPage).not.toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("blocks contract drift when a singleton identity field has conflicting duplicates", async () => {
    const result = await collect("/search?scenario=conflicting-identity");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("contract_drift");
    expect(result.companies).toEqual([]);
  });

  it.each([
    ["maxPages", 1.5],
    ["maxPages", Number.NaN],
    ["maxPages", Number.POSITIVE_INFINITY],
    ["maxPages", Number.MAX_SAFE_INTEGER + 1],
    ["maxCompanies", 1.5],
    ["maxCompanies", Number.NaN],
    ["maxCompanies", Number.POSITIVE_INFINITY],
    ["maxCompanies", Number.MAX_SAFE_INTEGER + 1],
  ] as const)("rejects invalid %s value %s before opening a browser", async (field, value) => {
    const sessions: BrowserSessionFactory = {
      open: async () => {
        throw new Error("browser opened for invalid limits");
      },
    };
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}/search`,
      sessions,
      runId: "invalid-limits",
      parserVersion: "list-org-browser/1.0.0",
    });

    await expect(source.collect({
      okved: parseOkvedCode("43.11"),
      onlyActive: true,
      maxPages: field === "maxPages" ? value : 2,
      maxCompanies: field === "maxCompanies" ? value : 50,
    })).rejects.toThrow("discovery limits must be positive safe integers");
  });

  it("blocks an external request and preserves its sanitized origin in blocker evidence", async () => {
    const result = await collect("/search?scenario=external");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("policy_block");
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ detail: "https://external.invalid" });
    expect(result.blockers[0]?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks an external WebSocket before its upgrade reaches the second origin", async () => {
    const probe = await startExternalWebSocketProbe();
    const websocketFixture = await startListOrgFixtureServer({
      externalWebSocketUrl: probe.url,
    });
    try {
      const result = await collect(
        "/search?scenario=external-websocket",
        undefined,
        websocketFixture.origin,
      );

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("policy_block");
      expect(result.blockers).toEqual([
        expect.objectContaining({
          reason: "policy_block",
          detail: new URL(probe.url).origin,
          raw: expect.objectContaining({
            checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        }),
      ]);
      expect(probe.upgradeCount()).toBe(0);
    } finally {
      await websocketFixture.close();
      await probe.close();
    }
  });

  it("allows a WebSocket on the configured fixture origin", async () => {
    const before = fixture.webSocketUpgradeCount();

    const result = await collect("/search?scenario=same-origin-websocket");

    expect(result.status, result.reason).toBe("succeeded");
    expect(fixture.webSocketUpgradeCount()).toBeGreaterThan(before);
  });

  it("keeps contacts only in the company record and redacts every contact box from raw artifacts", async () => {
    const result = await collect(
      "/search?token=topsecret&tenant_secret=customsecret",
      ["tenant_secret"],
    );
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    expect(card).toBeDefined();

    const company = result.companies.find((item) => item.sourceRecordKey === "1001");
    expect(company).toMatchObject({
      phone: "+7 (495) 111-22-33",
      email: "info@alpha.example",
    });

    const dom = new TextDecoder().decode(card?.sanitizedDomUtf8);
    const manifest = new TextDecoder().decode(card?.manifestUtf8);
    expect(`${dom}\n${manifest}`).not.toMatch(
      /\+7 \(495\) (?:111-22-33|222-33-44)|(?:info|backup)@alpha\.example/i,
    );
    expect(dom).not.toMatch(/secretToken|must-not-be-captured|hidden secret|data-secret|topsecret/);
    expect(JSON.stringify(card?.actions)).not.toMatch(/topsecret|customsecret/);
    expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBe(4);
  });

  it("removes contacts and secrets from links, metadata, aria, comments, duplicate text, actions, and screenshot", async () => {
    const result = await collect(
      "/search?scenario=redaction-surfaces&token=default-secret&tenant_secret=configured-secret&client_secret=unconfigured-secret",
      ["tenant_secret"],
    );
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    expect(card).toBeDefined();

    const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
    const manifest = new TextDecoder().decode(card!.manifestUtf8);
    const allTextualEvidence = `${dom}\n${manifest}\n${JSON.stringify(card!.actions)}`;
    expect(allTextualEvidence).not.toMatch(
      /(?:info|backup)@alpha\.example|\+7 \(495\) (?:111-22-33|222-33-44)|default-secret|configured-secret|unconfigured-secret/i,
    );
    expect(dom).not.toMatch(/<!--|<meta\b|mailto:|aria-label|data-copy|data-contact|\btitle=/i);
    expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBeGreaterThanOrEqual(6);
  });

  it("removes runtime form values from raw evidence and masks every populated control", async () => {
    const [result, baseline] = await Promise.all([
      collect("/search?scenario=form-secrets"),
      collect("/search"),
    ]);
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    const baselineCard = baseline.rawBundles.find(
      (bundle) => bundle.identity.sourceRecordKey === "1001",
    );
    expect(card).toBeDefined();
    expect(baselineCard).toBeDefined();

    const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
    const evidence = `${dom}\n${new TextDecoder().decode(card!.manifestUtf8)}`;
    expect(evidence).not.toMatch(/pw-123|csrf-123|api-123|visible-123/i);
    expect(dom).not.toMatch(/\svalue=|name="(?:password|csrf_token|api_key)"/i);
    expect(dom).toContain('<input type="text" name="public_field">');
    const formBands = await countBlackContactBands(card!.redactedScreenshotPng);
    const baselineBands = await countBlackContactBands(baselineCard!.redactedScreenshotPng);
    expect(formBands).toBe(baselineBands + 4);
  });

  it("persists configured-only form policy while removing its control from evidence", async () => {
    const result = await collect("/search?scenario=configured-form-secret", ["nonce"]);
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    expect(card).toBeDefined();

    const evidence = `${new TextDecoder().decode(card!.sanitizedDomUtf8)}\n${
      new TextDecoder().decode(card!.manifestUtf8)
    }`;
    expect(evidence).not.toMatch(/name="nonce"|nonce-123/i);
    expect(card!.sensitiveFormFieldNames).toContain("nonce");
    expect(JSON.parse(new TextDecoder().decode(card!.manifestUtf8))).toMatchObject({
      sensitiveFormFieldNames: expect.arrayContaining(["nonce"]),
    });
  });

  it("masks empty password, configured-name controls, and buttons with visible placeholders", async () => {
    const [result, baseline] = await Promise.all([
      collect("/search?scenario=empty-form-secret", ["nonce"]),
      collect("/search", ["nonce"]),
    ]);
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    const baselineCard = baseline.rawBundles.find(
      (bundle) => bundle.identity.sourceRecordKey === "1001",
    );
    expect(card).toBeDefined();
    expect(baselineCard).toBeDefined();

    const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
    expect(dom).not.toMatch(
      /password reminder|nonce reminder|nonce button reminder|name="(?:password|nonce)"/i,
    );
    expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBe(
      await countBlackContactBands(baselineCard!.redactedScreenshotPng) + 3,
    );
  });

  async function collect(
    path: string,
    sensitiveQueryParameters?: readonly string[],
    fixtureOrigin = fixture.origin,
  ) {
    const fixedNow = () => new Date("2026-08-24T09:00:00.000Z");
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixtureOrigin}${path}`,
      sessions: new PlaywrightBrowserSessionFactory(fixtureOrigin, {
        now: fixedNow,
        sensitiveQueryParameters,
      }),
      runId: `browser-${new URL(path, "http://fixture.invalid").pathname.replace(/[^a-z]+/gi, "-")}`,
      parserVersion: "list-org-browser/1.0.0",
    });

    return source.collect({
      okved: parseOkvedCode("43.11"),
      onlyActive: true,
      maxPages: 2,
      maxCompanies: 50,
    });
  }
});

interface ExternalWebSocketProbe {
  url: string;
  upgradeCount(): number;
  close(): Promise<void>;
}

async function startExternalWebSocketProbe(): Promise<ExternalWebSocketProbe> {
  let upgrades = 0;
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (_request, socket) => {
    upgrades += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("external WebSocket probe did not allocate a TCP port");
  }
  return {
    url: `ws://127.0.0.1:${address.port}/external-websocket`,
    upgradeCount: () => upgrades,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function countBlackContactBands(png: Uint8Array): Promise<number> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("2D canvas is unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rowsWithContactWidth = new Set<number>();
      for (let y = 0; y < canvas.height; y += 1) {
        let current = 0;
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels[offset] === 0 && pixels[offset + 1] === 0 && pixels[offset + 2] === 0) {
            current += 1;
            if (current >= 200) rowsWithContactWidth.add(y);
          } else {
            current = 0;
          }
        }
      }
      let bands = 0;
      let previous = -2;
      for (const row of [...rowsWithContactWidth].sort((left, right) => left - right)) {
        if (row !== previous + 1) bands += 1;
        previous = row;
      }
      return bands;
    }, Buffer.from(png).toString("base64"));
  } finally {
    await browser.close();
  }
}

function domainProjection(result: Awaited<ReturnType<ListOrgBrowserSource["collect"]>>) {
  const occurrences = result.pages.flatMap((page) => page.occurrences);
  return {
    companies: result.companies.map(({ rawFetchKey: _rawFetchKey, ...company }) => company),
    rejects: result.rejects.map(({ raw: _raw, ...reject }) => reject),
    counts: {
      occurrences: occurrences.length,
      uniqueSourceRecords: new Set(occurrences.map((item) => item.sourceRecordKey)).size,
      accepted: result.companies.length,
      duplicates: occurrences.length - new Set(occurrences.map((item) => item.sourceRecordKey)).size,
      rejected: result.rejects.length,
    },
  };
}
