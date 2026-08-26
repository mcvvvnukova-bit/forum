import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { HumanVerificationGate } from "../../../src/apps/browser-runner/human-verification";
import type { BrowserSession } from "../../../src/modules/audience/application/ports/browser-session";
import type {
  BrowserActionEvent,
  BrowserActionLedger,
  ChecksummedProjectionRawBundle,
  DiscoveryScope,
} from "../../../src/modules/audience/domain/discovery";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import { checksumProjectionRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
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
    expect(fixture.maxConcurrentCompanyRequests()).toBe(1);
    expect(result.skips).toEqual([
      expect.objectContaining({ sourceRecordKey: "1003", reason: "individual_entrepreneur" }),
      expect.objectContaining({
        sourceRecordKey: "1004",
        reason: "duplicate_inn",
        duplicateOfSourceRecordKey: "1001",
      }),
    ]);
    const observedKeys = result.pages.flatMap((page) => page.orderedSourceRecordKeys);
    expect(observedKeys).toHaveLength(12);
    expect(new Set(observedKeys).size).toBe(12);
    expect(result.companies.map((company) => company.sourceRecordKey)).toEqual(
      observedKeys.filter((key) => key !== "1003" && key !== "1004"),
    );
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
      expect(raw.artifactKind).toBe("projection");
      expect(raw).not.toHaveProperty("redactedScreenshotPng");
      expect(raw).not.toHaveProperty("actions");
    }
  });

  it("excludes unrelated result, contact, and person content from every durable raw bundle", async () => {
    const { result } = await collect("default");

    expect(result.rawBundles.length).toBeGreaterThan(0);
    expectEveryRawBundleMinimized(result.rawBundles);
    for (const page of result.pages) {
      const dom = new TextDecoder().decode(page.raw.sanitizedDomUtf8);
      expect([...dom.matchAll(/\shref="([^"]+)"/gu)].map((match) => match[1])).toEqual(
        page.orderedSourceRecordKeys.map((sourceRecordKey) =>
          `${fixture.origin}/company/${sourceRecordKey}`
        ),
      );
      expect(dom).not.toMatch(/Следующая страница|Последняя страница|\/search\?/u);
    }
  });

  it("uses the shared two-retry document boundary and never retries the terminal fifth response", async () => {
    const recovered = await collect("transient-then-ok");
    expect(recovered.result.companies).toHaveLength(10);
    expect(fixture.initialSearchDispatchCount()).toBe(3);
  });

  it("blocks after the shared retry ceiling instead of returning no data", async () => {
    const { result } = await collect("transient-exhausted");

    expect(result).toMatchObject({ status: "blocked", reason: "transport_failure" });
    expect(fixture.requests().filter((request) =>
      request.includes("okved=43.11") && request.includes("scenario=transient-exhausted")
    ))
      .toHaveLength(3);
    expect(fixture.companyRequestIds()).toEqual([]);
    expectEveryRawBundleMinimized(result.rawBundles);
  });

  it("maps an exhausted connection reset to blocked transport_failure after exactly three dispatches", async () => {
    const { result } = await collect("transport-reset-exhausted");

    expect(result).toMatchObject({ status: "blocked", reason: "transport_failure" });
    expect(fixture.initialSearchDispatchCount()).toBe(3);
    expect(fixture.companyRequestIds()).toEqual([]);
    expectEveryRawBundleMinimized(result.rawBundles);
  });

  it("never retries a non-transient HTTP failure", async () => {
    const { result } = await collect("http-418");

    expect(result).toMatchObject({ status: "blocked", reason: "http_failure" });
    expect(fixture.initialSearchDispatchCount()).toBe(1);
    expectEveryRawBundleMinimized(result.rawBundles);
  });

  it("ignores hidden duplicate card fields and persists only the unique visible values", async () => {
    const { result } = await collect("hidden-duplicate");

    expect(result.companies).toHaveLength(10);
    expect(result.companies[0]).toMatchObject({ name: "ООО «Альфа Снос»", inn: "7700000016" });
    expectEveryRawBundleMinimized(result.rawBundles);
  });

  it.each([
    ["okved", { okved: parseOkvedCode("43.12") }],
    ["onlyActive", { onlyActive: true }],
    ["maxCompanies", { maxCompanies: 11 }],
    ["maxPages", { maxPages: 3 }],
  ] as const)("rejects an incompatible live pilot %s scope before opening the browser", async (_field, override) => {
    await expect(collect("default", undefined, [], override)).rejects.toThrow("live pilot scope");
    expect(fixture.requests()).toEqual([]);
  });

  it("persists the observed result and card navigation statuses", async () => {
    const resultStatus = await collect("results-202");
    expect(resultStatus.result.pages[0]?.raw.navigationStatus).toBe(202);

    await fixture.close();
    fixture = await startListOrgLiveContractServer();
    const cardStatus = await collect("card-201");
    expect(cardStatus.result.rawBundles.find((raw) => raw.identity.sourceRecordKey === "1001")?.navigationStatus)
      .toBe(201);
  });

  it("does not enter the human gate until the durable captcha_waiting write resolves", async () => {
    const input = new PassThrough();
    const events: BrowserActionEvent[] = [];
    const ordering: string[] = [];
    let releaseCaptchaWrite!: () => void;
    const captchaWriteRelease = new Promise<void>((resolve) => { releaseCaptchaWrite = resolve; });
    let signalCaptchaWriteAttempt!: () => void;
    const captchaWriteAttempted = new Promise<void>((resolve) => { signalCaptchaWriteAttempt = resolve; });
    let gateEntered = false;
    const ledger: BrowserActionLedger = {
      record: async (event) => {
        if (event.kind === "captcha_waiting") {
          ordering.push("captcha-write-attempted");
          signalCaptchaWriteAttempt();
          await captchaWriteRelease;
          ordering.push("captcha-write-durable");
        }
        events.push(event);
      },
    };
    const realGate = new HumanVerificationGate({ input, output: new PassThrough() });
    const gate: HumanVerificationGatePort = {
      wait: async <TSource>(request: {
        source: TSource;
        revalidate: (source: TSource) => Promise<void> | void;
        signal?: AbortSignal;
      }) => {
        gateEntered = true;
        ordering.push("gate-entered");
        expect(events.at(-1)?.kind).toBe("captcha_waiting");
        const browser = request.source as BrowserSession;
        await browser.navigate(await browser.currentUrl());
        return realGate.wait({
          ...request,
          revalidate: async (sameSession) => {
            expect(sameSession).toBe(request.source);
            ordering.push("same-session-revalidated");
            await request.revalidate(sameSession);
          },
        });
      },
    };
    input.end("continue\n");
    const collection = collect("captcha", gate, events, {}, ledger);

    await captchaWriteAttempted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(gateEntered).toBe(false);
    expect(events.some((event) => event.kind === "captcha_waiting")).toBe(false);

    releaseCaptchaWrite();
    const { result } = await collection;

    expect(result.companies).toHaveLength(10);
    expect(events.filter((event) => event.kind === "captcha_waiting")).toEqual([
      expect.objectContaining({ outcome: "completed", target: "/search:results-page-1" }),
    ]);
    expect(ordering).toEqual([
      "captcha-write-attempted",
      "captcha-write-durable",
      "gate-entered",
      "same-session-revalidated",
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
    expectEveryRawBundleMinimized(aborted.result.rawBundles);

    await fixture.close();
    fixture = await startListOrgLiveContractServer();
    const earlyContinue = new PassThrough();
    earlyContinue.end("continue\n");
    const invalid = await collect("captcha", new HumanVerificationGate({
      input: earlyContinue,
      output: new PassThrough(),
    }));
    expect(invalid.result).toMatchObject({ status: "blocked", reason: "contract_drift" });
    expectEveryRawBundleMinimized(invalid.result.rawBundles);
  });

  it("treats CAPTCHA operator EOF as a terminal blocker", async () => {
    const eof = new PassThrough();
    eof.end();
    const { result } = await collect("captcha", new HumanVerificationGate({
      input: eof,
      output: new PassThrough(),
    }));

    expect(result).toMatchObject({ status: "blocked", reason: "captcha_aborted" });
    expectEveryRawBundleMinimized(result.rawBundles);
  });

  it.each([
    ["return-403", "http_403", undefined],
    ["return-soft-block", "soft_block", undefined],
    ["return-drift", "contract_drift", undefined],
    ["return-captcha", "captcha_aborted", "abort"],
  ] as const)("does not pair stale card evidence with a %s return-page blocker", async (
    scenario,
    reason,
    operatorInput,
  ) => {
    const gate = operatorInput === undefined
      ? undefined
      : verificationGate(operatorInput);
    const { result } = await collect(scenario, gate);

    expect(result).toMatchObject({ status: "blocked", reason });
    expect(result.blockers[0]?.raw.identity.sourceRecordKey).toBe("1001");
    expect(new TextDecoder().decode(result.blockers[0]?.raw.sanitizedDomUtf8))
      .toContain(`reason:${reason}`);
    expectEveryRawBundleMinimized(result.rawBundles);
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
    expectEveryRawBundleMinimized(result.rawBundles);
    if (scenario === "http-403") {
      expect(result.blockers[0]?.raw.navigationStatus).toBe(403);
      expect(fixture.submittedSearches()).toHaveLength(1);
    }
    if (scenario === "foreign-redirect") {
      expect(fixture.foreignDestinationRequestCount()).toBe(0);
    }
  });

  async function collect(
    scenario: string,
    humanVerification: HumanVerificationGatePort = failIfCaptchaAppears(),
    actionEvents: BrowserActionEvent[] = [],
    scopeOverride: Partial<DiscoveryScope> = {},
    actionLedger?: BrowserActionLedger,
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
      ...scopeOverride,
    }, {
      actionLedger: actionLedger ?? { record: async (event) => { actionEvents.push(event); } },
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

function verificationGate(inputValue: string): HumanVerificationGate {
  const input = new PassThrough();
  input.end(`${inputValue}\n`);
  return new HumanVerificationGate({ input, output: new PassThrough() });
}

function expectEveryRawBundleMinimized(
  rawBundles: readonly ChecksummedProjectionRawBundle[],
): void {
  for (const raw of rawBundles) {
    const dom = new TextDecoder().decode(raw.sanitizedDomUtf8);
    expect(dom).not.toMatch(
      /results-person-secret|results-page-two-secret|results\.person|222-33-44|333-44-55|captcha-challenge-secret|Иван Проверяемый|Иван Петров|111-22-33|private\.person|private\.example|hidden-company-secret|hidden-okved-secret/u,
    );
    expect(raw.artifactKind).toBe("projection");
    expect(raw).not.toHaveProperty("redactedScreenshotPng");
    expect(raw).not.toHaveProperty("actions");
    expect(checksumProjectionRawBundle(raw).checksumSha256).toBe(raw.checksumSha256);
  }
}
