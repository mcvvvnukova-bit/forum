import type {
  BrowserCaptureProjection,
  BrowserSession,
  PolicyBrowserSessionFactory,
} from "../../../application/ports/browser-session";
import type { FinancialSourceAttempt } from "../../../application/ports/audience-repository";
import type { FinancialMetricEvidence } from "../../../domain/financial";
import type { ChecksummedBrowserRawBundle, DiscoveryExecutionContext } from "../../../domain/discovery";
import { ExternalBrowserRequestError } from "../../../domain/discovery";
import { parseLegalEntityInn, type LegalEntityInn } from "../../../domain/inn";
import { OperatorAbortedError } from "../../../../../apps/browser-runner/human-verification";
import { checksumBrowserRawBundle, sha256 } from "../../storage/raw-bundle";
import {
  BrowserPolicyContractError,
  BrowserTransportError,
} from "../browser/policy-browser";
import {
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  sanitizeBrowserUrl,
} from "../list-org-browser/browser-raw-sanitizer";
import { BrowserContractError } from "../list-org-browser/browser-record-policy";
import {
  BFO_CAPTCHA_LANDMARK,
  BFO_ORGANIZATION_LANDMARK,
  BFO_REPORT_LANDMARK,
  BFO_RESTRICTED_TEXT,
  BFO_RESULTS_LANDMARK,
  BFO_REVENUE_PROJECTION_SELECTORS,
  BFO_SEARCH_FIELD,
  BFO_SEARCH_LANDMARK,
  BFO_SOFT_BLOCK_LANDMARK,
  BFO_UNAVAILABLE_TEXT,
  bfoNoDataProjectionSelectors,
  parseBfoReportProjection,
  selectBfoOrganizationHref,
} from "./bfo-live-contract";

const SOURCE_KIND = "fns-bfo-live";
const REPORT_YEAR = 2025;
const REPORT_FORM = "0710002";

export interface HumanVerificationGatePort {
  wait<TSource>(input: {
    source: TSource;
    revalidate: (source: TSource) => Promise<void> | void;
    signal?: AbortSignal;
  }): Promise<"continue">;
}

export interface BfoRevenueScope {
  inn: LegalEntityInn;
  reportYear: number;
}

export type BfoLiveRevenueResult =
  | {
    outcome: "published";
    evidence: FinancialMetricEvidence;
    sourceAttempt: FinancialSourceAttempt;
    raw: ChecksummedBrowserRawBundle;
  }
  | {
    outcome: "no_data";
    reason: "report_restricted" | "report_unavailable" | "line_2110_absent";
    evidence: null;
    sourceAttempt: FinancialSourceAttempt;
    raw: ChecksummedBrowserRawBundle;
  }
  | {
    outcome: "blocked";
    reason: string;
    evidence: null;
    raw: ChecksummedBrowserRawBundle;
  };

export interface BfoLiveSourceOptions {
  searchUrl: string;
  sessions: PolicyBrowserSessionFactory;
  humanVerification: HumanVerificationGatePort;
  runId: string;
  parserVersion: string;
  now?: () => Date;
}

