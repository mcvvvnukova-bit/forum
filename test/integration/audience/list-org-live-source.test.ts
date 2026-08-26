import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { HumanVerificationGate } from "../../../src/apps/browser-runner/human-verification";
import type { BrowserSession } from "../../../src/modules/audience/application/ports/browser-session";
import type { BrowserActionEvent } from "../../../src/modules/audience/domain/discovery";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import { PolicyBrowserSessionFactory } from "../../../src/modules/audience/infrastructure/sources/browser/policy-browser";
import {
  ListOrgLiveSource,
  type HumanVerificationGatePort,
} from "../../../src/modules/audience/infrastructure/sources/list-org-live/list-org-live-source";
import {
  startListOrgLiveContractServer,
  type ListOrgLiveContractServer,
} from "../../support/list-org-live-contract-server";

describe("ListOrgLiveSource", () => {
  let fixture: ListOrgLiveContractServer;

  beforeEach(async () => {
    fixture = await startListOrgLiveContractServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("collects the first 10 unique legal entities in source order while retaining inactive and additional-OKVED matches", async () => {
    const { result } = await collect("default");

    expect(result.status, result.reason).toBe("limited");
    expect(result.reason).toBe("max_companies");
    expect(result.companies.map((company) => company.inn)).toEqual([
      "7700000016",
      "7700000023",
      "7700000030",
      "7700000048",
      "7700000055",
      "7700000062",
      "7700000070",
      "7700000087",
      "7700000094",
      "7700000104",
    ]);
    expect(result.companies[1]?.name).toContain("Ликвидирована");
    expect(result.companies[2]).toMatchObject({ okvedCode: "43.11", isPrimary: false });
    expect(result.companies.every((company) =>
      company.website === null && company.phone === null && company.email === null
    )).toBe(true);
    expect(fixture.companyRequestIds()).toEqual([
      "1001", "1002", "1003", "1004", "1005", "1006", "1007",
      "1008", "1009", "1010", "1011", "1012",
    ]);
    expect(fixture.companyRequestIds()).not.toContain("1013");
  });

  it("submits the source-shaped advanced form with canonical OKVED and both exclusion checkboxes cleared", async () => {
    await collect("default");

    const submitted = fixture.submittedSearches()[0];
    expect(submitted).toMatchObject({ okved: ["43.11"] });
    expect(submitted).not.toHaveProperty("is_ip");
    expect(submitted).not.toHaveProperty("work");
  });

  it("persists only allowlisted card projections and no card screenshot", async () => {
    const { result } = await collect("default");
    const cards = result.rawBundles.filter((raw) => raw.identity.sourceRecordKey !== undefined);

    expect(cards).toHaveLength(12);
    for (const raw of cards) {
      const dom = new TextDecoder().decode(raw.sanitizedDomUtf8);
      expect(dom).toContain("Полное юридическое наименование:");
      expect(dom).toContain("ИНН / КПП:");
      expect(dom).toContain("Основной (по коду ОКВЭД ред.2):");
      expect(dom).toContain("<table>");
      expect(dom).not.toMatch(/Иван Петров|111-22-33|private\.person|private\.example|company-status/u);
      expect(raw.redactedScreenshotPng).toHaveLength(0);
    }
  });

  it("uses the shared two-retry document boundary and never retries the terminal fifth response", async () => {
    const recovered = await collect("transient-then-ok");
    expect(recovered.result.companies).toHaveLength(10);
    expect(fixture.requests().filter((request) =>
      request.startsWith("GET /search?okved=43.11") && request.includes("scenario=transient-then-ok")
    ).length).toBeGreaterThanOrEqual(3);
  });

  it("blocks after the shared retry ceiling instead of returning no data", async () => {
    const { result } = await collect("transient-exhausted");

    expect(result).toMatchObject({ status: "blocked", reason: "transport_failure" });
    expect(fixture.requests().filter((request) =>
      request.includes("okved=43.11") && request.includes("scenario=transient-exhausted")
    ))
      .toHaveLength(3);
    expect(fixture.companyRequestIds()).toEqual([]);
  });

  it("records captcha_waiting durably before the real gate and revalidates the existing visible session", async () => {
    const input = new PassThrough();
    const observedKindsAtGate: string[][] = [];
    const events: BrowserActionEvent[] = [];
    const realGate = new HumanVerificationGate({ input, output: new PassThrough() });
    const gate: HumanVerificationGatePort = {
      wait: async <TSource>(request: {
        source: TSource;
        revalidate: (source: TSource) => Promise<void> | void;
        signal?: AbortSignal;
      }) => {
        observedKindsAtGate.push(events.map((event) => event.kind));
        const browser = request.source as BrowserSession;
        await browser.navigate(await browser.currentUrl());
        return realGate.wait(request);
      },
    };
    input.end("continue\n");
    const { result } = await collect("captcha", gate, events);

    expect(result.companies).toHaveLength(10);
    expect(observedKindsAtGate[0]).toContain("captcha_waiting");
    expect(events.filter((event) => event.kind === "captcha_waiting")).toEqual([
      expect.objectContaining({ outcome: "completed", target: "/search:results-page-1" }),
    ]);
  });

  it("treats operator abort and failed post-CAPTCHA revalidation as terminal blockers", async () => {
    const abortInput = new PassThrough();
    abortInput.end("abort\n");
    const aborted = await collect("captcha", new HumanVerificationGate({
      input: abortInput,
      output: new PassThrough(),
    }));
    expect(aborted.result).toMatchObject({ status: "blocked", reason: "captcha_aborted" });

    await fixture.close();
    fixture = await startListOrgLiveContractServer();
    const earlyContinue = new PassThrough();
    earlyContinue.end("continue\n");
    const invalid = await collect("captcha", new HumanVerificationGate({
      input: earlyContinue,
      output: new PassThrough(),
    }));
    expect(invalid.result).toMatchObject({ status: "blocked", reason: "contract_drift" });
  });

  it("treats CAPTCHA operator EOF as a terminal blocker", async () => {
    const eof = new PassThrough();
    eof.end();
    const { result } = await collect("captcha", new HumanVerificationGate({
      input: eof,
      output: new PassThrough(),
    }));

    expect(result).toMatchObject({ status: "blocked", reason: "captcha_aborted" });
  });

  it.each([
    ["http-403", "http_403"],
    ["soft-block", "soft_block"],
    ["malformed-inn", "contract_drift"],
    ["missing-label", "contract_drift"],
    ["foreign-redirect", "policy_block"],
  ])("treats %s as a terminal source failure", async (scenario, reason) => {
    const { result } = await collect(scenario);

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(reason);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.raw.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    if (scenario === "http-403") {
      expect(result.blockers[0]?.raw.navigationStatus).toBe(403);
      expect(fixture.submittedSearches()).toHaveLength(1);
    }
  });

  async function collect(
    scenario: string,
    humanVerification: HumanVerificationGatePort = failIfCaptchaAppears(),
    actionEvents: BrowserActionEvent[] = [],
  ) {
    const sessions = new PolicyBrowserSessionFactory({
      allowedOrigins: [fixture.origin],
      allowedNavigationUrls: [
        { origin: fixture.origin, pathname: "/search" },
        { origin: fixture.origin, pathname: "/company/*" },
      ],
      allowInsecureHttpForTesting: true,
    }, {
      sourceKind: "list-org-live",
      transportRetryDelayMs: 0,
      launch: () => chromium.launch({
        headless: true,
        args: ["--disable-features=LocalNetworkAccessChecks"],
      }),
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });
    const source = new ListOrgLiveSource({
      searchUrl: `${fixture.origin}/search${scenario === "default" ? "" : `?scenario=${scenario}`}`,
      sessions,
      humanVerification,
      runId: `live-${scenario}`,
      parserVersion: "list-org-live/1.0.0",
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });
    const result = await source.collect({
      okved: parseOkvedCode("43.11"),
      onlyActive: false,
      maxPages: 2,
      maxCompanies: 10,
    }, {
      actionLedger: { record: async (event) => { actionEvents.push(event); } },
    });
    return { result, actionEvents };
  }
});

function failIfCaptchaAppears(): HumanVerificationGatePort {
  return {
    wait: async () => {
      throw new Error("unexpected CAPTCHA in this scenario");
    },
  };
}
