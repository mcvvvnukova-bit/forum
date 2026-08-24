import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";

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

  it("fails collection when a page attempts a request outside the fixture origin", async () => {
    await expect(collect("/search?scenario=external")).rejects.toThrow(
      new ExternalBrowserRequestError(
        "browser request escaped fixture allowlist: https://external.invalid",
      ),
    );
  });

  it("sanitizes DOM secrets and covers both contact boxes in card screenshots", async () => {
    const result = await collect("/search?token=topsecret");
    const card = result.rawBundles.find((bundle) => bundle.identity.sourceRecordKey === "1001");
    expect(card).toBeDefined();

    const dom = new TextDecoder().decode(card?.sanitizedDomUtf8);
    expect(dom).toContain("+7 (495) 111-22-33");
    expect(dom).not.toMatch(/secretToken|must-not-be-captured|hidden secret|data-secret|topsecret/);
    expect(JSON.stringify(card?.actions)).not.toContain("topsecret");
    expect(await longestBlackRun(card!.redactedScreenshotPng)).toBeGreaterThan(30);
  });

  async function collect(path: string) {
    const fixedNow = () => new Date("2026-08-24T09:00:00.000Z");
    const source = new ListOrgBrowserSource({
      searchUrl: `${fixture.origin}${path}`,
      sessions: new PlaywrightBrowserSessionFactory(fixture.origin, { now: fixedNow }),
      runId: `browser-${path.replace(/[^a-z]+/gi, "-")}`,
    });

    return source.collect({
      okved: parseOkvedCode("43.11"),
      onlyActive: true,
      maxPages: 2,
      maxCompanies: 50,
    });
  }
});

async function longestBlackRun(png: Uint8Array): Promise<number> {
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
      let longest = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        let current = 0;
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels[offset] === 0 && pixels[offset + 1] === 0 && pixels[offset + 2] === 0) {
            current += 1;
            longest = Math.max(longest, current);
          } else {
            current = 0;
          }
        }
      }
      return longest;
    }, Buffer.from(png).toString("base64"));
  } finally {
    await browser.close();
  }
}