export class BfoLiveSource {
  readonly #searchUrl: string;
  readonly #origin: string;
  readonly #sessions: PolicyBrowserSessionFactory;
  readonly #humanVerification: HumanVerificationGatePort;
  readonly #runId: string;
  readonly #parserVersion: string;
  readonly #now: () => Date;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: BfoLiveSourceOptions) {
    const searchUrl = new URL(options.searchUrl);
    if (searchUrl.pathname !== "/" || searchUrl.hash !== "") {
      throw new Error("BFO live search URL must use the source root page");
    }
    if (searchUrl.protocol === "https:" && searchUrl.origin !== "https://bo.nalog.gov.ru") {
      throw new Error("BFO live HTTPS origin must be https://bo.nalog.gov.ru");
    }
    if (options.sessions.policy.allowedOrigins.length !== 1
      || options.sessions.policy.allowedOrigins[0] !== searchUrl.origin) {
      throw new Error("BFO live browser policy must allow only the exact search origin");
    }
    if ((options.sessions.policy.allowedDownloadUrls?.length ?? 0) !== 0
      || (options.sessions.policy.allowedDownloadOrigins?.length ?? 0) !== 0) {
      throw new Error("BFO live visible-DOM pilot must not authorize downloads");
    }
    if (options.parserVersion.trim() === "") throw new Error("parser version is required");
    if (!/^[A-Za-z0-9._-]+$/u.test(options.runId)) throw new Error("run id is not persistable");
    this.#searchUrl = searchUrl.href;
    this.#origin = searchUrl.origin;
    this.#sessions = options.sessions;
    this.#humanVerification = options.humanVerification;
    this.#runId = options.runId;
    this.#parserVersion = options.parserVersion;
    this.#now = options.now ?? (() => new Date());
  }

  collectRevenue(
    scope: BfoRevenueScope,
    execution: DiscoveryExecutionContext = {},
  ): Promise<BfoLiveRevenueResult> {
    try {
      parseLegalEntityInn(scope.inn);
    } catch (error) {
      return Promise.reject(error);
    }
    if (scope.reportYear !== REPORT_YEAR) {
      return Promise.reject(new Error("BFO live pilot report year must be exactly 2025"));
    }
    const collection = this.#tail.then(() => this.#collectRevenue(scope, execution));
    this.#tail = collection.then(() => undefined, () => undefined);
    return collection;
  }

  async #collectRevenue(
    scope: BfoRevenueScope,
    execution: DiscoveryExecutionContext,
  ): Promise<BfoLiveRevenueResult> {
    const session = await this.#sessions.open(execution);
    const sourceRecordKey = `${scope.inn}:${scope.reportYear}:${REPORT_FORM}:visible`;
    let navigationStatus: number | null = null;

    const block = async (
      reason: string,
      policyOrigins: readonly string[] = [],
    ): Promise<BfoLiveRevenueResult> => {
      let finalUrl: string;
      let status: number | null;
      if (policyOrigins.length > 0) {
        const captured = await session.acknowledgePolicyBlock(policyOrigins);
        finalUrl = captured.finalUrl;
        status = captured.navigationStatus;
      } else {
        finalUrl = await safeCurrentUrl(session, this.#searchUrl);
        status = await safeCurrentNavigationStatus(session, navigationStatus);
      }
      return {
        outcome: "blocked",
        reason,
        evidence: null,
        raw: this.#projectedRaw(
          syntheticBlockerProjection(reason),
          finalUrl,
          sourceRecordKey,
          status,
        ),
      };
    };

    try {
      navigationStatus = await session.navigate(this.#searchUrl);
      assertNonTerminalStatus(navigationStatus);
      await session.waitForLandmark(BFO_SEARCH_LANDMARK);
      await session.fillField(BFO_SEARCH_FIELD, scope.inn);
      navigationStatus = null;
      navigationStatus = await session.clickButton("Найти");
      assertNonTerminalStatus(navigationStatus);
      const searchPageUrl = await exactCurrentSourceUrl(session, this.#origin);
      await this.#settleExpectedPage(session, execution, {
        url: searchPageUrl,
        landmark: BFO_RESULTS_LANDMARK,
        auditTarget: `bfo-search:${scope.inn}`,
      });

      const resultNames = await session.linkNamesInLandmark(BFO_RESULTS_LANDMARK, "");
      const resultHrefs = await session.linkHrefsInLandmark(BFO_RESULTS_LANDMARK);
      const organizationHref = selectBfoOrganizationHref(
        resultNames,
        resultHrefs,
        scope.inn,
      );
      navigationStatus = null;
      navigationStatus = await session.clickLinkHref(organizationHref);
      assertNonTerminalStatus(navigationStatus);
      const organizationPageUrl = await exactCurrentSourceUrl(session, this.#origin);
      await this.#settleExpectedPage(session, execution, {
        url: organizationPageUrl,
        landmark: BFO_ORGANIZATION_LANDMARK,
        auditTarget: `bfo-organization:${scope.inn}`,
      });
      await assertRequestedInn(session, scope.inn);

      navigationStatus = null;
      navigationStatus = await session.clickButton(BFO_REPORT_LANDMARK);
      assertNonTerminalStatus(navigationStatus);
      const reportPageUrl = await exactCurrentSourceUrl(session, this.#origin);
      const landing = await this.#settleExpectedPage(session, execution, {
        url: reportPageUrl,
        landmark: BFO_REPORT_LANDMARK,
        auditTarget: `bfo-report:${scope.inn}:2025`,
      });
      navigationStatus = landing.status;
      await assertRequestedInn(session, scope.inn);

      let noDataReason: "report_restricted" | "report_unavailable" | "line_2110_absent" | undefined;
      const reportRestricted = await session.hasVisibleText(BFO_RESTRICTED_TEXT);
      const reportUnavailable = await session.hasVisibleText(BFO_UNAVAILABLE_TEXT);
      if (reportRestricted && reportUnavailable) {
        throw new BrowserContractError("BFO visible report contains conflicting availability markers");
      }
      if (reportRestricted) {
        noDataReason = "report_restricted";
      } else if (reportUnavailable) {
        noDataReason = "report_unavailable";
      } else {
        if (!await session.hasVisibleText("Форма по ОКУД 0710002")) {
          throw new BrowserContractError("BFO visible report form must be 0710002");
        }
        if (!await session.hasVisibleText("Ед. измерения: тыс. ₽")) {
          throw new BrowserContractError("BFO visible report unit must be thousands of rubles");
        }
        if (!await session.hasVisibleText("2110")) noDataReason = "line_2110_absent";
      }

      const projection = await session.captureProjection(noDataReason === undefined
        ? BFO_REVENUE_PROJECTION_SELECTORS
        : bfoNoDataProjectionSelectors(noDataReason));
      const raw = this.#projectedRaw(
        projection,
        landing.url,
        sourceRecordKey,
        landing.status,
      );
      const parsed = parseBfoReportProjection(projection, {
        inn: scope.inn,
        reportYear: scope.reportYear,
        sourceRecordKey,
        observedAt: raw.capturedAt,
        rawFetchKey: raw.checksumSha256,
        parserVersion: this.#parserVersion,
      });
      const sourceAttempt: FinancialSourceAttempt = {
        sourceKind: "fns_bfo",
        sourceRecordKey,
        observedAt: raw.capturedAt,
        rawFetchKey: raw.checksumSha256,
        parserVersion: this.#parserVersion,
      };
      if (noDataReason !== undefined) {
        if (parsed.revenue !== null || parsed.evidence.length !== 0) {
          throw new BrowserContractError("BFO no-data projection unexpectedly produced revenue evidence");
        }
        return {
          outcome: "no_data",
          reason: noDataReason,
          evidence: null,
          sourceAttempt,
          raw,
        };
      }
      if (parsed.revenue === null || parsed.evidence.length !== 1 || parsed.evidence[0] === undefined) {
        throw new BrowserContractError("BFO line 2110 projection did not produce one revenue value");
      }
      return {
        outcome: "published",
        evidence: parsed.evidence[0],
        sourceAttempt,
        raw,
      };
    } catch (error) {
      if (error instanceof LiveBlockedError) return block(error.reason);
      if (error instanceof OperatorAbortedError) return block("captcha_aborted");
      if (error instanceof ExternalBrowserRequestError) return block("policy_block", error.origins);
      if (error instanceof BrowserTransportError) return block("transport_failure");
      if (error instanceof BrowserContractError || error instanceof BrowserPolicyContractError) {
        return block("contract_drift");
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  async #settleExpectedPage(
    session: BrowserSession,
    execution: DiscoveryExecutionContext,
    expected: { url: string; landmark: string; auditTarget: string },
  ): Promise<{ url: string; status: number | null }> {
    assertNonTerminalStatus(await session.currentNavigationStatus());
    if (await session.hasLandmark(BFO_CAPTCHA_LANDMARK)) {
      await session.recordCaptchaWaiting(expected.auditTarget);
      await this.#humanVerification.wait({
        source: session,
        signal: execution.signal,
        revalidate: async (sameSession) => {
          await assertExpectedVisiblePage(sameSession, this.#origin, expected.url, expected.landmark);
        },
      });
    }
    if (await session.hasLandmark(BFO_SOFT_BLOCK_LANDMARK)) {
      throw new LiveBlockedError("soft_block");
    }
    await session.waitForLandmark(expected.landmark);
    return assertExpectedVisiblePage(session, this.#origin, expected.url, expected.landmark);
  }

  #projectedRaw(
    projection: BrowserCaptureProjection,
    finalUrl: string,
    sourceRecordKey: string,
    navigationStatus: number | null,
  ): ChecksummedBrowserRawBundle {
    return checksumBrowserRawBundle({
      sourceKind: SOURCE_KIND,
      parserVersion: this.#parserVersion,
      finalUrl: sanitizeBrowserUrl(finalUrl, projection.sensitiveFormFieldNames),
      capturedAt: this.#now().toISOString(),
      navigationStatus,
      sanitizedDomUtf8: projection.sanitizedDomUtf8,
      redactedScreenshotPng: new Uint8Array(),
      pageFingerprintSha256: sha256(projection.sanitizedDomUtf8),
      identity: { runId: this.#runId, page: 1, sourceRecordKey },
      candidateEvidence: null,
      actions: [],
      sensitiveFormFieldNames: projection.sensitiveFormFieldNames,
    });
  }
}

