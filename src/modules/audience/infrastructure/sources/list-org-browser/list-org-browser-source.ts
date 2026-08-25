import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { BrowserSession, BrowserSessionFactory } from "../../../application/ports/browser-session";
import { createCandidateEvidence } from "../../../domain/candidate-evidence";
import {
  ExternalBrowserRequestError,
  type BrowserRawBundle,
  type DiscoveryExecutionContext,
  type DiscoveryBlocker,
  type DiscoveryOccurrence,
  type DiscoveryPage,
  type DiscoveryReject,
  type DiscoveryResult,
  type DiscoveryScope,
  type DiscoveredCompany,
  type OrganizationSource,
} from "../../../domain/discovery";
import { checksumBrowserRawBundle, sha256 } from "../../storage/raw-bundle";
import {
  assertBrowserCaptureSafe,
  assertPageVisualSurfacesSafe,
  BROWSER_VISUAL_SAFETY_ACTION_KIND,
  BROWSER_VISUAL_SAFETY_POLICY,
  collectPageSensitiveUrlValues,
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  preparePageCapture,
  sanitizeBrowserActionTarget,
  sanitizePageDom,
  sanitizeBrowserUrl as sanitizeUrl,
  sensitiveBrowserUrlValues,
} from "./browser-raw-sanitizer";
import { BrowserActionRecorder } from "./browser-action-recorder";
import {
  BrowserContractError,
  readCompany,
  sameBrowserRecordResult,
  verifyRenderedFilters,
  type BrowserRecordResult,
} from "./browser-record-policy";

export { ExternalBrowserRequestError } from "../../../domain/discovery";

const RESULTS_LANDMARK = "Результаты поиска";
const CARD_LANDMARK = "Карточка организации";
export interface ListOrgBrowserSourceOptions {
  searchUrl: string;
  sessions: BrowserSessionFactory;
  runId: string;
  parserVersion: string;
}

export class ListOrgBrowserSource implements OrganizationSource {
  readonly #searchUrl: string;
  readonly #sessions: BrowserSessionFactory;
  readonly #runId: string;
  readonly #parserVersion: string;

  constructor(options: ListOrgBrowserSourceOptions) {
    this.#searchUrl = options.searchUrl;
    this.#sessions = options.sessions;
    this.#runId = options.runId;
    if (options.parserVersion.trim() === "") throw new Error("parser version is required");
    this.#parserVersion = options.parserVersion;
  }

