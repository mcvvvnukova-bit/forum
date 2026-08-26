import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type {
  BrowserCaptureProjection,
  BrowserOriginPolicy,
  BrowserPolicyViolation,
  BrowserSession,
  PolicyBrowserSessionFactory as PolicyBrowserSessionFactoryPort,
} from "../../../application/ports/browser-session";
import type { BrowserRawBundle, DiscoveryExecutionContext } from "../../../domain/discovery";
import { ExternalBrowserRequestError } from "../../../domain/discovery";
import { sha256 } from "../../storage/raw-bundle";
import { BrowserActionRecorder } from "../list-org-browser/browser-action-recorder";
import {
  assertBrowserCaptureSafe,
  assertSanitizedPageDomSafe,
  BROWSER_VISUAL_SAFETY_ACTION_KIND,
  browserVisualSafetyTarget,
  collectPageSensitiveUrlValues,
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  preparePageCapture,
  sanitizeBrowserActionTarget,
  sanitizeBrowserUrl,
  sanitizePageDom,
  sensitiveBrowserUrlValues,
} from "../list-org-browser/browser-raw-sanitizer";

export type { BrowserCaptureProjection, BrowserOriginPolicy, BrowserPolicyViolation };

export class BrowserPolicyContractError extends Error {}

export interface PolicyBrowserSessionFactoryOptions {
  now?: () => Date;
  sensitiveQueryParameters?: readonly string[];
  launch?: () => Promise<Browser>;
  sourceKind?: string;
}

export class PolicyBrowserSessionFactory implements PolicyBrowserSessionFactoryPort {
  readonly policy: BrowserOriginPolicy;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #allowedDownloadOrigins: ReadonlySet<string>;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #launch: () => Promise<Browser>;
  readonly #sourceKind: string;

  constructor(policy: BrowserOriginPolicy, options: PolicyBrowserSessionFactoryOptions = {}) {
    const normalized = normalizePolicy(policy);
    this.policy = normalized.policy;
    this.#allowedOrigins = normalized.allowedOrigins;
    this.#allowedDownloadOrigins = normalized.allowedDownloadOrigins;
    this.#now = options.now ?? (() => new Date());
    this.#sensitiveQueryParameters = [...new Set([
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...(options.sensitiveQueryParameters ?? []),
    ])];
    this.#launch = options.launch ?? (() => chromium.launch({ headless: true }));
    this.#sourceKind = options.sourceKind ?? "list-org-browser";
  }

  async open(execution: DiscoveryExecutionContext = {}): Promise<BrowserSession> {
    const browser = await this.#launch();
    let context: BrowserContext | undefined;
    let renderContext: BrowserContext | undefined;
    try {
      context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
      renderContext = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
        javaScriptEnabled: false,
      });
      return await PolicyBrowserSession.create({
        browser,
        context,
        renderContext,
        allowedOrigins: this.#allowedOrigins,
        allowedDownloadOrigins: this.#allowedDownloadOrigins,
        now: this.#now,
        sensitiveQueryParameters: this.#sensitiveQueryParameters,
        execution,
        sourceKind: this.#sourceKind,
      });
    } catch (error) {
      if (renderContext !== undefined) await renderContext.close().catch(() => undefined);
      if (context !== undefined) await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}

class PolicyBrowserSession implements BrowserSession {
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #renderContext: BrowserContext;
  readonly #page: Page;
  readonly #renderPage: Page;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #allowedDownloadOrigins: ReadonlySet<string>;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #sourceKind: string;
  readonly #actions: BrowserActionRecorder;
  readonly #terminalOrigins: Set<string>;
  readonly #violations: BrowserPolicyViolation[] = [];
  readonly #sensitiveValues = new Set<string>();
  readonly #renderRequests = new Set<string>();
  #navigationStatus: number | null = null;
  #terminalAcknowledged = false;

