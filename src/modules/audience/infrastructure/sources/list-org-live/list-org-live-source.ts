import type { BrowserCaptureProjection, BrowserSession, PolicyBrowserSessionFactory } from "../../../application/ports/browser-session";
import { OperatorAbortedError } from "../../../../../apps/browser-runner/human-verification";
import { createCandidateEvidence } from "../../../domain/candidate-evidence";
import {
  ExternalBrowserRequestError,
  type DiscoveryBlocker,
  type DiscoveryExecutionContext,
  type DiscoveryOccurrence,
  type DiscoveryPage,
  type DiscoveryReject,
  type DiscoveryResult,
  type DiscoveryScope,
  type DiscoveredCompany,
  type OrganizationSource,
} from "../../../domain/discovery";
import { checksumBrowserRawBundle, sha256 } from "../../storage/raw-bundle";
import { BrowserPolicyContractError } from "../browser/policy-browser";
import { sanitizeBrowserUrl } from "../list-org-browser/browser-raw-sanitizer";
import { BrowserContractError } from "../list-org-browser/browser-record-policy";
import {
  LIST_ORG_LIVE_CARD_PROJECTION_SELECTORS,
  LIST_ORG_LIVE_RESULTS_PROJECTION_SELECTORS,
  parseListOrgLiveCard,
} from "./list-org-live-contract";

const SEARCH_LANDMARK = "Расширенный поиск";
const RESULTS_LANDMARK = "Результаты поиска";
const CARD_LANDMARK = "Карточка организации";
const CAPTCHA_LANDMARK = "Подтверждение CAPTCHA";
const SOFT_BLOCK_LANDMARK = "Доступ временно ограничен";
const SOURCE_KIND = "list-org-live";

export interface HumanVerificationGatePort {
  wait<TSource>(input: {
    source: TSource;
    revalidate: (source: TSource) => Promise<void> | void;
    signal?: AbortSignal;
  }): Promise<"continue">;
}

export interface ListOrgLiveSourceOptions {
  searchUrl: string;
  sessions: PolicyBrowserSessionFactory;
  humanVerification: HumanVerificationGatePort;
  runId: string;
  parserVersion: string;
  now?: () => Date;
}

export class ListOrgLiveSource implements OrganizationSource {
  readonly #searchUrl: string;
  readonly #origin: string;
  readonly #sessions: PolicyBrowserSessionFactory;
  readonly #humanVerification: HumanVerificationGatePort;
  readonly #runId: string;
  readonly #parserVersion: string;
  readonly #now: () => Date;

  constructor(options: ListOrgLiveSourceOptions) {
    const searchUrl = new URL(options.searchUrl);
    if (searchUrl.pathname !== "/search") throw new Error("List-Org live search URL must use /search");
    if (!options.sessions.policy.allowedOrigins.includes(searchUrl.origin)) {
      throw new Error("List-Org live search origin must be allowed by the policy browser");
    }
    if (options.parserVersion.trim() === "") throw new Error("parser version is required");
    this.#searchUrl = searchUrl.href;
    this.#origin = searchUrl.origin;
    this.#sessions = options.sessions;
    this.#humanVerification = options.humanVerification;
    this.#runId = options.runId;
    this.#parserVersion = options.parserVersion;
    this.#now = options.now ?? (() => new Date());
  }