  async collect(
    scope: DiscoveryScope,
    execution: DiscoveryExecutionContext = {},
  ): Promise<DiscoveryResult> {
    if (!isPositiveSafeInteger(scope.maxPages) || !isPositiveSafeInteger(scope.maxCompanies)) {
      throw new Error("discovery limits must be positive safe integers");
    }

    const session = await this.#sessions.open(execution);
    const companies: DiscoveredCompany[] = [];
    const pages: DiscoveryPage[] = [];
    const rawBundles: ReturnType<typeof checksumBrowserRawBundle>[] = [];
    const rejects: DiscoveryReject[] = [];
    const blockers: DiscoveryBlocker[] = [];
    const firstSeen = new Map<string, BrowserRecordResult>();
    let currentPage = 1;
    let currentOccurrences: DiscoveryOccurrence[] = [];
    let currentOrderedSourceRecordKeys: readonly string[] = [];
    let currentResultFingerprintSha256 = "";
    let priorPageIdentity: {
      orderedSourceRecordKeys: readonly string[];
      resultFingerprintSha256: string;
    } | undefined;
    const seenPageSourceRecordKeys = new Set<string>();

    const block = async (
      reason: string,
      options: {
        sourceRecordKey?: string;
        detail?: string;
        raw?: ReturnType<typeof checksumBrowserRawBundle>;
      } = {},
    ): Promise<DiscoveryResult> => {
      const raw = options.raw ?? checksumBrowserRawBundle(await session.captureBlocker({
        runId: this.#runId,
        page: currentPage,
        ...(options.sourceRecordKey === undefined ? {} : { sourceRecordKey: options.sourceRecordKey }),
      }, this.#parserVersion));
      if (!rawBundles.includes(raw)) rawBundles.push(raw);
      if (currentOccurrences.length > 0
        && !pages.some((page) => page.page === currentPage)) {
        const pageRaw = raw.identity.sourceRecordKey === undefined
          ? raw
          : checksumBrowserRawBundle(await session.captureBlocker({
              runId: this.#runId,
              page: currentPage,
            }, this.#parserVersion));
        if (!rawBundles.includes(pageRaw)) rawBundles.push(pageRaw);
        pages.push({
          page: currentPage,
          raw: pageRaw,
          occurrences: [...currentOccurrences],
          orderedSourceRecordKeys: [...currentOrderedSourceRecordKeys],
          resultFingerprintSha256: currentResultFingerprintSha256,
        });
      }
      blockers.push({
        reason,
        ...(options.sourceRecordKey === undefined ? {} : { sourceRecordKey: options.sourceRecordKey }),
        ...(options.detail === undefined ? {} : { detail: options.detail }),
        raw,
      });
      return result("blocked", reason, companies, pages, rawBundles, rejects, blockers);
    };

    try {
      const status = await session.navigate(this.#searchUrl);
      if (status === 403) {
        return await block("http_403");
      }
      if (await session.hasLandmark("Подтверждение CAPTCHA")) {
        return await block("captcha");
      }
      if (await session.hasLandmark("Доступ временно ограничен")) {
        return await block("soft_block");
      }

      await session.fillField("ОКВЭД", scope.okved);
      await session.setCheckbox("Только действующие", scope.onlyActive);
      if (await session.clickButton("Найти организации") === 403) {
        return await block("http_403");
      }

      for (let pageNumber = 1; pageNumber <= scope.maxPages; pageNumber += 1) {
        currentPage = pageNumber;
        currentOccurrences = [];
        const occurrences = currentOccurrences;
        if (await session.hasLandmark("Подтверждение CAPTCHA")) {
          return await block("captcha");
        }
        if (await session.hasLandmark("Доступ временно ограничен")) {
          return await block("soft_block");
        }
        await session.waitForLandmark(RESULTS_LANDMARK);
        await verifyRenderedFilters(session, scope);

        const linkNames = await session.linkNamesInLandmark(RESULTS_LANDMARK, "Открыть карточку ");
        currentOrderedSourceRecordKeys = linkNames.map(sourceRecordKeyFromLinkName);
        currentResultFingerprintSha256 = await session.fingerprint();
        assertPaginationAdvance(
          priorPageIdentity,
          currentOrderedSourceRecordKeys,
          currentResultFingerprintSha256,
          seenPageSourceRecordKeys,
        );
        for (const sourceRecordKey of currentOrderedSourceRecordKeys) {
          seenPageSourceRecordKeys.add(sourceRecordKey);
        }
        priorPageIdentity = {
          orderedSourceRecordKeys: [...currentOrderedSourceRecordKeys],
          resultFingerprintSha256: currentResultFingerprintSha256,
        };

        for (const linkName of linkNames) {
          const before = await session.fingerprint();
          if (await session.clickLink(linkName) === 403) {
            return await block("http_403");
          }
          await session.waitForLandmark(CARD_LANDMARK);

          let parsed = await readCompany(session, scope);
          const capturedCard = await session.capture(
            { runId: this.#runId, page: pageNumber, sourceRecordKey: parsed.sourceRecordKey },
            this.#parserVersion,
            parsed.kind === "accepted" && parsed.company.website !== null
              ? ["Телефон", "Email", "Сайт"]
              : ["Телефон", "Email"],
          );
          if (parsed.kind === "accepted" && parsed.company.website !== null) {
            parsed = {
              ...parsed,
              company: {
                ...parsed.company,
                website: sanitizeCandidateWebsite(
                  parsed.company.website,
                  capturedCard.sensitiveFormFieldNames ?? [],
                ),
              },
            };
          }
          const cardRaw = checksumBrowserRawBundle({
            ...capturedCard,
            candidateEvidence: parsed.kind === "accepted"
              ? createCandidateEvidence(parsed.company)
              : null,
          });
          rawBundles.push(cardRaw);

          if (await session.clickLink("Вернуться к результатам") === 403) {
            return await block("http_403");
          }
          await session.waitForLandmark(RESULTS_LANDMARK);
          const after = await session.fingerprint();
          if (after !== before) {
            throw new BrowserContractError("result page changed after visiting a company card");
          }

          occurrences.push({
            sourceRecordKey: parsed.sourceRecordKey,
            resultFingerprintBefore: before,
            resultFingerprintAfter: after,
          });

          const prior = firstSeen.get(parsed.sourceRecordKey);
          if (prior !== undefined && !sameBrowserRecordResult(prior, parsed)) {
            removeMaterializedRecord(parsed.sourceRecordKey, companies, rejects);
            firstSeen.delete(parsed.sourceRecordKey);
            return await block("duplicate_conflict", {
              sourceRecordKey: parsed.sourceRecordKey,
              raw: cardRaw,
            });
          }
          if (prior !== undefined) continue;
          firstSeen.set(parsed.sourceRecordKey, parsed);

          if (parsed.kind === "rejected") {
            rejects.push({
              sourceRecordKey: parsed.sourceRecordKey,
              reason: parsed.reason,
              raw: cardRaw,
            });
            continue;
          }

          const company = parsed.company;
          companies.push({
            ...company,
            rawFetchKey: cardRaw.checksumSha256,
            parserVersion: this.#parserVersion,
          });
          if (companies.length === scope.maxCompanies) {
            const pageRaw = checksumBrowserRawBundle(await session.capture({
              runId: this.#runId,
              page: pageNumber,
            }, this.#parserVersion));
            rawBundles.push(pageRaw);
            pages.push({
              page: pageNumber,
              raw: pageRaw,
              occurrences,
              orderedSourceRecordKeys: [...currentOrderedSourceRecordKeys],
              resultFingerprintSha256: currentResultFingerprintSha256,
            });
            return result("limited", "max_companies", companies, pages, rawBundles, rejects, blockers);
          }
        }

        const pageRaw = checksumBrowserRawBundle(await session.capture({
          runId: this.#runId,
          page: pageNumber,
        }, this.#parserVersion));
        rawBundles.push(pageRaw);
        pages.push({
          page: pageNumber,
          raw: pageRaw,
          occurrences,
          orderedSourceRecordKeys: [...currentOrderedSourceRecordKeys],
          resultFingerprintSha256: currentResultFingerprintSha256,
        });

        if (await session.hasVisibleText("Последняя страница")) {
          return result("succeeded", "terminal_marker", companies, pages, rawBundles, rejects, blockers);
        }
        if (pageNumber === scope.maxPages) {
          return result("limited", "max_pages", companies, pages, rawBundles, rejects, blockers);
        }

        if (await session.clickLink("Следующая страница") === 403) {
          return await block("http_403");
        }
      }

      return result("limited", "max_pages", companies, pages, rawBundles, rejects, blockers);
    } catch (error) {
      if (error instanceof BrowserContractError) {
        return await block("contract_drift");
      }
      if (error instanceof ExternalBrowserRequestError) {
        return await block("policy_block", { detail: error.origins.join(", ") });
      }
      throw error;
    } finally {
      await session.close();
    }
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function sourceRecordKeyFromLinkName(value: string): string {
  const match = /^Открыть карточку ([1-9][0-9]*)\b/u.exec(value);
  if (match?.[1] === undefined) {
    throw new BrowserContractError("company link accessible name lacks a stable source record key");
  }
  return match[1];
}

function assertPaginationAdvance(
  prior: { orderedSourceRecordKeys: readonly string[]; resultFingerprintSha256: string } | undefined,
  currentKeys: readonly string[],
  currentFingerprint: string,
  seenKeys: ReadonlySet<string>,
): void {
  if (prior === undefined) return;
  if (currentFingerprint === prior.resultFingerprintSha256) {
    throw new BrowserContractError("pagination did not change the rendered result page");
  }
  let overlap = 0;
  const maximumOverlap = Math.min(prior.orderedSourceRecordKeys.length, currentKeys.length);
  for (let size = maximumOverlap; size > 0; size -= 1) {
    const boundary = prior.orderedSourceRecordKeys.slice(-size);
    if (boundary.every((key, index) => key === currentKeys[index])) {
      overlap = size;
      break;
    }
  }
  if (currentKeys.slice(0, overlap).some((key) => !seenKeys.has(key))) {
    throw new BrowserContractError("pagination boundary is not a prior-page suffix");
  }
  const newKeys = currentKeys.slice(overlap);
  if (newKeys.length === 0 || newKeys.every((key) => seenKeys.has(key))) {
    throw new BrowserContractError("pagination produced no new source records");
  }
  if (newKeys.some((key) => seenKeys.has(key))) {
    throw new BrowserContractError("pagination reordered a stale source record after its boundary");
  }
}

function sanitizeCandidateWebsite(
  value: string,
  sensitiveQueryParameters: readonly string[],
): string {
  try {
    const sanitized = sanitizeUrl(value, sensitiveQueryParameters);
    const original = new URL(value);
    return value === original.origin ? new URL(sanitized).origin : sanitized;
  } catch (error) {
    throw new BrowserContractError(messageOf(error));
  }
}

function removeMaterializedRecord(
  sourceRecordKey: string,
  companies: DiscoveredCompany[],
  rejects: DiscoveryReject[],
): void {
  const companyIndex = companies.findIndex((company) => company.sourceRecordKey === sourceRecordKey);
  if (companyIndex >= 0) companies.splice(companyIndex, 1);
  const rejectIndex = rejects.findIndex((reject) => reject.sourceRecordKey === sourceRecordKey);
  if (rejectIndex >= 0) rejects.splice(rejectIndex, 1);
}

function result(
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

export interface PlaywrightBrowserSessionFactoryOptions {
  now?: () => Date;
  sensitiveQueryParameters?: readonly string[];
  launch?: () => Promise<Browser>;
}

export class PlaywrightBrowserSessionFactory implements BrowserSessionFactory {
  readonly #allowedOrigin: string;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #launch: () => Promise<Browser>;

  constructor(allowedOrigin: string, options: PlaywrightBrowserSessionFactoryOptions = {}) {
    this.#allowedOrigin = new URL(allowedOrigin).origin;
    this.#now = options.now ?? (() => new Date());
    this.#sensitiveQueryParameters = [...new Set([
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...(options.sensitiveQueryParameters ?? []),
    ])];
    this.#launch = options.launch ?? (() => chromium.launch({ headless: true }));
  }

  async open(execution: DiscoveryExecutionContext = {}): Promise<BrowserSession> {
    const browser = await this.#launch();
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      return await PlaywrightBrowserSession.create(
        browser,
        context,
        this.#allowedOrigin,
        this.#now,
        this.#sensitiveQueryParameters,
        execution,
      );
    } catch (error) {
      if (context !== undefined) await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}

class PlaywrightBrowserSession implements BrowserSession {
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #actions: BrowserActionRecorder;
  readonly #externalOrigins: Set<string>;
  readonly #sensitiveValues: Set<string>;
  #navigationStatus: number | null = null;
  #externalRequestsAcknowledged = false;

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    now: () => Date,
    sensitiveQueryParameters: readonly string[],
    execution: DiscoveryExecutionContext,
    externalOrigins: Set<string>,
    sensitiveValues: Set<string>,
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#now = now;
    this.#sensitiveQueryParameters = sensitiveQueryParameters;
    this.#externalOrigins = externalOrigins;
    this.#sensitiveValues = sensitiveValues;
    this.#actions = new BrowserActionRecorder(
      execution,
      now,
      () => this.#navigationStatus,
      (target) => sanitizeBrowserActionTarget(
        target,
        this.#sensitiveQueryParameters,
        [...this.#sensitiveValues],
      ),
    );
  }

  static async create(
    browser: Browser,
    context: BrowserContext,
    allowedOrigin: string,
    now: () => Date,
    sensitiveQueryParameters: readonly string[],
    execution: DiscoveryExecutionContext,
  ): Promise<PlaywrightBrowserSession> {
    const externalOrigins = new Set<string>();
    const sensitiveValues = new Set<string>();
    await context.routeWebSocket("**/*", async (webSocket) => {
      const requestUrl = webSocket.url();
      for (const value of sensitiveBrowserUrlValues(requestUrl, sensitiveQueryParameters)) {
        sensitiveValues.add(value);
      }
      let origins: { policy: string; evidence: string };
      try {
        origins = browserRequestOrigins(requestUrl);
      } catch {
        externalOrigins.add(requestUrl);
        await webSocket.close({ code: 1008, reason: "fixture origin policy" });
        return;
      }
      if (origins.policy === allowedOrigin) {
        webSocket.connectToServer();
        return;
      }
      externalOrigins.add(origins.evidence);
      await webSocket.close({ code: 1008, reason: "fixture origin policy" });
    });
    await context.addInitScript(() => {
      const closedShadowHosts = new Set<Element>();
      Object.defineProperty(window, "__okvedClosedShadowAttempt", {
        configurable: false,
        get: () => [...closedShadowHosts].some((host) => host.isConnected),
      });
      const attachShadow = Element.prototype.attachShadow;
      Object.defineProperty(Element.prototype, "attachShadow", {
        configurable: false,
        writable: false,
        value: function (this: Element, init: ShadowRootInit): ShadowRoot {
          if (init.mode === "closed") closedShadowHosts.add(this);
          return attachShadow.call(this, init);
        },
      });
      if (navigator.serviceWorker !== undefined) {
        Object.defineProperty(navigator.serviceWorker, "register", {
          configurable: false,
          value: () => Promise.reject(new Error("service worker registration blocked")),
        });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(2_000);
    const session = new PlaywrightBrowserSession(
      browser,
      context,
      page,
      now,
      sensitiveQueryParameters,
      execution,
      externalOrigins,
      sensitiveValues,
    );

    context.on("page", (secondaryPage) => {
      if (secondaryPage === page) return;
      session.#externalOrigins.add("secondary-page");
      void secondaryPage.close().catch(() => undefined);
    });
    page.on("download", (download) => {
      session.#externalOrigins.add("download");
      void download.cancel().catch(() => undefined);
    });

    page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        session.#navigationStatus = response.status();
      }
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      session.#rememberSensitiveValues(requestUrl);
      if (requestUrl.startsWith("data:")) {
        await route.continue();
        return;
      }
      let origins: { policy: string; evidence: string };
      try {
        origins = browserRequestOrigins(requestUrl);
      } catch {
        session.#externalOrigins.add(requestUrl);
        await route.abort("blockedbyclient");
        return;
      }
      if (origins.policy === allowedOrigin) {
        await route.continue();
        return;
      }
      session.#externalOrigins.add(origins.evidence);
      await route.abort("blockedbyclient");
    });

    return session;
  }

  async navigate(url: string): Promise<number | null> {
    this.#rememberSensitiveValues(url);
    const target = sanitizeUrl(url, this.#sensitiveQueryParameters);
    const actionId = await this.#actions.begin("navigate", target);
    try {
      const response = await this.#page.goto(url, { waitUntil: "load" });
      this.#navigationStatus = response?.status() ?? null;
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, "navigate", target, "completed");
      return this.#navigationStatus;
    } catch (error) {
      await this.#actions.finish(actionId, "navigate", target, "failed");
      this.#assertNoExternalRequests();
      throw error;
    }
  }

  async fillField(label: string, value: string): Promise<void> {
    await this.#contractAction("fill", label, async () => {
      await this.#page.getByLabel(label, { exact: true }).fill(value);
    });
  }

  async setCheckbox(label: string, checked: boolean): Promise<void> {
    await this.#contractAction("set-checkbox", label, async () => {
      await this.#page.getByLabel(label, { exact: true }).setChecked(checked);
    });
  }

  async clickButton(name: string): Promise<number | null> {
    return this.#contractAction("click-button", name, async () => {
      await this.#page.getByRole("button", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
      return this.#navigationStatus;
    });
  }

  async clickLink(name: string): Promise<number | null> {
    return this.#contractAction("click-link", name, async () => {
      await this.#page.getByRole("link", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
      return this.#navigationStatus;
    });
  }

  async waitForLandmark(name: string): Promise<void> {
    await this.#contractAction("wait-landmark", name, async () => {
      await this.#page.getByRole("main", { name, exact: true }).waitFor({ state: "visible" });
    });
  }