  private constructor(options: {
    browser: Browser;
    context: BrowserContext;
    renderContext: BrowserContext;
    page: Page;
    renderPage: Page;
    allowedOrigins: ReadonlySet<string>;
    allowedDownloadOrigins: ReadonlySet<string>;
    now: () => Date;
    sensitiveQueryParameters: readonly string[];
    execution: DiscoveryExecutionContext;
    sourceKind: string;
    renderRequests: Set<string>;
    terminalOrigins: Set<string>;
  }) {
    this.#browser = options.browser;
    this.#context = options.context;
    this.#renderContext = options.renderContext;
    this.#page = options.page;
    this.#renderPage = options.renderPage;
    this.#allowedOrigins = options.allowedOrigins;
    this.#allowedDownloadOrigins = options.allowedDownloadOrigins;
    this.#now = options.now;
    this.#sensitiveQueryParameters = options.sensitiveQueryParameters;
    this.#sourceKind = options.sourceKind;
    this.#renderRequests = options.renderRequests;
    this.#terminalOrigins = options.terminalOrigins;
    this.#actions = new BrowserActionRecorder(
      options.execution,
      options.now,
      () => this.#navigationStatus,
      (target) => sanitizeBrowserActionTarget(
        target,
        this.#sensitiveQueryParameters,
        [...this.#sensitiveValues],
      ),
    );
  }

