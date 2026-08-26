import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

import type { BrowserSessionFactory } from "../../../src/modules/audience/application/ports/browser-session";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import { assertSanitizedPageDomSafe } from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
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

  it("binds every screenshot to exactly one ordered sanitized-DOM proof pair", async () => {
    const result = await collect("/search");

    for (const raw of result.rawBundles) {
      const proof = raw.actions.filter((action) => action.kind === "verify-visual-safety");
      expect(proof).toHaveLength(2);
      expect(proof.map((action) => action.outcome)).toEqual(["intent", "completed"]);
      expect(new Set(proof.map((action) => action.id)).size).toBe(1);
      expect(new Set(proof.map((action) => action.target))).toEqual(new Set([
        `sanitized-inert-render-policy/1;page-fingerprint-sha256=${raw.pageFingerprintSha256}`,
      ]));
    }
  });

  it("captures only an allowlisted company-card projection and rejects a sensitive retained value", async () => {
    const session = await new PlaywrightBrowserSessionFactory(fixture.origin).open();
    try {
      await session.navigate(`${fixture.origin}/company/1001?from=1&scenario=projection-card`);
      const projection = await session.captureProjection([
        'main[aria-label="Карточка организации"] > dl > dt:nth-of-type(2)',
        'main[aria-label="Карточка организации"] > dl > dd:nth-of-type(2)',
        'main[aria-label="Карточка организации"] > dl > dt:nth-of-type(9)',
        'main[aria-label="Карточка организации"] > dl > dd:nth-of-type(9)',
      ]);
      const dom = new TextDecoder().decode(projection.sanitizedDomUtf8);

      expect(dom).toContain("ИНН");
      expect(dom).toContain("7707083893");
      expect(dom).toContain("ОКВЭД");
      expect(dom).toContain("43.11");
      expect(dom).not.toMatch(/Телефон|Email|Иван Петров|Страница компании|111-22-33/);
      expect(() => assertSanitizedPageDomSafe(
        new TextEncoder().encode(dom.replace("7707083893", "sensitive@example.test")),
        projection.sensitiveFormFieldNames,
        [],
      )).toThrow("raw redaction scan failed");
    } finally {
      await session.close();
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
      counts: {
        occurrences: 3,
        uniqueSourceRecords: 2,
        accepted: 1,
        duplicates: 1,
        rejected: 0,
        blockedOrConflicted: 1,
      },
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

  it("preserves parsed occurrences before a mid-page 403 blocker", async () => {
    const result = await collect("/search?scenario=mid-page-403");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("http_403");
    expect(result.pages).toEqual([
      expect.objectContaining({
        page: 1,
        occurrences: [expect.objectContaining({ sourceRecordKey: "1001" })],
      }),
    ]);
    expect(result.companies.map((company) => company.sourceRecordKey)).toEqual(["1001"]);
  });

  it("does not copy a completed page's occurrences into a newly blocked page", async () => {
    const result = await collect("/search?scenario=page-2-soft-block");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("soft_block");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({
      page: 1,
      occurrences: [
        expect.objectContaining({ sourceRecordKey: "1001" }),
        expect.objectContaining({ sourceRecordKey: "1002" }),
      ],
    });
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

  it.each([
    ["a no-op Next link", "pagination-no-op"],
    ["a repeated page carrying a stale terminal marker", "pagination-repeated-terminal"],
    ["a reordered overlap after the page boundary", "pagination-reordered-boundary"],
    ["a skip to a later terminal page", "pagination-skips-page"],
  ])("blocks pagination contract drift for %s", async (_case, scenario) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("contract_drift");
    expect(result.blockers.at(-1)?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
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

  it("isolates live collection from a scriptless, network-blocked screenshot context", async () => {
    const newContext = vi.fn(async () => ({
      routeWebSocket: async () => { throw new Error("context options captured"); },
      close: async () => undefined,
    }));
    const factory = new PlaywrightBrowserSessionFactory(fixture.origin, {
      launch: async () => ({
        newContext,
        close: async () => undefined,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("context options captured");
    expect(newContext).toHaveBeenNthCalledWith(1, {
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    expect(newContext).toHaveBeenNthCalledWith(2, {
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: false,
    });
  });

  it("closes context and browser when session page creation fails", async () => {
    const closeContext = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);
    const factory = new PlaywrightBrowserSessionFactory(fixture.origin, {
      launch: async () => ({
        newContext: async () => ({
          routeWebSocket: async () => undefined,
          exposeBinding: async () => undefined,
          addInitScript: async () => undefined,
          route: async () => undefined,
          newPage: async () => { throw new Error("page startup failed"); },
          close: closeContext,
        }),
        close: closeBrowser,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("page startup failed");
    expect(closeContext).toHaveBeenCalledTimes(2);
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
          addInitScript: async () => undefined,
          newPage,
          close: closeContext,
        }),
        close: closeBrowser,
      }) as never,
    });

    await expect(factory.open()).rejects.toThrow("WebSocket route startup failed");
    expect(newPage).not.toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalledTimes(2);
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

  it("continues after a blocked passive external image without persisting it", async () => {
    const result = await collect("/search?scenario=external");

    expect(result.status, result.reason).toBe("succeeded");
    expect(result.blockers).toEqual([]);
    expect(new TextDecoder().decode(result.rawBundles[0]!.sanitizedDomUtf8))
      .not.toContain("external.invalid");
  });

  it("blocks service workers before navigation and proves their external fetch made no connection", async () => {
    const probe = await startExternalHttpProbe();
    const isolatedFixture = await startListOrgFixtureServer({ externalHttpUrl: probe.url });
    try {
      const result = await collect(
        "/search?scenario=service-worker-external",
        undefined,
        isolatedFixture.origin,
      );

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("policy_block");
      expect(result.blockers.at(-1)).toMatchObject({
        detail: "service-worker-registration",
        raw: expect.objectContaining({
          checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      });
      expect(probe.requestCount()).toBe(0);
    } finally {
      await isolatedFixture.close();
      await probe.close();
    }
  });

  it("turns a caught service-worker registration rejection into durable policy evidence", async () => {
    const result = await collect("/search?scenario=service-worker-caught");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("policy_block");
    expect(result.blockers.at(-1)).toMatchObject({
      detail: "service-worker-registration",
      raw: expect.objectContaining({
        checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    });
  });

  it.each([
    ["popup", "popup-side-channel", "secondary-page"],
    ["download", "download-side-channel", "download"],
  ])("blocks the %s browser side channel with durable blocker evidence", async (
    _case,
    scenario,
    evidence,
  ) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("policy_block");
    expect(result.blockers.at(-1)?.detail).toContain(evidence);
    expect(result.blockers.at(-1)?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
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
    expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBe(0);
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
    expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBe(0);
  });

  it("strips URL userinfo and fragments from every retained browser URL surface", async () => {
    const result = await collect(
      "/search?scenario=unsafe-url-components#token=action-fragment",
    );
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    const company = result.companies.find((item) => item.sourceRecordKey === "1001");
    expect(card).toBeDefined();
    expect(company?.website).toBe("https://localhost/profile?public=kept");
    expect(card?.finalUrl).not.toMatch(/#|userinfo-name|userinfo-pass/);
    expect(card?.actions.map((action) => action.target).join("\n")).not.toMatch(
      /action-fragment|userinfo-name|userinfo-pass/,
    );

    const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
    expect(dom).toContain('href="https://localhost/public?kept=yes"');
    expect(dom).not.toContain("action-fragment");
    expect(dom).not.toMatch(/candidate-fragment|dom-fragment|userinfo-name|userinfo-pass/);
    expect(JSON.parse(new TextDecoder().decode(card!.manifestUtf8))).toMatchObject({
      candidateEvidence: {
        website: "https://localhost/profile?public=kept",
      },
    });
  });

  it.each([
    ["success", "action-ledger-secret", "succeeded"],
    ["failure", "action-ledger-secret-failure", "blocked"],
  ])("collects DOM-only href secrets before %s-path action recording", async (
    _case,
    scenario,
    status,
  ) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status).toBe(status);
    expect(JSON.stringify(result.rawBundles.flatMap((raw) => raw.actions))).not.toContain(
      "dom-only-action-secret",
    );
  });

  it("derives DOM and screenshot redaction terms from every live retained href", async () => {
    const [result, baseline] = await Promise.all([
      collect("/search?scenario=href-only-url-secrets"),
      collect("/search"),
    ]);
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const baselineCard = baseline.rawBundles.find(
      (item) => item.identity.sourceRecordKey === "1001",
    )!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(dom).toContain('href="https://localhost/public"');
    expect(dom).not.toMatch(/href-user|href-pass|href-query-secret|href-fragment-secret/);
    expect(await countBlackContactBands(card.redactedScreenshotPng)).toBe(
      await countBlackContactBands(baselineCard.redactedScreenshotPng),
    );
  });

  it("collects non-anchor href values so duplicated DOM text and pixels cannot leak", async () => {
    const result = await collect("/search?scenario=non-anchor-href-secrets");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);
    const leakingElementPixel = { x: 420 + 260 - 10, y: 80 + (32 / 2) };

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).toContain('<button href="https://localhost/public">Public action</button>');
    expect(dom).toMatch(/href="http:\/\/127\.0\.0\.1:\d+\/results\/page-1\?okved=43\.11&amp;status=work&amp;scenario=non-anchor-href-secrets"/u);
    expect({
      domContainsSecret: /non-anchor-user|non-anchor-pass|non-anchor-query|non-anchor-fragment/iu
        .test(dom),
      leakingElementPixelIsBlack: await isBlackPixel(
        card.redactedScreenshotPng,
        leakingElementPixel.x,
        leakingElementPixel.y,
      ),
    }).toEqual({
      domContainsSecret: false,
      leakingElementPixelIsBlack: false,
    });
  });

  it("redacts an href-derived term split across descendant text at its rendered container", async () => {
    const result = await collect("/search?scenario=split-href-secret");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);
    const leakingElementPixel = { x: 420 + 260 - 10, y: 150 + (32 / 2) };

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).toContain('<a href="https://localhost/public">Public fragment</a>');
    expect(dom).toMatch(/href="http:\/\/127\.0\.0\.1:\d+\/results\/page-1\?okved=43\.11&amp;status=work&amp;scenario=split-href-secret"/u);
    expect({
      domContainsContiguousSecret: dom.includes("href-fragment-secret"),
      domContainsSplitSecret: /href-(?:<[^>]+>)*fragment-secret/iu.test(dom),
      leakingElementPixelIsBlack: await isBlackPixel(
        card.redactedScreenshotPng,
        leakingElementPixel.x,
        leakingElementPixel.y,
      ),
    }).toEqual({
      domContainsContiguousSecret: false,
      domContainsSplitSecret: false,
      leakingElementPixelIsBlack: false,
    });
  });

  it("maps a Unicode-folded split term back to its original rendered container", async () => {
    const result = await collect("/search?scenario=unicode-split-href-secret");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).not.toMatch(/İf(?:<[^>]+>)*oo-unique-secret/iu);
    expect(await isBlackPixel(card.redactedScreenshotPng, 420 + 250, 220 + 16)).toBe(false);
    expect(await isBlackPixel(card.redactedScreenshotPng, 300, 236)).toBe(false);
  });

  it("does not let a sensitive body attribute create a page-wide overlay", async () => {
    const result = await collect("/search?scenario=body-attribute-href-secret");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;

    expect(result.status, result.reason).toBe("succeeded");
    expect(await isBlackPixel(card.redactedScreenshotPng, 760, 560)).toBe(false);
  });

  it("does not join hidden and separately rendered nodes into a page-wide redaction", async () => {
    const result = await collect("/search?scenario=hidden-boundary-href-secret");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).toContain("Unrelated retained marker");
    expect(dom).toContain("visible-secret");
    expect(await isBlackPixel(card.redactedScreenshotPng, 760, 560)).toBe(false);
  });

  it("masks a generic email split across light-DOM descendants", async () => {
    const result = await collect("/search?scenario=split-generic-contact");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).not.toMatch(/operator@(?:<[^>]+>)*example\.test/iu);
    expect(await isBlackPixel(card.redactedScreenshotPng, 700, 436)).toBe(false);
  });

  it.each([
    ["inline SVG", "painted-svg"],
    ["open shadow root", "painted-shadow-open"],
    ["closed shadow-root attempt", "painted-shadow-closed"],
    ["generated content", "painted-generated"],
    ["canvas", "painted-canvas"],
    ["data image", "painted-image"],
    ["video", "painted-video"],
    ["data background image", "painted-background-data"],
  ])("removes an untrusted %s painted surface before inert rendering", async (
    _case,
    scenario,
  ) => {
    const result = await collect(`/search?scenario=${scenario}`);

    expect(result.status, result.reason).toBe("succeeded");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    expect(card.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(new TextDecoder().decode(card.sanitizedDomUtf8)).not.toContain(
      "operator@example.test",
    );
    const proof = card.actions.filter((action) => action.kind === "verify-visual-safety");
    expect(proof.map((action) => action.target)).toEqual([
      `sanitized-inert-render-policy/1;page-fingerprint-sha256=${card.pageFingerprintSha256}`,
      `sanitized-inert-render-policy/1;page-fingerprint-sha256=${card.pageFingerprintSha256}`,
    ]);
  });

  it("renders the sanitized snapshot even when the live page mutates immediately afterward", async () => {
    const result = await collect("/search?scenario=mutation-after-sanitized-snapshot");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;

    expect(result.status, result.reason).toBe("succeeded");
    expect(new TextDecoder().decode(card.sanitizedDomUtf8)).not.toContain(
      "late-mutation@example.test",
    );
    expect(await isRedPixel(card.redactedScreenshotPng, 780, 40)).toBe(false);
  });

  it("strips declarative shadow and CSS image surfaces from the inert screenshot", async () => {
    const result = await collect("/search?scenario=painted-declarative-css");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).not.toMatch(/template|shadowrootmode|mask-image|border-image|list-style-image/iu);
    expect(await isRedPixel(card.redactedScreenshotPng, 780, 100)).toBe(false);
  });

  it("removes non-http href schemes while retaining canonical safe relative navigation", async () => {
    const result = await collect("/search?scenario=unsafe-protocol-hrefs");
    const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
    const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

    expect(result.status, result.reason).toBe("succeeded");
    expect(dom).not.toMatch(/href="(?:javascript|data|file):/iu);
    expect(dom).toMatch(/href="http:\/\/127\.0\.0\.1:\d+\/relative-safe"/u);
    expect(dom).toContain('href="http://localhost/public"');
  });

  it("blocks a non-http candidate website before candidate evidence publication", async () => {
    const result = await collect("/search?scenario=unsafe-candidate-website");

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("contract_drift");
    expect(result.companies).toEqual([]);
    expect(result.rawBundles.every((raw) => raw.candidateEvidence === null)).toBe(true);
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
    expect(formBands).toBe(baselineBands);
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
      await countBlackContactBands(baselineCard!.redactedScreenshotPng),
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

interface ExternalHttpProbe {
  url: string;
  requestCount(): number;
  close(): Promise<void>;
}

async function startExternalHttpProbe(): Promise<ExternalHttpProbe> {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(204, { "access-control-allow-origin": "*" });
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("external HTTP probe did not allocate a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/service-worker-probe`,
    requestCount: () => requests,
    close: () => closeServer(server),
  };
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

async function isBlackPixel(png: Uint8Array, x: number, y: number): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ base64, sampleX, sampleY }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("2D canvas is unavailable");
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
      return pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0;
    }, {
      base64: Buffer.from(png).toString("base64"),
      sampleX: x,
      sampleY: y,
    });
  } finally {
    await browser.close();
  }
}

async function isRedPixel(png: Uint8Array, x: number, y: number): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ base64, sampleX, sampleY }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("2D canvas is unavailable");
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
      return pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50;
    }, {
      base64: Buffer.from(png).toString("base64"),
      sampleX: x,
      sampleY: y,
    });
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
      blockedOrConflicted: new Set(
        result.blockers.flatMap((blocker) =>
          blocker.sourceRecordKey === undefined ? [] : [blocker.sourceRecordKey]
        ),
      ).size,
    },
  };
}