  async hasLandmark(name: string): Promise<boolean> {
    this.#assertNoExternalRequests();
    return this.#page.getByRole("main", { name, exact: true }).isVisible();
  }

  async hasVisibleText(text: string): Promise<boolean> {
    this.#assertNoExternalRequests();
    return this.#page.getByText(text, { exact: true }).isVisible();
  }

  async readLabeledText(label: string): Promise<string> {
    const actionId = await this.#beginAction("read-labeled-text", label);
    try {
      const values = await this.#exactLabeledValues(label);
      if (values.length !== 1) {
        throw new Error(`expected exactly one value for label ${label}`);
      }
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, "read-labeled-text", label, "completed");
      return values[0];
    } catch (error) {
      await this.#actions.finish(actionId, "read-labeled-text", label, "contract-drift");
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async readLabeledTexts(label: string): Promise<readonly string[]> {
    const actionId = await this.#beginAction("read-labeled-texts", label);
    try {
      const values = await this.#exactLabeledValues(label);
      if (values.length === 0) {
        throw new Error(`expected at least one value for label ${label}`);
      }
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, "read-labeled-texts", label, "completed");
      return values;
    } catch (error) {
      await this.#actions.finish(actionId, "read-labeled-texts", label, "contract-drift");
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async readFirstLabeledText(label: string): Promise<string> {
    const actionId = await this.#beginAction("read-first-labeled-text", label);
    try {
      const values = await this.#exactLabeledValues(label);
      if (values.length === 0) {
        throw new Error(`expected at least one value for repeatable label ${label}`);
      }
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, "read-first-labeled-text", label, "completed");
      return values[0];
    } catch (error) {
      await this.#actions.finish(actionId, "read-first-labeled-text", label, "contract-drift");
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]> {
    const target = `${name}:${accessibleNamePrefix}`;
    const actionId = await this.#beginAction("read-links", target);
    try {
      const links = await this.#page.getByRole("main", { name, exact: true }).getByRole("link").all();
      const result: string[] = [];
      for (const link of links) {
        const linkName = (await link.innerText()).trim();
        if (linkName.startsWith(accessibleNamePrefix)) {
          result.push(linkName);
        }
      }
      if (result.length === 0) {
        throw new Error("result landmark contains no company links");
      }
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, "read-links", target, "completed");
      return result;
    } catch (error) {
      await this.#actions.finish(actionId, "read-links", target, "contract-drift");
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async fingerprint(): Promise<string> {
    const dom = await sanitizePageDom(
      this.#page,
      this.#sensitiveQueryParameters,
      [],
      [...this.#sensitiveValues],
    );
    this.#assertNoExternalRequests();
    return sha256(dom);
  }

  async capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues: readonly string[] = [],
  ): Promise<BrowserRawBundle> {
    return this.#capture(identity, parserVersion, redactLabeledValues, true);
  }

  async captureBlocker(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
  ): Promise<BrowserRawBundle> {
    this.#externalRequestsAcknowledged = true;
    try {
      await assertPageVisualSurfacesSafe(this.#page);
    } catch {
      await this.#page.setContent(
        "<!doctype html><html><body><main aria-label=\"Browser policy block\"><h1>Browser policy block</h1></main></body></html>",
        { waitUntil: "load" },
      );
    }
    return this.#capture(identity, parserVersion, ["Телефон", "Email"], false);
  }

  async #capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues: readonly string[],
    requireEveryLabel: boolean,
  ): Promise<BrowserRawBundle> {
    const target = identity.sourceRecordKey ?? `page/${identity.page}`;
    const actionId = await this.#beginAction("capture", target);
    const visualSafetyActionId = await this.#beginAction(
      BROWSER_VISUAL_SAFETY_ACTION_KIND,
      BROWSER_VISUAL_SAFETY_POLICY,
    );
    let sanitizedDomUtf8: Uint8Array;
    let redactedScreenshotPng: Uint8Array;
    let redactionValues: readonly string[];
    try {
      await assertPageVisualSurfacesSafe(this.#page);
      const labeledValues = (await Promise.all(
        redactLabeledValues.map((label) => this.#exactLabeledValues(label)),
      )).flat();
      const pageUrlValues = await collectPageSensitiveUrlValues(
        this.#page,
        this.#sensitiveQueryParameters,
      );
      redactionValues = [...new Set([
        ...this.#sensitiveValues,
        ...labeledValues,
        ...pageUrlValues,
      ])];
      const prepared = await preparePageCapture(
        this.#page,
        this.#sensitiveQueryParameters,
        redactLabeledValues,
        redactionValues,
      );
      sanitizedDomUtf8 = prepared.sanitizedDomUtf8;
      if (requireEveryLabel
        && redactLabeledValues.some((label) => (prepared.overlayCounts[label] ?? 0) === 0)) {
        throw new Error("a sensitive contact label had no value to redact");
      }
      await assertPageVisualSurfacesSafe(this.#page);
      redactedScreenshotPng = await this.#page.screenshot({ fullPage: true, type: "png" });
      await assertPageVisualSurfacesSafe(this.#page);
      if (!this.#externalRequestsAcknowledged) this.#assertNoExternalRequests();
    } catch (error) {
      await this.#actions.finish(
        visualSafetyActionId,
        BROWSER_VISUAL_SAFETY_ACTION_KIND,
        BROWSER_VISUAL_SAFETY_POLICY,
        "contract-drift",
      );
      await this.#actions.finish(actionId, "capture", target, "contract-drift");
      if (error instanceof ExternalBrowserRequestError) throw error;
      throw new BrowserContractError(messageOf(error));
    } finally {
      await this.#page.locator("[data-browser-capture-redaction]").evaluateAll((elements) => {
        for (const element of elements) element.remove();
      }).catch(() => undefined);
    }
    await this.#actions.finish(
      visualSafetyActionId,
      BROWSER_VISUAL_SAFETY_ACTION_KIND,
      BROWSER_VISUAL_SAFETY_POLICY,
      "completed",
    );
    await this.#actions.finish(actionId, "capture", target, "completed");

    const bundle: BrowserRawBundle = {
      sourceKind: "list-org-browser",
      parserVersion,
      finalUrl: sanitizeUrl(this.#page.url(), this.#sensitiveQueryParameters),
      capturedAt: this.#now().toISOString(),
      navigationStatus: this.#navigationStatus,
      sanitizedDomUtf8,
      redactedScreenshotPng,
      pageFingerprintSha256: sha256(sanitizedDomUtf8),
      identity,
      candidateEvidence: null,
      actions: [...this.#actions.events],
      sensitiveFormFieldNames: [...this.#sensitiveQueryParameters],
    };
    assertBrowserCaptureSafe(bundle, redactionValues);
    return bundle;
  }

  async close(): Promise<void> {
    try {
      await this.#context.close();
    } finally {
      await this.#browser.close();
    }
    if (!this.#externalRequestsAcknowledged) this.#assertNoExternalRequests();
  }

  async #contractAction<T>(kind: string, target: string, action: () => Promise<T>): Promise<T> {
    const actionId = await this.#beginAction(kind, target);
    try {
      const value = await action();
      this.#assertNoExternalRequests();
      await this.#actions.finish(actionId, kind, target, "completed");
      return value;
    } catch (error) {
      await this.#actions.finish(actionId, kind, target, "contract-drift");
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async #beginAction(kind: string, target: string): Promise<string> {
    const values = await collectPageSensitiveUrlValues(
      this.#page,
      this.#sensitiveQueryParameters,
    );
    for (const value of values) this.#sensitiveValues.add(value);
    return this.#actions.begin(kind, target);
  }

  async #exactLabeledValues(label: string): Promise<string[]> {
    const values: string[] = [];
    for (const candidate of await this.#page.locator("dt").all()) {
      if ((await candidate.innerText()).trim() !== label) continue;
      const value = await candidate.evaluate(
        (element) => element.nextElementSibling?.textContent ?? "",
      );
      if (value.trim() === "") throw new Error(`labeled value ${label} is empty`);
      values.push(value.trim());
    }
    return values;
  }

  #rememberSensitiveValues(url: string): void {
    for (const value of sensitiveBrowserUrlValues(url, this.#sensitiveQueryParameters)) {
      this.#sensitiveValues.add(value);
    }
  }

  #assertNoExternalRequests(): void {
    if (this.#externalOrigins.size > 0) {
      throw new ExternalBrowserRequestError([...this.#externalOrigins].sort());
    }
  }
}

function browserRequestOrigins(value: string): { policy: string; evidence: string } {
  const url = new URL(value);
  const evidence = url.origin;
  const policyProtocol = url.protocol === "ws:"
    ? "http:"
    : url.protocol === "wss:"
      ? "https:"
      : url.protocol;
  return { policy: `${policyProtocol}//${url.host}`, evidence };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