  async collect(scope: DiscoveryScope, execution: DiscoveryExecutionContext = {}): Promise<DiscoveryResult> {
    if (!isPositiveSafeInteger(scope.maxPages) || !isPositiveSafeInteger(scope.maxCompanies)) {
      throw new Error("discovery limits must be positive safe integers");
    }

    const session = await this.#sessions.open(execution);
    const companies: DiscoveredCompany[] = [];
    const pages: DiscoveryPage[] = [];
    const rawBundles: ReturnType<typeof checksumBrowserRawBundle>[] = [];
    const rejects: DiscoveryReject[] = [];
    const blockers: DiscoveryBlocker[] = [];
    const seenInns = new Set<string>();
    let currentPage = 1;
    let currentSourceRecordKey: string | undefined;
    let currentProjection: BrowserCaptureProjection | undefined;
    let currentOccurrences: DiscoveryOccurrence[] = [];
    let currentOrderedKeys: readonly string[] = [];
    let currentResultFingerprint = "";
    let currentNavigationStatus: number | null = null;

    const block = async (
      reason: string,
      policyOrigins: readonly string[] = [],
    ): Promise<DiscoveryResult> => {
      let raw: ReturnType<typeof checksumBrowserRawBundle>;
      if (policyOrigins.length > 0) {
        const captured = await session.captureBlocker({
          runId: this.#runId,
          page: currentPage,
          ...(currentSourceRecordKey === undefined ? {} : { sourceRecordKey: currentSourceRecordKey }),
        }, this.#parserVersion, policyOrigins);
        raw = checksumBrowserRawBundle({
          ...captured,
          sourceKind: SOURCE_KIND,
          sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><html><body><main>policy block</main></body></html>"),
          redactedScreenshotPng: new Uint8Array(),
          pageFingerprintSha256: sha256("<!doctype html><html><body><main>policy block</main></body></html>"),
          candidateEvidence: null,
        });
      } else {
        const projection = currentProjection ?? await safeHeadingProjection(session);
        raw = this.#projectedRaw(
          projection,
          await safeCurrentUrl(session, this.#searchUrl),
          null,
          { runId: this.#runId, page: currentPage, ...(currentSourceRecordKey === undefined ? {} : { sourceRecordKey: currentSourceRecordKey }) },
          currentNavigationStatus,
        );
      }
      rawBundles.push(raw);
      blockers.push({
        reason,
        ...(currentSourceRecordKey === undefined ? {} : { sourceRecordKey: currentSourceRecordKey }),
        ...(policyOrigins.length === 0 ? {} : { detail: policyOrigins.join(", ") }),
        raw,
      });
      return makeResult("blocked", reason, companies, pages, rawBundles, rejects, blockers);
    };

    try {
      let status = await session.navigate(this.#searchUrl);
      currentNavigationStatus = status;
      assertNonTerminalStatus(status);
      await session.waitForLandmark(SEARCH_LANDMARK);
      await session.fillField("ОКВЭД", scope.okved);
      await session.setCheckbox("Включать ИП", false);
      await session.setCheckbox("Только действующие", scope.onlyActive);
      status = await session.clickButton("Поиск");
      currentNavigationStatus = status;
      assertNonTerminalStatus(status);

      for (let pageNumber = 1; pageNumber <= scope.maxPages; pageNumber += 1) {
        currentPage = pageNumber;
        currentSourceRecordKey = undefined;
        currentProjection = undefined;
        currentOccurrences = [];
        currentOrderedKeys = [];
        currentResultFingerprint = "";

        await this.#settleExpectedPage(session, execution, {
          pathname: "/search",
          landmark: RESULTS_LANDMARK,
          auditTarget: `/search:results-page-${pageNumber}`,
        });
        await verifyResultsIdentity(session, scope, pageNumber);
        const resultUrl = await session.currentUrl();
        const linkHrefs = await session.linkHrefsInLandmark(RESULTS_LANDMARK);
        const companyLinks = linkHrefs.map((href) => parseCompanyLink(href, this.#origin)).filter(isPresent);
        if (companyLinks.length === 0) throw new BrowserContractError("result page contains no /company/<id> links");
        currentOrderedKeys = companyLinks.map((link) => link.sourceRecordKey);
        currentResultFingerprint = await session.fingerprint();
        const resultProjection = await session.captureProjection(LIST_ORG_LIVE_RESULTS_PROJECTION_SELECTORS);

        for (const link of companyLinks) {
          currentSourceRecordKey = link.sourceRecordKey;
          currentProjection = undefined;
          const before = await session.fingerprint();
          status = await session.clickLinkHref(link.href);
          currentNavigationStatus = status;
          assertNonTerminalStatus(status);
          await this.#settleExpectedPage(session, execution, {
            pathname: `/company/${link.sourceRecordKey}`,
            landmark: CARD_LANDMARK,
            auditTarget: `/company/${link.sourceRecordKey}:company-card`,
          });

          const projection = await session.captureProjection(LIST_ORG_LIVE_CARD_PROJECTION_SELECTORS);
          currentProjection = projection;
          const parsed = parseListOrgLiveCard(projection, link.sourceRecordKey, scope);
          const cardRaw = this.#projectedRaw(
            projection,
            await session.currentUrl(),
            parsed.kind === "legal-entity" ? createCandidateEvidence(parsed.company) : null,
            { runId: this.#runId, page: pageNumber, sourceRecordKey: link.sourceRecordKey },
          );
          rawBundles.push(cardRaw);

          status = await session.clickLink("Вернуться к результатам");
          currentNavigationStatus = status;
          assertNonTerminalStatus(status);
          await this.#settleExpectedPage(session, execution, {
            pathname: "/search",
            landmark: RESULTS_LANDMARK,
            auditTarget: `/search:results-page-${pageNumber}`,
          });
          await verifyResultsIdentity(session, scope, pageNumber);
          const after = await session.fingerprint();
          if (after !== before) throw new BrowserContractError("result page changed after visiting a company card");
          currentOccurrences.push({
            sourceRecordKey: link.sourceRecordKey,
            resultFingerprintBefore: before,
            resultFingerprintAfter: after,
          });

          if (parsed.kind === "ip" || seenInns.has(parsed.company.inn)) continue;
          seenInns.add(parsed.company.inn);
          companies.push({
            ...parsed.company,
            rawFetchKey: cardRaw.checksumSha256,
            parserVersion: this.#parserVersion,
          });
          if (companies.length === scope.maxCompanies) {
            const pageRaw = this.#projectedRaw(
              resultProjection,
              resultUrl,
              null,
              { runId: this.#runId, page: pageNumber },
            );
            rawBundles.push(pageRaw);
            pages.push(makePage(pageNumber, pageRaw, currentOccurrences, currentOrderedKeys, currentResultFingerprint));
            return makeResult("limited", "max_companies", companies, pages, rawBundles, rejects, blockers);
          }
        }

        currentSourceRecordKey = undefined;
        currentProjection = resultProjection;
        const pageRaw = this.#projectedRaw(
          resultProjection,
          resultUrl,
          null,
          { runId: this.#runId, page: pageNumber },
        );
        rawBundles.push(pageRaw);
        pages.push(makePage(pageNumber, pageRaw, currentOccurrences, currentOrderedKeys, currentResultFingerprint));
        if (await session.hasVisibleText("Последняя страница")) {
          return makeResult("succeeded", "terminal_marker", companies, pages, rawBundles, rejects, blockers);
        }
        if (pageNumber === scope.maxPages) {
          return makeResult("limited", "max_pages", companies, pages, rawBundles, rejects, blockers);
        }
        status = await session.clickLink("Следующая страница");
        currentNavigationStatus = status;
        assertNonTerminalStatus(status);
      }
      return makeResult("limited", "max_pages", companies, pages, rawBundles, rejects, blockers);
    } catch (error) {
      if (error instanceof LiveBlockedError) return await block(error.reason);
      if (error instanceof OperatorAbortedError) return await block("captcha_aborted");
      if (error instanceof ExternalBrowserRequestError) {
        return await block("policy_block", error.origins);
      }
      if (error instanceof BrowserContractError || error instanceof BrowserPolicyContractError) {
        return await block("contract_drift");
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  async #settleExpectedPage(
    session: BrowserSession,
    execution: DiscoveryExecutionContext,
    expected: { pathname: string; landmark: string; auditTarget: string },
  ): Promise<void> {
    if (await session.hasLandmark(CAPTCHA_LANDMARK)) {
      await session.recordCaptchaWaiting(expected.auditTarget);
      await this.#humanVerification.wait({
        source: session,
        signal: execution.signal,
        revalidate: async (sameSession) => {
          await assertExpectedVisiblePage(sameSession, this.#origin, expected.pathname, expected.landmark);
        },
      });
    }
    if (await session.hasLandmark(SOFT_BLOCK_LANDMARK)) throw new LiveBlockedError("soft_block");
    await assertExpectedVisiblePage(session, this.#origin, expected.pathname, expected.landmark);
  }

  #projectedRaw(
    projection: BrowserCaptureProjection,
    finalUrl: string,
    candidateEvidence: ReturnType<typeof createCandidateEvidence> | null,
    identity: { runId: string; page: number; sourceRecordKey?: string },
    navigationStatus: number | null = 200,
  ): ReturnType<typeof checksumBrowserRawBundle> {
    return checksumBrowserRawBundle({
      sourceKind: SOURCE_KIND,
      parserVersion: this.#parserVersion,
      finalUrl: sanitizeBrowserUrl(finalUrl, projection.sensitiveFormFieldNames),
      capturedAt: this.#now().toISOString(),
      navigationStatus,
      sanitizedDomUtf8: projection.sanitizedDomUtf8,
      redactedScreenshotPng: new Uint8Array(),
      pageFingerprintSha256: sha256(projection.sanitizedDomUtf8),
      identity,
      candidateEvidence,
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
  pathname: string,
  landmark: string,
): Promise<void> {
  const current = new URL(await session.currentUrl());
  if (current.origin !== origin || current.pathname !== pathname || !await session.hasLandmark(landmark)) {
    throw new BrowserContractError("visible page identity changed during manual verification");
  }
}

async function verifyResultsIdentity(session: BrowserSession, scope: DiscoveryScope, page: number): Promise<void> {
  if (await session.readLabeledText("ОКВЭД") !== scope.okved
    || await session.readLabeledText("Страница") !== String(page)) {
    throw new BrowserContractError("rendered result page identity does not match the requested search");
  }
}

function parseCompanyLink(href: string, origin: string): { href: string; sourceRecordKey: string } | undefined {
  const url = new URL(href);
  const match = /^\/company\/([1-9][0-9]*)$/u.exec(url.pathname);
  if (match?.[1] === undefined) return undefined;
  if (url.origin !== origin || url.search !== "" || url.hash !== "") {
    throw new BrowserContractError("company link escaped the exact List-Org source contract");
  }
  return { href: url.href, sourceRecordKey: match[1] };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function makePage(
  page: number,
  raw: ReturnType<typeof checksumBrowserRawBundle>,
  occurrences: readonly DiscoveryOccurrence[],
  orderedSourceRecordKeys: readonly string[],
  resultFingerprintSha256: string,
): DiscoveryPage {
  return { page, raw, occurrences: [...occurrences], orderedSourceRecordKeys: [...orderedSourceRecordKeys], resultFingerprintSha256 };
}

function makeResult(
  status: DiscoveryResult["status"],
  reason: string,
  companies: readonly DiscoveredCompany[],
  pages: readonly DiscoveryPage[],
  rawBundles: readonly ReturnType<typeof checksumBrowserRawBundle>[],
  rejects: readonly DiscoveryReject[],
  blockers: readonly DiscoveryBlocker[],
): DiscoveryResult {
  return { status, reason, companies, pages, rawBundles, rejects, blockers };
}

async function safeHeadingProjection(session: BrowserSession): Promise<BrowserCaptureProjection> {
  try {
    return await session.captureProjection(["main > h1"]);
  } catch {
    return {
      selectors: ["synthetic-terminal-marker"],
      sanitizedDomUtf8: new TextEncoder().encode("<!doctype html><html><body><main>terminal source failure</main></body></html>"),
      sensitiveFormFieldNames: [],
    };
  }
}

async function safeCurrentUrl(session: BrowserSession, fallback: string): Promise<string> {
  try { return await session.currentUrl(); } catch { return fallback; }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
