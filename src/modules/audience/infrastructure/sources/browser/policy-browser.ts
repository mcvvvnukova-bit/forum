import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Request,
  type Route,
} from "playwright";

import type {
  BrowserCaptureProjection,
  BrowserOriginPolicy,
  BrowserPolicyBlockState,
  BrowserPolicyViolation,
  BrowserSession,
  BrowserUrlContract,
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

export class BrowserTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTransportError";
  }
}

export interface PolicyBrowserSessionFactoryOptions {
  now?: () => Date;
  sensitiveQueryParameters?: readonly string[];
  launch?: () => Promise<Browser>;
  sourceKind?: string;
  transportRetryDelayMs?: number;
}

export class PolicyBrowserSessionFactory implements PolicyBrowserSessionFactoryPort {
  readonly policy: BrowserOriginPolicy;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #allowedNavigationUrls: readonly NormalizedUrlContract[];
  readonly #allowedDownloadUrls: readonly NormalizedUrlContract[];
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #launch: () => Promise<Browser>;
  readonly #sourceKind: string;
  readonly #transportRetryDelayMs: number;

  constructor(policy: BrowserOriginPolicy, options: PolicyBrowserSessionFactoryOptions = {}) {
    const normalized = normalizePolicy(policy);
    this.policy = normalized.policy;
    this.#allowedOrigins = normalized.allowedOrigins;
    this.#allowedNavigationUrls = normalized.allowedNavigationUrls;
    this.#allowedDownloadUrls = normalized.allowedDownloadUrls;
    this.#now = options.now ?? (() => new Date());
    this.#sensitiveQueryParameters = [...new Set([
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...(options.sensitiveQueryParameters ?? []),
    ])];
    this.#launch = options.launch ?? (() => chromium.launch({ headless: false }));
    this.#sourceKind = options.sourceKind ?? "list-org-browser";
    this.#transportRetryDelayMs = options.transportRetryDelayMs ?? 100;
    if (!Number.isSafeInteger(this.#transportRetryDelayMs) || this.#transportRetryDelayMs < 0) {
      throw new Error("browser transport retry delay must be a non-negative safe integer");
    }
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
        allowedNavigationUrls: this.#allowedNavigationUrls,
        allowedDownloadUrls: this.#allowedDownloadUrls,
        now: this.#now,
        sensitiveQueryParameters: this.#sensitiveQueryParameters,
        execution,
        sourceKind: this.#sourceKind,
        transportRetryDelayMs: this.#transportRetryDelayMs,
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
  readonly #allowedNavigationUrls: readonly NormalizedUrlContract[];
  readonly #allowedDownloadUrls: readonly NormalizedUrlContract[];
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #sourceKind: string;
  readonly #actions: BrowserActionRecorder;
  readonly #terminalOrigins: Set<string>;
  readonly #violations: BrowserPolicyViolation[] = [];
  readonly #sensitiveValues = new Set<string>();
  readonly #renderRequests = new Set<string>();
  readonly #cdpSession: CDPSession | undefined;
  #navigationStatus: number | null = null;
  #lastSafePageUrl: string | undefined;
  #terminalVersion = 0;
  #acknowledgedTerminalVersion = 0;
  #terminal = false;
  #freezePromise: Promise<void> | undefined;
  #pendingTransportFailure: BrowserTransportError | undefined;

  private constructor(options: {
    browser: Browser;
    context: BrowserContext;
    renderContext: BrowserContext;
    page: Page;
    renderPage: Page;
    allowedOrigins: ReadonlySet<string>;
    allowedNavigationUrls: readonly NormalizedUrlContract[];
    allowedDownloadUrls: readonly NormalizedUrlContract[];
    now: () => Date;
    sensitiveQueryParameters: readonly string[];
    execution: DiscoveryExecutionContext;
    sourceKind: string;
    renderRequests: Set<string>;
    terminalOrigins: Set<string>;
    cdpSession: CDPSession | undefined;
  }) {
    this.#browser = options.browser;
    this.#context = options.context;
    this.#renderContext = options.renderContext;
    this.#page = options.page;
    this.#renderPage = options.renderPage;
    this.#allowedOrigins = options.allowedOrigins;
    this.#allowedNavigationUrls = options.allowedNavigationUrls;
    this.#allowedDownloadUrls = options.allowedDownloadUrls;
    this.#now = options.now;
    this.#sensitiveQueryParameters = options.sensitiveQueryParameters;
    this.#sourceKind = options.sourceKind;
    this.#renderRequests = options.renderRequests;
    this.#terminalOrigins = options.terminalOrigins;
    this.#cdpSession = options.cdpSession;
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
    allowedNavigationUrls: readonly NormalizedUrlContract[];
    allowedDownloadUrls: readonly NormalizedUrlContract[];
    now: () => Date;
    sensitiveQueryParameters: readonly string[];
    execution: DiscoveryExecutionContext;
    sourceKind: string;
    transportRetryDelayMs: number;
  }): Promise<PolicyBrowserSession> {
    const renderRequests = new Set<string>();
    const terminalOrigins = new Set<string>();
    let session: PolicyBrowserSession | undefined;
    await options.context.routeWebSocket("**/*", async (webSocket) => {
      const requestUrl = webSocket.url();
      let origins: { policy: string; evidence: string };
      try {
        origins = browserRequestOrigin(requestUrl);
      } catch {
        if (session === undefined) terminalOrigins.add(requestUrl);
        else await session.#terminate({ disposition: "terminal", resourceType: "websocket", origin: requestUrl });
        await webSocket.close({ code: 1008, reason: "browser origin policy" });
        return;
      }
      if (session !== undefined && session.#terminal) {
        await webSocket.close({ code: 1008, reason: "browser session frozen" });
        return;
      }
      if (options.allowedOrigins.has(origins.policy)) {
        webSocket.connectToServer();
        return;
      }
      if (session === undefined) terminalOrigins.add(origins.evidence);
      else await session.#terminate({ disposition: "terminal", resourceType: "websocket", origin: origins.evidence });
      await webSocket.close({ code: 1008, reason: "browser origin policy" });
    });
    await options.context.exposeBinding("__okvedPolicyViolation", async (_source, evidence: unknown) => {
      const origin = evidence === "service-worker-registration"
        ? evidence
        : "browser-policy-violation";
      if (session === undefined) terminalOrigins.add(origin);
      else await session.#terminate({ disposition: "terminal", resourceType: "service-worker", origin });
    });
    await options.context.exposeBinding("__okvedRequestDownload", async (_source, evidence: unknown) => {
      const url = typeof evidence === "string" ? evidence : "download";
      if (session === undefined) {
        terminalOrigins.add(url);
        return false;
      }
      if (session.#terminal) return false;
      if (!matchesUrlContract(url, session.#allowedDownloadUrls)) {
        await session.#terminate({ disposition: "terminal", resourceType: "download", origin: url });
        return false;
      }
      const response = await options.context.request.get(url, { maxRedirects: 0 });
      await response.dispose();
      return true;
    });
    await options.context.exposeBinding("__okvedActiveUrlViolation", async (_source, evidence: unknown) => {
      const value = isActiveUrlEvidence(evidence)
        ? evidence
        : { resourceType: "document" as const, url: "active-url-policy-violation" };
      if (session === undefined) terminalOrigins.add(value.url);
      else await session.#terminate({
        disposition: "terminal",
        resourceType: value.resourceType,
        origin: value.url,
      });
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
    await options.context.addInitScript(() => {
      const bindings = window as unknown as Window & {
        __okvedRequestDownload: (evidence: string) => Promise<boolean>;
      };
      const requestDownload = bindings.__okvedRequestDownload;
      Reflect.deleteProperty(bindings, "__okvedRequestDownload");
      document.addEventListener("click", (event) => {
        const anchor = event.composedPath().find((candidate) => candidate instanceof HTMLAnchorElement);
        if (!(anchor instanceof HTMLAnchorElement) || !anchor.hasAttribute("download")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void requestDownload(anchor.href).catch(() => undefined);
      }, true);
    });
    await options.context.addInitScript(() => {
      const report = (resourceType: "document" | "script" | "xhr", url: string): void => {
        const binding = (window as unknown as Window & {
          __okvedActiveUrlViolation: (evidence: {
            resourceType: "document" | "script" | "xhr";
            url: string;
          }) => Promise<void>;
        }).__okvedActiveUrlViolation;
        void binding({ resourceType, url });
      };
      const scan = (root: ParentNode): void => {
        const candidates = root.querySelectorAll("script[src], iframe[src], object[data]");
        for (const candidate of candidates) {
          const isScript = candidate instanceof HTMLScriptElement;
          const raw = candidate.getAttribute(isScript ? "src" : candidate instanceof HTMLObjectElement ? "data" : "src");
          if (raw === null) continue;
          let url: URL;
          try { url = new URL(raw, location.href); } catch { continue; }
          if (url.protocol !== "data:") continue;
          report(isScript ? "script" : "document", url.href);
        }
      };
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              if (node.matches("script[src], iframe[src], object[data]")) scan(node.parentNode ?? document);
              else scan(node);
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
      document.addEventListener("click", (event) => {
        const anchor = event.composedPath().find((candidate) => candidate instanceof HTMLAnchorElement);
        if (!(anchor instanceof HTMLAnchorElement)) return;
        let url: URL;
        try { url = new URL(anchor.href, location.href); } catch { return; }
        if (url.protocol !== "data:") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        report("document", url.href);
      }, true);
      document.addEventListener("submit", (event) => {
        if (!(event.target instanceof HTMLFormElement)) return;
        let url: URL;
        try { url = new URL(event.target.action, location.href); } catch { return; }
        if (url.protocol !== "data:") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        report("document", url.href);
      }, true);
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = input instanceof Request ? input.url : String(input);
        const url = new URL(raw, location.href);
        if (url.protocol === "data:") {
          report("xhr", url.href);
          return Promise.reject(new TypeError("active data URL blocked by browser policy"));
        }
        return originalFetch(input, init);
      }) as typeof window.fetch;
    });
    await options.renderContext.route("**/*", async (route) => {
      renderRequests.add(route.request().url());
      await route.abort("blockedbyclient");
    });
    const page = await options.context.newPage();
    const renderPage = await options.renderContext.newPage();
    page.setDefaultTimeout(2_000);
    renderPage.setDefaultTimeout(2_000);
    const cdpSession = await maybeCreateCdpSession(options.context, page);
    session = new PolicyBrowserSession({
      ...options,
      page,
      renderPage,
      renderRequests,
      terminalOrigins,
      cdpSession,
    });

    if (terminalOrigins.size > 0) {
      await session.#terminate({
        disposition: "terminal",
        resourceType: "document",
        origin: [...terminalOrigins][0]!,
      });
    }

    options.context.on("page", (secondaryPage) => {
      if (secondaryPage === page) return;
      void session.#terminate({ disposition: "terminal", resourceType: "popup", origin: "secondary-page" });
      void secondaryPage.close().catch(() => undefined);
    });
    page.on("download", (download) => {
      const url = download.url();
      if (!matchesUrlContract(url, session.#allowedDownloadUrls)) {
        void session.#terminate({ disposition: "terminal", resourceType: "download", origin: url });
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
      if (session.#terminal) {
        await route.abort("blockedbyclient");
        return;
      }
      let origins: { policy: string; evidence: string };
      try {
        origins = browserRequestOrigin(requestUrl);
      } catch {
        const violation = classifyRequest(
          request.resourceType(),
          request.isNavigationRequest(),
          isSubframeRequest(request, page),
          requestUrl,
        );
        if (violation.disposition === "terminal") await session.#terminate(violation);
        else session.#recordViolation(violation);
        await route.abort("blockedbyclient");
        return;
      }
      const isNavigation = request.isNavigationRequest();
      const isSubframe = isSubframeRequest(request, page);
      const originAllowed = session.#allowedOrigins.has(origins.policy);
      const documentAllowed = !isNavigation
        || matchesUrlContract(requestUrl, session.#allowedNavigationUrls);
      if (originAllowed && documentAllowed) {
        if (!isNavigation) {
          await route.continue();
          return;
        }
        try {
          const response = await fetchDocumentWithBoundedRetry(
            route,
            options.transportRetryDelayMs,
            () => session.#assertNoTerminalRequests(),
          );
          const headers = response.headers();
          if (isRedirectStatus(response.status())) {
            const redirectUrl = resolveRedirectUrl(requestUrl, headers.location);
            let redirectOrigins: { policy: string; evidence: string } | undefined;
            try { redirectOrigins = browserRequestOrigin(redirectUrl); } catch { /* terminal below */ }
            const redirectAllowed = redirectOrigins !== undefined
              && session.#allowedOrigins.has(redirectOrigins.policy)
              && matchesUrlContract(redirectUrl, session.#allowedNavigationUrls);
            if (!redirectAllowed) {
              await session.#terminate({
                disposition: "terminal",
                resourceType: "document",
                origin: redirectOrigins === undefined || session.#allowedOrigins.has(redirectOrigins.policy)
                  ? redirectUrl
                  : redirectOrigins.evidence,
              });
              await route.abort("blockedbyclient").catch(() => undefined);
              return;
            }
          }
          if (isHtmlResponse(headers)) {
            const existing = headers["content-security-policy"];
            headers["content-security-policy"] = existing === undefined
              ? ACTIVE_URL_CONTENT_SECURITY_POLICY
              : `${existing}, ${ACTIVE_URL_CONTENT_SECURITY_POLICY}`;
          }
          await route.fulfill({ response, headers });
        } catch (error) {
          if (!(error instanceof ExternalBrowserRequestError)) {
            session.#pendingTransportFailure = new BrowserTransportError(messageOf(error));
          }
          await route.abort("failed").catch(() => undefined);
        }
        return;
      }
      const evidence = originAllowed ? requestUrl : origins.evidence;
      const violation = classifyRequest(request.resourceType(), isNavigation, isSubframe, evidence);
      if (violation.disposition === "terminal") await session.#terminate(violation);
      else session.#recordViolation(violation);
      await route.abort("blockedbyclient");
    });
    return session;
  }

  async navigate(url: string): Promise<number | null> {
    await this.#assertAllowedNavigation(url);
    this.#rememberSensitiveValues(url);
    const target = sanitizeBrowserUrl(url, this.#sensitiveQueryParameters);
    this.#prepareNavigation();
    const actionId = await this.#actions.begin("navigate", target);
    try {
      const response = await this.#page.goto(url, { waitUntil: "load" });
      this.#navigationStatus = response?.status() ?? null;
      await this.#page.waitForTimeout(50);
      this.#assertNoTerminalRequests();
      const transportFailure = this.#takeTransportFailure();
      if (transportFailure !== undefined) throw transportFailure;
      this.#rememberCurrentPageUrlIfSafe();
      await this.#actions.finish(actionId, "navigate", target, "completed");
      return this.#navigationStatus;
    } catch (error) {
      await this.#actions.finish(actionId, "navigate", target, "failed");
      this.#assertNoTerminalRequests();
      const transportFailure = error instanceof BrowserTransportError
        ? error
        : this.#takeTransportFailure();
      if (transportFailure !== undefined) throw transportFailure;
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
    this.#prepareNavigation();
    return this.#contractAction("click-button", name, async () => {
      await this.#page.getByRole("button", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
      this.#rememberCurrentPageUrlIfSafe();
      return this.#navigationStatus;
    });
  }

  async clickLink(name: string): Promise<number | null> {
    this.#prepareNavigation();
    return this.#contractAction("click-link", name, async () => {
      await this.#page.getByRole("link", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
      this.#rememberCurrentPageUrlIfSafe();
      return this.#navigationStatus;
    });
  }

  async clickLinkHref(href: string): Promise<number | null> {
    await this.#assertAllowedNavigation(href);
    this.#prepareNavigation();
    return this.#contractAction("click-link", href, async () => {
      const links = await this.#page.getByRole("link").all();
      const matches = [];
      for (const link of links) {
        const raw = await link.getAttribute("href");
        if (raw === null || !await link.isVisible()) continue;
        if (new URL(raw, this.#page.url()).href === href) matches.push(link);
      }
      if (matches.length !== 1) throw new Error("visible link href is missing or ambiguous");
      await matches[0]!.click();
      await this.#page.waitForLoadState("load");
      this.#rememberCurrentPageUrlIfSafe();
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

  async linkHrefsInLandmark(name: string): Promise<readonly string[]> {
    return this.#contractAction("read-link-hrefs", name, async () => {
      const links = await this.#page.getByRole("main", { name, exact: true }).getByRole("link").all();
      const values: string[] = [];
      for (const link of links) {
        const raw = await link.getAttribute("href");
        if (raw !== null && await link.isVisible()) values.push(new URL(raw, this.#page.url()).href);
      }
      if (values.length === 0) throw new Error("landmark contains no visible links");
      return values;
    });
  }

  async currentUrl(): Promise<string> {
    return this.#contractAction("read-current-url", "visible-page", async () => this.#page.url());
  }

  async currentNavigationStatus(): Promise<number | null> {
    this.#assertNoTerminalRequests();
    return this.#navigationStatus;
  }

  async recordCaptchaWaiting(target: string): Promise<void> {
    this.#assertNoTerminalRequests();
    await this.#actions.record("captcha_waiting", target);
    this.#assertNoTerminalRequests();
  }

  async fingerprint(): Promise<string> {
    this.#assertNoTerminalRequests();
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
        const candidates = await this.#page.locator(selector).all();
        const visible = [];
        for (const candidate of candidates) {
          if (await candidate.isVisible()) visible.push(candidate);
        }
        if (visible.length !== 1) {
          throw new Error(`capture projection selector must match exactly one visible element: ${selector}`);
        }
        fragments.push(await visible[0]!.evaluate((element) => element.outerHTML));
      }
      const currentPageUrl = this.#page.url();
      if (this.#safeEvidenceUrl() !== currentPageUrl) {
        throw new Error("projection base URL is not the current policy-valid page");
      }
      const projectionBaseUrl = sanitizeBrowserUrl(
        currentPageUrl,
        this.#sensitiveQueryParameters,
      );
      this.#renderRequests.clear();
      await this.#renderPage.setContent(
        `<!doctype html><html><head><base href="${escapeHtmlAttribute(projectionBaseUrl)}"></head><body><main>${fragments.join("\n")}</main></body></html>`,
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

  async captureBlocker(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    acknowledgePolicyViolationOrigins: readonly string[] = [],
  ): Promise<BrowserRawBundle> {
    const expectedTerminalOrigins = new Set(acknowledgePolicyViolationOrigins);
    const expectedTerminalVersion = this.#terminalVersion;
    this.#assertTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    const bundle = await this.#capture(
      identity,
      parserVersion,
      ["Телефон", "Email"],
      false,
      expectedTerminalOrigins,
      expectedTerminalVersion,
    );
    this.#assertTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    this.#acknowledgedTerminalVersion = expectedTerminalVersion;
    return bundle;
  }

  async acknowledgePolicyBlock(
    acknowledgePolicyViolationOrigins: readonly string[],
  ): Promise<BrowserPolicyBlockState> {
    const expectedTerminalOrigins = new Set(acknowledgePolicyViolationOrigins);
    const expectedTerminalVersion = this.#terminalVersion;
    this.#assertTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    if (this.#freezePromise !== undefined) await this.#freezePromise;
    this.#assertTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    const state = {
      finalUrl: sanitizeBrowserUrl(this.#safeEvidenceUrl(), this.#sensitiveQueryParameters),
      navigationStatus: this.#navigationStatus,
    };
    this.#acknowledgedTerminalVersion = expectedTerminalVersion;
    return state;
  }

  async close(): Promise<void> {
    try {
      await Promise.all([this.#context.close(), this.#renderContext.close()]);
    } finally {
      await this.#browser.close();
    }
    this.#assertNoUnacknowledgedTerminalRequests();
  }

  async #capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues: readonly string[],
    requireEveryLabel: boolean,
    expectedTerminalOrigins?: ReadonlySet<string>,
    expectedTerminalVersion = this.#terminalVersion,
  ): Promise<BrowserRawBundle> {
    const target = identity.sourceRecordKey ?? `page/${identity.page}`;
    const actionId = await this.#beginAction(
      "capture",
      target,
      expectedTerminalOrigins,
      expectedTerminalVersion,
    );
    let visualSafetyActionId: string | undefined;
    let visualSafetyTarget: string | undefined;
    let sanitizedDomUtf8: Uint8Array;
    let redactedScreenshotPng: Uint8Array;
    let redactionValues: readonly string[];
    try {
      const isTerminalCapture = expectedTerminalOrigins !== undefined
        && expectedTerminalOrigins.size > 0;
      if (isTerminalCapture && this.#freezePromise !== undefined) await this.#freezePromise;
      const capturePage = isTerminalCapture && this.#terminal
        ? await this.#prepareInertBlockerPage()
        : this.#page;
      const labeledValues = (await Promise.all(redactLabeledValues.map((label) => this.#exactLabeledValues(label, capturePage)))).flat();
      const pageUrlValues = this.#terminal
        ? sensitiveBrowserUrlValues(this.#page.url(), this.#sensitiveQueryParameters)
        : await collectPageSensitiveUrlValues(capturePage, this.#sensitiveQueryParameters);
      redactionValues = [...new Set([...this.#sensitiveValues, ...labeledValues, ...pageUrlValues])];
      const prepared = await preparePageCapture(capturePage, this.#sensitiveQueryParameters, redactLabeledValues, redactionValues);
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
      this.#assertCaptureTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    } catch (error) {
      if (visualSafetyActionId !== undefined && visualSafetyTarget !== undefined) {
        await this.#actions.finish(visualSafetyActionId, BROWSER_VISUAL_SAFETY_ACTION_KIND, visualSafetyTarget, "contract-drift");
      }
      await this.#actions.finish(actionId, "capture", target, "contract-drift");
      this.#assertCaptureTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
      if (error instanceof ExternalBrowserRequestError) throw error;
      throw new BrowserPolicyContractError(messageOf(error));
    }
    if (visualSafetyActionId === undefined || visualSafetyTarget === undefined) throw new Error("browser visual safety proof was not started");
    await this.#actions.finish(visualSafetyActionId, BROWSER_VISUAL_SAFETY_ACTION_KIND, visualSafetyTarget, "completed");
    await this.#actions.finish(actionId, "capture", target, "completed");
    this.#assertCaptureTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    const bundle: BrowserRawBundle = {
      sourceKind: this.#sourceKind,
      parserVersion,
      finalUrl: sanitizeBrowserUrl(this.#safeEvidenceUrl(), this.#sensitiveQueryParameters),
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
      const transportFailure = this.#takeTransportFailure();
      if (transportFailure !== undefined) throw transportFailure;
      await this.#actions.finish(actionId, kind, target, "completed");
      return value;
    } catch (error) {
      const transportFailure = error instanceof BrowserTransportError
        ? error
        : this.#takeTransportFailure();
      await this.#actions.finish(
        actionId,
        kind,
        target,
        transportFailure === undefined ? "contract-drift" : "failed",
      );
      this.#assertNoTerminalRequests();
      if (transportFailure !== undefined) throw transportFailure;
      throw new BrowserPolicyContractError(messageOf(error));
    }
  }

  #prepareNavigation(): void {
    this.#pendingTransportFailure = undefined;
    this.#navigationStatus = null;
  }

  #takeTransportFailure(): BrowserTransportError | undefined {
    const failure = this.#pendingTransportFailure;
    this.#pendingTransportFailure = undefined;
    return failure;
  }

  async #beginAction(
    kind: string,
    target: string,
    expectedTerminalOrigins?: ReadonlySet<string>,
    expectedTerminalVersion = this.#terminalVersion,
  ): Promise<string> {
    this.#assertCaptureTerminalState(expectedTerminalOrigins, expectedTerminalVersion);
    if (!this.#terminal) {
      for (const value of await collectPageSensitiveUrlValues(this.#page, this.#sensitiveQueryParameters)) this.#sensitiveValues.add(value);
    }
    return this.#actions.begin(kind, target);
  }

  async #exactLabeledValues(label: string, page: Page = this.#page): Promise<string[]> {
    const values: string[] = [];
    for (const candidate of await page.locator("dt").all()) {
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

  #rememberCurrentPageUrlIfSafe(): void {
    if (this.#terminal) return;
    const value = this.#page.url();
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:")
        && this.#allowedOrigins.has(url.origin)
        && matchesUrlContract(value, this.#allowedNavigationUrls)) {
        this.#lastSafePageUrl = value;
      }
    } catch { /* current browser URL remains unusable as durable evidence */ }
  }

  #safeEvidenceUrl(): string {
    const value = this.#page.url();
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:")
        && this.#allowedOrigins.has(url.origin)
        && matchesUrlContract(value, this.#allowedNavigationUrls)) return value;
    } catch { /* fall back to the last allowed visible page */ }
    if (this.#lastSafePageUrl !== undefined) return this.#lastSafePageUrl;
    throw new BrowserPolicyContractError("terminal blocker has no safe browser URL evidence");
  }

  async #prepareInertBlockerPage(): Promise<Page> {
    const html = await this.#page.content().catch(() => "<!doctype html><html><body></body></html>");
    this.#renderRequests.clear();
    await this.#renderPage.setContent(html, { waitUntil: "load" });
    return this.#renderPage;
  }

  async #terminate(violation: BrowserPolicyViolation): Promise<void> {
    this.#recordViolation(violation);
    this.#terminalOrigins.add(violation.origin);
    this.#terminalVersion += 1;
    if (!this.#terminal) {
      this.#terminal = true;
      this.#freezePromise = this.#cdpSession === undefined
        ? Promise.resolve()
        : this.#cdpSession.send("Emulation.setScriptExecutionDisabled", { value: true })
            .then(() => undefined)
            .catch(() => undefined);
    }
    await this.#freezePromise;
  }

  #recordViolation(violation: BrowserPolicyViolation): void {
    if (!this.#violations.some((current) => current.disposition === violation.disposition
      && current.resourceType === violation.resourceType && current.origin === violation.origin)) {
      this.#violations.push(violation);
    }
  }

  #assertNoTerminalRequests(): void {
    if (this.#terminalOrigins.size > 0) {
      throw new ExternalBrowserRequestError([...this.#terminalOrigins].sort());
    }
  }

  #assertNoUnacknowledgedTerminalRequests(): void {
    if (this.#terminalVersion > this.#acknowledgedTerminalVersion) {
      throw new ExternalBrowserRequestError([...this.#terminalOrigins].sort());
    }
  }

  #assertCaptureTerminalState(
    expectedOrigins: ReadonlySet<string> | undefined,
    expectedVersion: number,
  ): void {
    if (expectedOrigins === undefined) {
      this.#assertNoTerminalRequests();
      return;
    }
    this.#assertTerminalState(expectedOrigins, expectedVersion);
  }

  #assertTerminalState(expectedOrigins: ReadonlySet<string>, expectedVersion: number): void {
    const currentOrigins = [...this.#terminalOrigins].sort();
    const expected = [...expectedOrigins].sort();
    const sameOrigins = currentOrigins.length === expected.length
      && currentOrigins.every((origin, index) => origin === expected[index]);
    if (this.#terminalVersion !== expectedVersion || !sameOrigins) {
      throw new ExternalBrowserRequestError(currentOrigins.length > 0 ? currentOrigins : expected);
    }
  }

  async #assertAllowedNavigation(value: string): Promise<void> {
    this.#assertNoTerminalRequests();
    let origins: { policy: string; evidence: string };
    try { origins = browserRequestOrigin(value); } catch {
      await this.#terminate({ disposition: "terminal", resourceType: "document", origin: value });
      this.#assertNoTerminalRequests();
      return;
    }
    if (!this.#allowedOrigins.has(origins.policy)) {
      await this.#terminate({ disposition: "terminal", resourceType: "document", origin: origins.evidence });
      this.#assertNoTerminalRequests();
      return;
    }
    if (!matchesUrlContract(value, this.#allowedNavigationUrls)) {
      await this.#terminate({ disposition: "terminal", resourceType: "document", origin: value });
      this.#assertNoTerminalRequests();
    }
  }
}

const MAX_TRANSPORT_RETRIES = 2;
const ACTIVE_URL_CONTENT_SECURITY_POLICY = [
  "script-src 'unsafe-inline' http: https:",
  "frame-src http: https:",
  "worker-src http: https:",
  "connect-src http: https: ws: wss:",
  "object-src 'none'",
].join("; ");

type NormalizedUrlContract = {
  kind: "exact";
  url: string;
  origin: string;
} | {
  kind: "pattern";
  origin: string;
  pathname: string;
};

function normalizePolicy(policy: BrowserOriginPolicy): {
  policy: BrowserOriginPolicy;
  allowedOrigins: ReadonlySet<string>;
  allowedNavigationUrls: readonly NormalizedUrlContract[];
  allowedDownloadUrls: readonly NormalizedUrlContract[];
} {
  const allowInsecureHttpForTesting = policy.allowInsecureHttpForTesting === true;
  const allowedOrigins = normalizeOrigins(policy.allowedOrigins, allowInsecureHttpForTesting);
  const allowedDownloadOrigins = normalizeOrigins(
    policy.allowedDownloadOrigins ?? [],
    allowInsecureHttpForTesting,
    true,
  );
  const allowedNavigationUrls = normalizeUrlContracts(
    policy.allowedNavigationUrls ?? [],
    "navigation",
    allowedOrigins,
    allowInsecureHttpForTesting,
    false,
  );
  const allowedDownloadUrls = normalizeUrlContracts(
    policy.allowedDownloadUrls ?? [],
    "download",
    allowedOrigins,
    allowInsecureHttpForTesting,
    true,
  );
  return {
    policy: {
      allowedOrigins: [...allowedOrigins],
      allowedNavigationUrls: allowedNavigationUrls.map(publicUrlContract),
      ...(allowedDownloadUrls.length === 0 ? {} : {
        allowedDownloadUrls: allowedDownloadUrls.map(publicUrlContract),
      }),
      ...(allowedDownloadOrigins.size === 0 ? {} : { allowedDownloadOrigins: [...allowedDownloadOrigins] }),
      ...(allowInsecureHttpForTesting ? { allowInsecureHttpForTesting: true } : {}),
    },
    allowedOrigins,
    allowedNavigationUrls,
    allowedDownloadUrls,
  };
}

function normalizeUrlContracts(
  values: readonly BrowserUrlContract[],
  label: "navigation" | "download",
  allowedOrigins: ReadonlySet<string>,
  allowInsecureHttpForTesting: boolean,
  allowEmpty: boolean,
): readonly NormalizedUrlContract[] {
  if (values.length === 0 && !allowEmpty) {
    throw new Error("browser origin policy requires at least one navigation URL contract");
  }
  const normalized: NormalizedUrlContract[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const url = new URL(value);
      assertCanonicalContractUrl(url, value, label);
      assertContractOriginAllowed(url.origin, label, allowedOrigins);
      normalized.push({ kind: "exact", url: url.href, origin: url.origin });
      continue;
    }
    const origin = [...normalizeOrigins([value.origin], allowInsecureHttpForTesting)][0]!;
    assertContractOriginAllowed(origin, label, allowedOrigins);
    if (!isCanonicalPathnamePattern(value.pathname)) {
      throw new Error(`browser origin policy requires a canonical ${label} pathname pattern`);
    }
    normalized.push({ kind: "pattern", origin, pathname: value.pathname });
  }
  return normalized;
}

function assertCanonicalContractUrl(url: URL, value: string, label: "navigation" | "download"): void {
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== "" || url.password !== "" || url.hash !== "" || url.href !== value) {
    throw new Error(`browser origin policy requires a canonical ${label} URL`);
  }
}

function assertContractOriginAllowed(
  origin: string,
  label: "navigation" | "download",
  allowedOrigins: ReadonlySet<string>,
): void {
  if (!allowedOrigins.has(origin)) {
    throw new Error(`browser ${label} URL origin must be in allowedOrigins`);
  }
}

function isCanonicalPathnamePattern(value: string): boolean {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) return false;
  const firstWildcard = value.indexOf("*");
  if (firstWildcard >= 0 && (firstWildcard !== value.length - 1 || value.lastIndexOf("*") !== firstWildcard)) {
    return false;
  }
  const literal = firstWildcard < 0 ? value : value.slice(0, -1);
  try {
    return new URL(literal, "https://contract.invalid").pathname === literal;
  } catch {
    return false;
  }
}

function publicUrlContract(contract: NormalizedUrlContract): BrowserUrlContract {
  return contract.kind === "exact"
    ? contract.url
    : { origin: contract.origin, pathname: contract.pathname };
}

function matchesUrlContract(value: string, contracts: readonly NormalizedUrlContract[]): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== "" || url.password !== "") return false;
  return contracts.some((contract) => contract.kind === "exact"
    ? url.href === contract.url
    : url.origin === contract.origin && (contract.pathname.endsWith("*")
        ? url.pathname.startsWith(contract.pathname.slice(0, -1))
        : url.pathname === contract.pathname));
}

function isActiveUrlEvidence(value: unknown): value is {
  resourceType: "document" | "script" | "xhr";
  url: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { resourceType?: unknown; url?: unknown };
  return (candidate.resourceType === "document"
      || candidate.resourceType === "script"
      || candidate.resourceType === "xhr")
    && typeof candidate.url === "string";
}

function isHtmlResponse(headers: Record<string, string>): boolean {
  return /^text\/html(?:;|$)/iu.test(headers["content-type"] ?? "");
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirectUrl(requestUrl: string, location: string | undefined): string {
  if (location === undefined) return "invalid-redirect-location";
  try { return new URL(location, requestUrl).href; } catch { return "invalid-redirect-location"; }
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
  if (url.protocol !== "http:" && url.protocol !== "https:"
    && url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("browser request URL must use HTTP(S) or WebSocket transport");
  }
  const policyProtocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
  return { policy: `${policyProtocol}//${url.host}`, evidence: url.origin };
}

function isSubframeRequest(request: Request, page: Page): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    // Requests issued before a popup frame exists are terminal documents.
    return false;
  }
}

