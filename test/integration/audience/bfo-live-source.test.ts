import { PassThrough } from "node:stream";

import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HumanVerificationGate } from "../../../src/apps/browser-runner/human-verification";
import type { BrowserSession } from "../../../src/modules/audience/application/ports/browser-session";
import type {
  BrowserActionEvent,
  BrowserActionLedger,
  ChecksummedBrowserRawBundle,
} from "../../../src/modules/audience/domain/discovery";
import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";
import { PolicyBrowserSessionFactory } from "../../../src/modules/audience/infrastructure/sources/browser/policy-browser";
import {
  BfoLiveSource,
  type HumanVerificationGatePort,
} from "../../../src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source";
import {
  startFnsBfoLiveContractServer,
  type FnsBfoLiveContractServer,
} from "../../support/fns-bfo-live-contract-server";

const targetInn = parseLegalEntityInn("7707083893");

describe("BfoLiveSource", () => {
  let fixture: FnsBfoLiveContractServer;

  beforeEach(async () => {
    fixture = await startFnsBfoLiveContractServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("collects exact 2025 form 0710002 line 2110 through sequential visible actions", async () => {
    const { result, actions } = await collect("default");

    expect(result.outcome, JSON.stringify({
      reason: result.outcome === "blocked" ? result.reason : undefined,
      requests: fixture.requests(),
      actions,
    })).toBe("published");
    expect(result).toMatchObject({
      outcome: "published",
      evidence: {
        inn: "7707083893",
        reportYear: 2025,
        metric: "revenue",
        value: "1654023000.00",
        sourceKind: "fns_bfo",
        sourceRecordKey: "7707083893:2025:0710002:2",
        observedAt: "2026-04-01T00:00:00.000Z",
        parserVersion: "fns-bfo-live/1.0.0",
      },
      sourceAttempt: {
        sourceKind: "fns_bfo",
        sourceRecordKey: "7707083893:2025:0710002:2",
        observedAt: "2026-04-01T00:00:00.000Z",
        parserVersion: "fns-bfo-live/1.0.0",
      },
      raw: {
        sourceKind: "fns-bfo-live",
        parserVersion: "fns-bfo-live/1.0.0",
        navigationStatus: 200,
        identity: {
          runId: "bfo-default",
          page: 1,
          sourceRecordKey: "7707083893:2025:0710002:2",
        },
        candidateEvidence: null,
        actions: [],
      },
    });
    if (result.outcome !== "published") throw new Error("expected published result");
    expect(result.raw.capturedAt).toBe("2026-08-26T12:00:00.000Z");
    expect(result.evidence.rawFetchKey).toBe(result.raw.checksumSha256);
    expect(result.sourceAttempt.rawFetchKey).toBe(result.raw.checksumSha256);
    expect(fixture.requests()).toEqual([
      "GET /",
      "GET /search?query=7707083893",
      "GET /cards/record-1",
      "GET /statements/record-1?year=2025",
    ]);
    expect(fixture.submittedInns()).toEqual(["7707083893"]);
    expect(fixture.maxConcurrentReportRequests()).toBe(1);
    expect(fixture.apiRequestCount()).toBe(0);
    expect(fixture.downloadRequestCount()).toBe(0);
    expect(visibleCompletedActions(actions)).toEqual([
      ["navigate", `${fixture.origin}/`],
      ["wait-landmark", "Поиск организации"],
      ["fill", "Введите ИНН или название организации"],
      ["click-button", "Найти"],
      ["wait-landmark", "Результаты поиска"],
      ["read-links", "Результаты поиска:"],
      ["read-link-hrefs", "Результаты поиска"],
      ["click-link", `${fixture.origin}/cards/record-1`],
      ["wait-landmark", "Организация"],
      ["read-labeled-text", "ИНН"],
      ["click-button", "Отчетность за 2025 год"],
      ["wait-landmark", "Отчетность за 2025 год"],
      ["read-labeled-text", "ИНН"],
      ["read-labeled-text", "Номер корректировки"],
      ["read-labeled-text", "Дата представления отчетности"],
      ["capture-projection", expect.stringContaining("2110")],
    ]);
    expect(actions.some((action) => /request|fetch|xhr|download/iu.test(action.kind))).toBe(false);
  });

  it("persists only field-level report identity and line 2110 projection evidence", async () => {
    const { result } = await collect("default");
    const raw = result.raw;
    const dom = new TextDecoder().decode(raw.sanitizedDomUtf8);

    expect(dom).toContain("Отчетность за 2025 год");
    expect(dom).toContain("7707083893");
    expect(dom).toContain("Форма по ОКУД 0710002");
    expect(dom).toContain("Ед. измерения: тыс. ₽");
    expect(dom).toContain("Номер корректировки");
    expect(dom).toContain("Дата представления отчетности");
    expect(dom).toContain("01.04.2026");
    expect(dom).toContain("Выручка");
    expect(dom).toContain("2110");
    expect(dom).toContain("2340");
    expect(dom).toContain("2120");
    expect(dom).toContain("projection-redacted");
    expect(dom).not.toMatch(/987 654|Прочие доходы|Себестоимость продаж|unrelated|person|example|API|Скачать/u);
    expectRawProjectionSafe(raw);
  });

  it("uses only the one visible line 2110 and excludes a hidden duplicate from evidence", async () => {
    const { result } = await collect("hidden-duplicate-line");

    expect(result.outcome).toBe("published");
    expect(new TextDecoder().decode(result.raw.sanitizedDomUtf8)).not.toContain("hidden-row-secret");
    expectRawProjectionSafe(result.raw);
  });

  it.each([
    ["restricted", "report_restricted"],
    ["unavailable", "report_unavailable"],
    ["no-line-2110", "line_2110_absent"],
  ] as const)("returns audited no_data only for positively evidenced %s", async (scenario, reason) => {
    const { result } = await collect(scenario);

    expect(result).toMatchObject({
      outcome: "no_data",
      reason,
      evidence: null,
      sourceAttempt: {
        sourceKind: "fns_bfo",
        rawFetchKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    const dom = new TextDecoder().decode(result.raw.sanitizedDomUtf8);
    if (scenario === "no-line-2110") {
      if (result.outcome !== "no_data") throw new Error("expected audited no_data");
      expect(result.sourceAttempt).toMatchObject({
        sourceRecordKey: "7707083893:2025:0710002:2",
        observedAt: "2026-04-01T00:00:00.000Z",
      });
      expect(dom).toContain("2120");
    }
    expect(dom).toContain("7707083893");
    expect(dom).not.toMatch(/challenge-secret|no-line-unrelated-secret|Себестоимость продаж/u);
    expectRawProjectionSafe(result.raw);
  });

  it.each([
    ["wrong-result-inn", "contract_drift"],
    ["ambiguous-result", "contract_drift"],
    ["wrong-inn", "contract_drift"],
    ["wrong-year", "contract_drift"],
    ["wrong-unit", "contract_drift"],
    ["wrong-form", "contract_drift"],
    ["wrong-column-year", "contract_drift"],
    ["invalid-correction", "contract_drift"],
    ["invalid-source-date", "contract_drift"],
    ["missing-official-metadata", "contract_drift"],
    ["conflicting-status", "contract_drift"],
    ["truncated-table", "contract_drift"],
    ["duplicate-line", "contract_drift"],
    ["decimal-number", "contract_drift"],
    ["unsafe-separator", "contract_drift"],
    ["malformed-grouping", "contract_drift"],
    ["overflow", "contract_drift"],
    ["report-403", "http_403"],
    ["report-soft-block", "soft_block"],
  ] as const)("fails closed for %s instead of returning no_data or zero", async (scenario, reason) => {
    const { result } = await collect(scenario);

    expect(result).toMatchObject({ outcome: "blocked", reason, evidence: null });
    expect(result).not.toHaveProperty("sourceAttempt");
    expect(new TextDecoder().decode(result.raw.sanitizedDomUtf8))
      .toBe(`<!doctype html><html><body><main>source:fns-bfo-live;reason:${reason}</main></body></html>`);
    expectRawProjectionSafe(result.raw);
  });

  it("blocks foreign result navigation before the foreign destination is dispatched", async () => {
    const { result } = await collect("foreign-navigation");

    expect(result).toMatchObject({ outcome: "blocked", reason: "policy_block" });
    expect(fixture.foreignDestinationRequestCount()).toBe(0);
    expect(fixture.reportRequestCount()).toBe(0);
    expectRawProjectionSafe(result.raw);
  });

  it("uses the shared exact two-retry ceiling sequentially", async () => {
    const recovered = await collect("transient-then-ok");
    expect(recovered.result.outcome).toBe("published");
    expect(fixture.initialSearchDispatchCount()).toBe(3);

    await fixture.close();
    fixture = await startFnsBfoLiveContractServer();
    const exhausted = await collect("transient-exhausted");
    expect(exhausted.result).toMatchObject({ outcome: "blocked", reason: "transport_failure" });
    expect(fixture.initialSearchDispatchCount()).toBe(3);
    expect(fixture.reportRequestCount()).toBe(0);

    await fixture.close();
    fixture = await startFnsBfoLiveContractServer();
    const reset = await collect("transport-reset-exhausted");
    expect(reset.result).toMatchObject({ outcome: "blocked", reason: "transport_failure" });
    expect(fixture.initialSearchDispatchCount()).toBe(3);
    expect(fixture.reportRequestCount()).toBe(0);
  });

  it("never retries a non-transient HTTP failure", async () => {
    const { result } = await collect("http-418");

    expect(result).toMatchObject({ outcome: "blocked", reason: "http_failure" });
    expect(fixture.initialSearchDispatchCount()).toBe(1);
  });

  it("serializes multiple requested INNs on one source instance", async () => {
    const { source } = makeSource("slow-report");

    const results = await Promise.all([
      source.collectRevenue({ inn: targetInn, reportYear: 2025 }),
      source.collectRevenue({ inn: targetInn, reportYear: 2025 }),
    ]);

    expect(results.map((result) => result.outcome)).toEqual(["published", "published"]);
    expect(fixture.maxConcurrentReportRequests()).toBe(1);
    expect(fixture.submittedInns()).toEqual(["7707083893", "7707083893"]);
  });

  it("does not enter the human gate until captcha_waiting is durably recorded, then revalidates the same session", async () => {
    const input = new PassThrough();
    const ordering: string[] = [];
    const events: BrowserActionEvent[] = [];
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
    const collection = collect("captcha", gate, events, ledger);

    await captchaWriteAttempted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(gateEntered).toBe(false);
    expect(events.some((event) => event.kind === "captcha_waiting")).toBe(false);

    releaseCaptchaWrite();
    const { result } = await collection;

    expect(result.outcome).toBe("published");
    expect(events.filter((event) => event.kind === "captcha_waiting")).toEqual([
      expect.objectContaining({
        outcome: "completed",
        target: "bfo-report:7707083893:2025",
      }),
    ]);
    expect(ordering).toEqual([
      "captcha-write-attempted",
      "captcha-write-durable",
      "gate-entered",
      "same-session-revalidated",
    ]);
  });

  it("maps CAPTCHA abort, EOF, and failed post-CAPTCHA revalidation to blockers", async () => {
    const abortInput = new PassThrough();
    abortInput.end("abort\n");
    const aborted = await collect("captcha", new HumanVerificationGate({
      input: abortInput,
      output: new PassThrough(),
    }));
    expect(aborted.result).toMatchObject({ outcome: "blocked", reason: "captcha_aborted" });
    expectRawProjectionSafe(aborted.result.raw);

    await fixture.close();
    fixture = await startFnsBfoLiveContractServer();
    const eof = new PassThrough();
    eof.end();
    const ended = await collect("captcha", new HumanVerificationGate({
      input: eof,
      output: new PassThrough(),
    }));
    expect(ended.result).toMatchObject({ outcome: "blocked", reason: "captcha_aborted" });

    await fixture.close();
    fixture = await startFnsBfoLiveContractServer();
    const earlyContinue = new PassThrough();
    earlyContinue.end("continue\n");
    const invalid = await collect("captcha", new HumanVerificationGate({
      input: earlyContinue,
      output: new PassThrough(),
    }));
    expect(invalid.result).toMatchObject({ outcome: "blocked", reason: "contract_drift" });
  });

  it("rejects a non-2025 scope before opening the browser", async () => {
    const { source } = makeSource("default");

    await expect(source.collectRevenue({ inn: targetInn, reportYear: 2024 }))
      .rejects.toThrow("2025");
    expect(fixture.requests()).toEqual([]);
  });

  it("rejects a forged invalid legal-entity INN before opening the browser", async () => {
    const { source } = makeSource("default");

    await expect(source.collectRevenue({
      inn: "7707083894" as typeof targetInn,
      reportYear: 2025,
    })).rejects.toThrow("checksum");
    expect(fixture.requests()).toEqual([]);
  });

  async function collect(
    scenario: string,
    humanVerification: HumanVerificationGatePort = failIfCaptchaAppears(),
    actions: BrowserActionEvent[] = [],
    ledger?: BrowserActionLedger,
  ) {
    const { source } = makeSource(scenario, humanVerification);
    const result = await source.collectRevenue({ inn: targetInn, reportYear: 2025 }, {
      actionLedger: ledger ?? { record: async (event) => { actions.push(event); } },
    });
    return { result, actions };
  }

  function makeSource(
    scenario: string,
    humanVerification: HumanVerificationGatePort = failIfCaptchaAppears(),
  ) {
    const sessions = new PolicyBrowserSessionFactory({
      allowedOrigins: [fixture.origin],
      allowedNavigationUrls: [
        { origin: fixture.origin, pathname: "/" },
        { origin: fixture.origin, pathname: "/search" },
        { origin: fixture.origin, pathname: "/cards/*" },
        { origin: fixture.origin, pathname: "/statements/*" },
      ],
      allowInsecureHttpForTesting: true,
    }, {
      sourceKind: "fns-bfo-live",
      transportRetryDelayMs: 0,
      launch: () => chromium.launch({
        headless: true,
        args: ["--disable-features=LocalNetworkAccessChecks"],
      }),
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });
    return {
      source: new BfoLiveSource({
        searchUrl: `${fixture.origin}/${scenario === "default" ? "" : `?scenario=${scenario}`}`,
        sessions,
        humanVerification,
        runId: `bfo-${scenario}`,
        parserVersion: "fns-bfo-live/1.0.0",
        now: () => new Date("2026-08-26T12:00:00.000Z"),
      }),
    };
  }
});

function failIfCaptchaAppears(): HumanVerificationGatePort {
  return {
    wait: async () => {
      throw new Error("unexpected CAPTCHA in this scenario");
    },
  };
}

function visibleCompletedActions(actions: readonly BrowserActionEvent[]) {
  const visibleKinds = new Set([
    "navigate", "wait-landmark", "fill", "click-button", "read-links", "read-link-hrefs",
    "click-link", "read-labeled-text", "capture-projection",
  ]);
  return actions
    .filter((action) => action.outcome === "completed" && visibleKinds.has(action.kind))
    .map((action) => [action.kind, action.target]);
}

function expectRawProjectionSafe(raw: ChecksummedBrowserRawBundle): void {
  const dom = new TextDecoder().decode(raw.sanitizedDomUtf8);
  expect(raw.redactedScreenshotPng).toHaveLength(0);
  expect(raw.actions).toEqual([]);
  expect(raw.candidateEvidence).toBeNull();
  expect(dom).not.toMatch(/captcha-challenge-secret|results-unrelated-secret|report-unrelated-secret|person@example|\+7 \(495\)/u);
  expect(checksumBrowserRawBundle(raw).checksumSha256).toBe(raw.checksumSha256);
}
