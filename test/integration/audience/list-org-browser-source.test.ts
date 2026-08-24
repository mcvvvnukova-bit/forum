import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import type { BrowserSessionFactory } from "../../../src/modules/audience/application/ports/browser-session";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import {
  ListOrgBrowserSource,
  ExternalBrowserRequestError,
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
  });

  it("never reports success when the terminal pagination marker is absent", async () => {
    const result = await collect("/search?scenario=missing-terminal");

    expect(result.status).toBe("limited");
    expect(result.reason).toBe("max_pages");
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

  it("fails collection when a page attempts a request outside the fixture origin", async () => {
    await expect(collect("/search?scenario=external")).rejects.toThrow(
      new ExternalBrowserRequestError(
        "browser request escaped fixture allowlist: https://external.invalid",
      ),
    );
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

  async function collect(path: string, sensitiveQueryParameters?: readonly string[]) {
    const fixedNow = () => new Date("2026-08-24T09:00:00.000Z");
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}${path}`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, {
        now: fixedNow,
        sensitiveQueryParameters,
      }),
      runId: `browser-${path.replace(/[^a-z]+/gi, "-")}`,
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