async function maybeCreateCdpSession(context: BrowserContext, page: Page): Promise<CDPSession | undefined> {
  const candidate = context as BrowserContext & {
    newCDPSession?: (target: Page) => Promise<CDPSession>;
  };
  if (typeof candidate.newCDPSession !== "function") return undefined;
  return candidate.newCDPSession(page).catch(() => undefined);
}

async function fetchDocumentWithBoundedRetry(
  route: Route,
  retryDelayMs: number,
  assertSessionActive: () => void,
): Promise<Awaited<ReturnType<Route["fetch"]>>> {
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt += 1) {
    try {
      assertSessionActive();
      const response = await route.fetch({ maxRedirects: 0 });
      if (!isTransientServerStatus(response.status()) || attempt === MAX_TRANSPORT_RETRIES) {
        return response;
      }
      await response.dispose();
    } catch (error) {
      if (attempt === MAX_TRANSPORT_RETRIES || !isTransientTransportError(error)) throw error;
    }
    if (retryDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error("browser transport retry loop exhausted unexpectedly");
}

function isTransientServerStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function isTransientTransportError(error: unknown): boolean {
  const message = messageOf(error);
  return /net::(?:ERR_(?:CONNECTION_(?:ABORTED|CLOSED|RESET|REFUSED|TIMED_OUT)|EMPTY_RESPONSE|FAILED|NETWORK_CHANGED|TIMED_OUT)|NAME_NOT_RESOLVED)|NS_ERROR_NET_|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/iu
    .test(message);
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

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