class LiveBlockedError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

function assertNonTerminalStatus(status: number | null): void {
  if (status === 403) throw new LiveBlockedError("http_403");
  if (status !== null && status >= 500) throw new LiveBlockedError("transport_failure");
  if (status !== null && status >= 400) throw new LiveBlockedError("http_failure");
}

async function assertExpectedVisiblePage(
  session: BrowserSession,
  origin: string,
  expectedUrl: string,
  landmark: string,
): Promise<{ url: string; status: number | null }> {
  const status = await session.currentNavigationStatus();
  assertNonTerminalStatus(status);
  const currentUrl = await session.currentUrl();
  const current = new URL(currentUrl);
  if (current.origin !== origin
    || current.href !== new URL(expectedUrl).href
    || !await session.hasLandmark(landmark)) {
    throw new BrowserContractError("BFO visible page identity changed during collection");
  }
  return { url: currentUrl, status };
}

async function exactCurrentSourceUrl(session: BrowserSession, origin: string): Promise<string> {
  const currentUrl = await session.currentUrl();
  if (new URL(currentUrl).origin !== origin) {
    throw new BrowserContractError("BFO visible page left the exact source origin");
  }
  return currentUrl;
}

async function assertRequestedInn(session: BrowserSession, inn: LegalEntityInn): Promise<void> {
  if (await session.readLabeledText("ИНН") !== inn) {
    throw new BrowserContractError("BFO visible organization INN does not match the requested INN");
  }
}

async function safeCurrentUrl(session: BrowserSession, fallback: string): Promise<string> {
  try {
    return sanitizeBrowserUrl(await session.currentUrl(), MANDATORY_SENSITIVE_QUERY_PARAMETERS);
  } catch {
    return fallback;
  }
}

async function safeCurrentNavigationStatus(
  session: BrowserSession,
  fallback: number | null,
): Promise<number | null> {
  try { return await session.currentNavigationStatus(); } catch { return fallback; }
}

function syntheticBlockerProjection(reason: string): BrowserCaptureProjection {
  if (!/^[a-z0-9_]+$/u.test(reason)) throw new Error("blocker reason is not persistable");
  return {
    selectors: ["synthetic-blocker-reason"],
    sanitizedDomUtf8: new TextEncoder().encode(
      `<!doctype html><html><body><main>source:${SOURCE_KIND};reason:${reason}</main></body></html>`,
    ),
    sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
  };
}