  static async create(options: {
    browser: Browser;
    context: BrowserContext;
    renderContext: BrowserContext;
    allowedOrigins: ReadonlySet<string>;
    allowedDownloadOrigins: ReadonlySet<string>;
    now: () => Date;
    sensitiveQueryParameters: readonly string[];
    execution: DiscoveryExecutionContext;
    sourceKind: string;
  }): Promise<PolicyBrowserSession> {
    const renderRequests = new Set<string>();
    const terminalOrigins = new Set<string>();
    await options.context.routeWebSocket("**/*", async (webSocket) => {
      const requestUrl = webSocket.url();
      let origin: string;
      try {
        origin = browserRequestOrigin(requestUrl).policy;
      } catch {
        terminalOrigins.add(requestUrl);
        await webSocket.close({ code: 1008, reason: "browser origin policy" });
        return;
      }
      if (options.allowedOrigins.has(origin)) {
        webSocket.connectToServer();
        return;
      }
      terminalOrigins.add(browserRequestOrigin(requestUrl).evidence);
      await webSocket.close({ code: 1008, reason: "browser origin policy" });
    });
    await options.context.exposeBinding("__okvedPolicyViolation", (_source, evidence: unknown) => {
      terminalOrigins.add(evidence === "service-worker-registration"
        ? evidence
        : "browser-policy-violation");
    });
    await options.context.addInitScript(() => {
      if (navigator.serviceWorker === undefined) return;
      const report = (window as unknown as Window & {
        __okvedPolicyViolation: (evidence: string) => Promise<void>;
      }).__okvedPolicyViolation;
      Object.defineProperty(navigator.serviceWorker, "register", {
        configurable: false,
        value: () => report("service-worker-registration").then(
          () => Promise.reject(new Error("service worker registration blocked")),
          () => Promise.reject(new Error("service worker registration blocked")),
        ),
      });
    });
    await options.renderContext.route("**/*", async (route) => {
      renderRequests.add(route.request().url());
      await route.abort("blockedbyclient");
    });
    const page = await options.context.newPage();
    const renderPage = await options.renderContext.newPage();
    page.setDefaultTimeout(2_000);
    renderPage.setDefaultTimeout(2_000);
    const session = new PolicyBrowserSession({
      ...options,
      page,
      renderPage,
      renderRequests,
      terminalOrigins,
    });

    options.context.on("page", (secondaryPage) => {
      if (secondaryPage === page) return;
      session.#recordViolation({ disposition: "terminal", resourceType: "popup", origin: "secondary-page" });
      session.#terminalOrigins.add("secondary-page");
      void secondaryPage.close().catch(() => undefined);
    });
    page.on("download", (download) => {
      let origin = "download";
      try { origin = browserRequestOrigin(download.url()).evidence; } catch { /* keep download evidence */ }
      if (!session.#allowedDownloadOrigins.has(origin)) {
        session.#recordViolation({ disposition: "terminal", resourceType: "download", origin: "download" });
        session.#terminalOrigins.add("download");
      }
      void download.cancel().catch(() => undefined);
    });
    page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        session.#navigationStatus = response.status();
      }
    });
    await options.context.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = request.url();
      session.#rememberSensitiveValues(requestUrl);
      if (requestUrl.startsWith("data:")) {
        await route.continue();
        return;
      }
      let origins: { policy: string; evidence: string };
      try {
        origins = browserRequestOrigin(requestUrl);
      } catch {
        session.#recordTerminalRequest(request.resourceType(), requestUrl);
        await route.abort("blockedbyclient");
        return;
      }
      if (session.#allowedOrigins.has(origins.policy)) {
        await route.continue();
        return;
      }
      let isSubframe = false;
      if (request.isNavigationRequest()) {
        try {
          isSubframe = request.frame() !== page.mainFrame();
        } catch {
          // Requests issued before a popup frame exists are terminal documents.
          isSubframe = false;
        }
      }
      const violation = classifyRequest(request.resourceType(), request.isNavigationRequest(), isSubframe, origins.evidence);
      session.#recordViolation(violation);
      if (violation.disposition === "terminal") session.#terminalOrigins.add(origins.evidence);
      await route.abort("blockedbyclient");
    });
    return session;
  }

  async navigate(url: string): Promise<number | null> {
    this.#rememberSensitiveValues(url);
    const target = sanitizeBrowserUrl(url, this.#sensitiveQueryParameters);
    const actionId = await this.#actions.begin("navigate", target);
    try {
      const response = await this.#page.goto(url, { waitUntil: "load" });
      this.#navigationStatus = response?.status() ?? null;
      await this.#page.waitForTimeout(50);
      this.#assertNoTerminalRequests();
      await this.#actions.finish(actionId, "navigate", target, "completed");
      return this.#navigationStatus;
    } catch (error) {
      await this.#actions.finish(actionId, "navigate", target, "failed");
      this.#assertNoTerminalRequests();
      throw error;
    }
  }

  async fillField(label: string, value: string): Promise<void> {
    await this.#contractAction("fill", label, () => this.#page.getByLabel(label, { exact: true }).fill(value));
  }

  async setCheckbox(label: string, checked: boolean): Promise<void> {
    await this.#contractAction("set-checkbox", label, () => this.#page.getByLabel(label, { exact: true }).setChecked(checked));
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
    await this.#contractAction("wait-landmark", name, () => this.#page.getByRole("main", { name, exact: true }).waitFor({ state: "visible" }));
  }

  async hasLandmark(name: string): Promise<boolean> {
    this.#assertNoTerminalRequests();
    return this.#page.getByRole("main", { name, exact: true }).isVisible();
  }

  async hasVisibleText(text: string): Promise<boolean> {
    this.#assertNoTerminalRequests();
    return this.#page.getByText(text, { exact: true }).isVisible();
  }

  async readLabeledText(label: string): Promise<string> {
    const values = await this.#readLabeledValues(label, "read-labeled-text", true);
    return values[0]!;
  }

  async readLabeledTexts(label: string): Promise<readonly string[]> {
    return this.#readLabeledValues(label, "read-labeled-texts", false);
  }

  async readFirstLabeledText(label: string): Promise<string> {
    const values = await this.#readLabeledValues(label, "read-first-labeled-text", false);
    return values[0]!;
  }

  async linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]> {
    const target = `${name}:${accessibleNamePrefix}`;
    return this.#contractAction("read-links", target, async () => {
      const links = await this.#page.getByRole("main", { name, exact: true }).getByRole("link").all();
      const values: string[] = [];
      for (const link of links) {
        const value = (await link.innerText()).trim();
        if (value.startsWith(accessibleNamePrefix)) values.push(value);
      }
      if (values.length === 0) throw new Error("result landmark contains no company links");
      return values;
    });
  }

  async fingerprint(): Promise<string> {
    const dom = await sanitizePageDom(this.#page, this.#sensitiveQueryParameters, [], [...this.#sensitiveValues]);
    this.#assertNoTerminalRequests();
    return sha256(dom);
  }

  async captureProjection(selectors: readonly string[]): Promise<BrowserCaptureProjection> {
    if (selectors.length === 0 || selectors.some((selector) => selector.trim() === "")) {
      throw new Error("capture projection requires at least one selector");
    }
    const target = selectors.join(";");
    const actionId = await this.#beginAction("capture-projection", target);
    try {
      const fragments: string[] = [];
      for (const selector of selectors) {
        const values = await this.#page.locator(selector).evaluateAll((elements) =>
          elements.map((element) => element.outerHTML),
        );
        if (values.length === 0) throw new Error(`capture projection selector matched no elements: ${selector}`);
        fragments.push(...values);
      }
      this.#renderRequests.clear();
      await this.#renderPage.setContent(
        `<!doctype html><html><body><main>${fragments.join("\n")}</main></body></html>`,
        { waitUntil: "load" },
      );
      if (this.#renderRequests.size > 0) throw new Error("projection renderer attempted network access");
      const sanitizedDomUtf8 = await sanitizePageDom(
        this.#renderPage,
        this.#sensitiveQueryParameters,
        [],
        [...this.#sensitiveValues],
      );
      assertSanitizedPageDomSafe(sanitizedDomUtf8, this.#sensitiveQueryParameters, [...this.#sensitiveValues]);
      this.#assertNoTerminalRequests();
      await this.#actions.finish(actionId, "capture-projection", target, "completed");
      return {
        selectors: [...selectors],
        sanitizedDomUtf8,
        sensitiveFormFieldNames: [...this.#sensitiveQueryParameters],
      };
    } catch (error) {
      await this.#actions.finish(actionId, "capture-projection", target, "contract-drift");
      if (error instanceof ExternalBrowserRequestError) throw error;
      throw new BrowserPolicyContractError(messageOf(error));
    }
  }

  async policyViolations(): Promise<readonly BrowserPolicyViolation[]> {
    return [...this.#violations];
  }

  async capture(identity: BrowserRawBundle["identity"], parserVersion: string, redactLabeledValues: readonly string[] = []): Promise<BrowserRawBundle> {
    return this.#capture(identity, parserVersion, redactLabeledValues, true);
  }

  async captureBlocker(identity: BrowserRawBundle["identity"], parserVersion: string): Promise<BrowserRawBundle> {
    this.#terminalAcknowledged = true;
    return this.#capture(identity, parserVersion, ["Телефон", "Email"], false);
  }

  async close(): Promise<void> {
    try {
      await Promise.all([this.#context.close(), this.#renderContext.close()]);
    } finally {
      await this.#browser.close();
    }
    if (!this.#terminalAcknowledged) this.#assertNoTerminalRequests();
  }

  async #capture(identity: BrowserRawBundle["identity"], parserVersion: string, redactLabeledValues: readonly string[], requireEveryLabel: boolean): Promise<BrowserRawBundle> {
    const target = identity.sourceRecordKey ?? `page/${identity.page}`;
    const actionId = await this.#beginAction("capture", target);
    let visualSafetyActionId: string | undefined;
    let visualSafetyTarget: string | undefined;
    let sanitizedDomUtf8: Uint8Array;
    let redactedScreenshotPng: Uint8Array;
    let redactionValues: readonly string[];
    try {
      const labeledValues = (await Promise.all(redactLabeledValues.map((label) => this.#exactLabeledValues(label)))).flat();
      const pageUrlValues = await collectPageSensitiveUrlValues(this.#page, this.#sensitiveQueryParameters);
      redactionValues = [...new Set([...this.#sensitiveValues, ...labeledValues, ...pageUrlValues])];
      const prepared = await preparePageCapture(this.#page, this.#sensitiveQueryParameters, redactLabeledValues, redactionValues);
      sanitizedDomUtf8 = prepared.sanitizedDomUtf8;
      if (requireEveryLabel && redactLabeledValues.some((label) => (prepared.overlayCounts[label] ?? 0) === 0)) {
        throw new Error("a sensitive contact label had no value to redact");
      }
      assertSanitizedPageDomSafe(sanitizedDomUtf8, this.#sensitiveQueryParameters, redactionValues);
      visualSafetyTarget = browserVisualSafetyTarget(sha256(sanitizedDomUtf8));
      visualSafetyActionId = await this.#actions.begin(BROWSER_VISUAL_SAFETY_ACTION_KIND, visualSafetyTarget);
      this.#renderRequests.clear();
      await this.#renderPage.setContent(new TextDecoder("utf-8", { fatal: true }).decode(sanitizedDomUtf8), { waitUntil: "load" });
      redactedScreenshotPng = await this.#renderPage.screenshot({ fullPage: true, type: "png" });
      if (this.#renderRequests.size > 0) throw new Error("sanitized screenshot renderer attempted network access");
      if (!this.#terminalAcknowledged) this.#assertNoTerminalRequests();
    } catch (error) {
      if (visualSafetyActionId !== undefined && visualSafetyTarget !== undefined) {
        await this.#actions.finish(visualSafetyActionId, BROWSER_VISUAL_SAFETY_ACTION_KIND, visualSafetyTarget, "contract-drift");
      }
      await this.#actions.finish(actionId, "capture", target, "contract-drift");
      if (error instanceof ExternalBrowserRequestError) throw error;
      throw new BrowserPolicyContractError(messageOf(error));
    }
    if (visualSafetyActionId === undefined || visualSafetyTarget === undefined) throw new Error("browser visual safety proof was not started");
    await this.#actions.finish(visualSafetyActionId, BROWSER_VISUAL_SAFETY_ACTION_KIND, visualSafetyTarget, "completed");
    await this.#actions.finish(actionId, "capture", target, "completed");
    const bundle: BrowserRawBundle = {
      sourceKind: this.#sourceKind,
      parserVersion,
      finalUrl: sanitizeBrowserUrl(this.#page.url(), this.#sensitiveQueryParameters),
      capturedAt: this.#now().toISOString(),
      navigationStatus: this.#navigationStatus,
      sanitizedDomUtf8,
      redactedScreenshotPng,
      pageFingerprintSha256: sha256(sanitizedDomUtf8),
      identity,
      candidateEvidence: null,
      actions: this.#actions.events.filter((action) => action.kind !== BROWSER_VISUAL_SAFETY_ACTION_KIND || action.id === visualSafetyActionId),
      sensitiveFormFieldNames: [...this.#sensitiveQueryParameters],
    };
    assertBrowserCaptureSafe(bundle, redactionValues);
    return bundle;
  }

  async #readLabeledValues(label: string, kind: string, exactlyOne: boolean): Promise<string[]> {
    const actionId = await this.#beginAction(kind, label);
    try {
      const values = await this.#exactLabeledValues(label);
      if (values.length === 0 || (exactlyOne && values.length !== 1)) throw new Error(`unexpected value count for label ${label}`);
      this.#assertNoTerminalRequests();
      await this.#actions.finish(actionId, kind, label, "completed");
      return values;
    } catch (error) {
      await this.#actions.finish(actionId, kind, label, "contract-drift");
      this.#assertNoTerminalRequests();
      throw new BrowserPolicyContractError(messageOf(error));
    }
  }

  async #contractAction<T>(kind: string, target: string, action: () => Promise<T>): Promise<T> {
    const actionId = await this.#beginAction(kind, target);
    try {
      const value = await action();
      this.#assertNoTerminalRequests();
      await this.#actions.finish(actionId, kind, target, "completed");
      return value;
    } catch (error) {
      await this.#actions.finish(actionId, kind, target, "contract-drift");
      this.#assertNoTerminalRequests();
      throw new BrowserPolicyContractError(messageOf(error));
    }
  }

  async #beginAction(kind: string, target: string): Promise<string> {
    for (const value of await collectPageSensitiveUrlValues(this.#page, this.#sensitiveQueryParameters)) this.#sensitiveValues.add(value);
    return this.#actions.begin(kind, target);
  }

  async #exactLabeledValues(label: string): Promise<string[]> {
    const values: string[] = [];
    for (const candidate of await this.#page.locator("dt").all()) {
      if ((await candidate.innerText()).trim() !== label) continue;
      const value = await candidate.evaluate((element) => element.nextElementSibling?.textContent ?? "");
      if (value.trim() === "") throw new Error(`labeled value ${label} is empty`);
      values.push(value.trim());
    }
    return values;
  }

  #rememberSensitiveValues(url: string): void {
    for (const value of sensitiveBrowserUrlValues(url, this.#sensitiveQueryParameters)) this.#sensitiveValues.add(value);
  }

  #recordTerminalRequest(resourceType: string, evidence: string): void {
    const violation = classifyRequest(resourceType, resourceType === "document", false, evidence);
    this.#recordViolation({ ...violation, disposition: "terminal" });
    this.#terminalOrigins.add(evidence);
  }

  #recordViolation(violation: BrowserPolicyViolation): void {
    if (!this.#violations.some((current) => current.disposition === violation.disposition
      && current.resourceType === violation.resourceType && current.origin === violation.origin)) {
      this.#violations.push(violation);
    }
  }

  #assertNoTerminalRequests(): void {
    if (this.#terminalOrigins.size > 0) throw new ExternalBrowserRequestError([...this.#terminalOrigins].sort());
  }
}

function normalizePolicy(policy: BrowserOriginPolicy): {
  policy: BrowserOriginPolicy;
  allowedOrigins: ReadonlySet<string>;
  allowedDownloadOrigins: ReadonlySet<string>;
} {
  const allowedOrigins = normalizeOrigins(policy.allowedOrigins, policy.allowInsecureHttpForTesting === true);
  const allowedDownloadOrigins = normalizeOrigins(
    policy.allowedDownloadOrigins ?? [],
    policy.allowInsecureHttpForTesting === true,
    true,
  );
  return {
    policy: {
      allowedOrigins: [...allowedOrigins],
      ...(allowedDownloadOrigins.size === 0 ? {} : { allowedDownloadOrigins: [...allowedDownloadOrigins] }),
      ...(policy.allowInsecureHttpForTesting === true ? { allowInsecureHttpForTesting: true } : {}),
    },
    allowedOrigins,
    allowedDownloadOrigins,
  };
}

function normalizeOrigins(
  values: readonly string[],
  allowInsecureHttpForTesting: boolean,
  allowEmpty = false,
): ReadonlySet<string> {
  if (values.length === 0 && !allowEmpty) throw new Error("browser origin policy requires at least one origin");
  const normalized = new Set<string>();
  for (const value of values) {
    const url = new URL(value);
    if (url.origin !== value || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      throw new Error("browser origin policy requires an exact origin");
    }
    if (url.protocol !== "https:") {
      if (url.protocol !== "http:" || !allowInsecureHttpForTesting || !isLocalHost(url.hostname)) {
        throw new Error("browser origin policy requires HTTPS outside explicit local tests");
      }
    }
    normalized.add(url.origin);
  }
  return normalized;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function browserRequestOrigin(value: string): { policy: string; evidence: string } {
  const url = new URL(value);
  const policyProtocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
  return { policy: `${policyProtocol}//${url.host}`, evidence: url.origin };
}

function classifyRequest(resourceType: string, isNavigation: boolean, isSubframe: boolean, origin: string): BrowserPolicyViolation {
  if (isSubframe) return { disposition: "passive", resourceType: "subframe", origin };
  if (resourceType === "image" || resourceType === "font" || resourceType === "stylesheet") {
    return { disposition: "passive", resourceType, origin };
  }
  if (resourceType === "script") return { disposition: "terminal", resourceType: "script", origin };
  if (resourceType === "xhr" || resourceType === "fetch") return { disposition: "terminal", resourceType: "xhr", origin };
  return { disposition: "terminal", resourceType: isNavigation ? "document" : "document", origin };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
