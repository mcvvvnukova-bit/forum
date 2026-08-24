import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { BrowserSession, BrowserSessionFactory } from "../../../application/ports/browser-session";
import type {
  BrowserRawBundle,
  DiscoveryOccurrence,
  DiscoveryPage,
  DiscoveryResult,
  DiscoveryScope,
  DiscoveredCompany,
  OrganizationSource,
} from "../../../domain/discovery";
import { parseLegalEntityInn } from "../../../domain/inn";
import { parseOkvedCode } from "../../../domain/okved";
import { checksumBrowserRawBundle, sha256 } from "../../storage/raw-bundle";

const RESULTS_LANDMARK = "Результаты поиска";
const CARD_LANDMARK = "Карточка организации";
const MANDATORY_SENSITIVE_QUERY_PARAMETERS = [
  "access_token",
  "auth",
  "authorization",
  "cookie",
  "session",
  "session_id",
  "token",
] as const;

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

  async collect(scope: DiscoveryScope): Promise<DiscoveryResult> {
    if (!isPositiveSafeInteger(scope.maxPages) || !isPositiveSafeInteger(scope.maxCompanies)) {
      throw new Error("discovery limits must be positive safe integers");
    }

    const session = await this.#sessions.open();
    const companies: DiscoveredCompany[] = [];
    const pages: DiscoveryPage[] = [];
    const rawBundles: ReturnType<typeof checksumBrowserRawBundle>[] = [];
    const firstSeen = new Set<string>();

    try {
      const status = await session.navigate(this.#searchUrl);
      if (status === 403) {
        return result("blocked", "http_403", companies, pages, rawBundles);
      }
      if (await session.hasLandmark("Подтверждение CAPTCHA")) {
        return result("blocked", "captcha", companies, pages, rawBundles);
      }
      if (await session.hasLandmark("Доступ временно ограничен")) {
        return result("blocked", "soft_block", companies, pages, rawBundles);
      }

      await session.fillField("ОКВЭД", scope.okved);
      await session.setCheckbox("Только действующие", scope.onlyActive);
      await session.clickButton("Найти организации");

      for (let pageNumber = 1; pageNumber <= scope.maxPages; pageNumber += 1) {
        if (await session.hasLandmark("Подтверждение CAPTCHA")) {
          return result("blocked", "captcha", companies, pages, rawBundles);
        }
        if (await session.hasLandmark("Доступ временно ограничен")) {
          return result("blocked", "soft_block", companies, pages, rawBundles);
        }
        await session.waitForLandmark(RESULTS_LANDMARK);
        await verifyRenderedFilters(session, scope);

        const linkNames = await session.linkNamesInLandmark(RESULTS_LANDMARK, "Открыть карточку ");
        const occurrences: DiscoveryOccurrence[] = [];

        for (const linkName of linkNames) {
          const before = await session.fingerprint();
          await session.clickLink(linkName);
          await session.waitForLandmark(CARD_LANDMARK);

          const company = await readCompany(session);
          const cardRaw = checksumBrowserRawBundle(await session.capture(
            { runId: this.#runId, page: pageNumber, sourceRecordKey: company.sourceRecordKey },
            this.#parserVersion,
            ["Телефон", "Email"],
          ));
          rawBundles.push(cardRaw);

          await session.clickLink("Вернуться к результатам");
          await session.waitForLandmark(RESULTS_LANDMARK);
          const after = await session.fingerprint();
          if (after !== before) {
            throw new BrowserContractError("result page changed after visiting a company card");
          }

          occurrences.push({
            sourceRecordKey: company.sourceRecordKey,
            resultFingerprintBefore: before,
            resultFingerprintAfter: after,
          });

          if (!firstSeen.has(company.sourceRecordKey)) {
            firstSeen.add(company.sourceRecordKey);
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
              pages.push({ page: pageNumber, raw: pageRaw, occurrences });
              return result("limited", "max_companies", companies, pages, rawBundles);
            }
          }
        }

        const pageRaw = checksumBrowserRawBundle(await session.capture({
          runId: this.#runId,
          page: pageNumber,
        }, this.#parserVersion));
        rawBundles.push(pageRaw);
        pages.push({ page: pageNumber, raw: pageRaw, occurrences });

        if (await session.hasVisibleText("Последняя страница")) {
          return result("succeeded", "terminal_marker", companies, pages, rawBundles);
        }
        if (pageNumber === scope.maxPages) {
          return result("limited", "max_pages", companies, pages, rawBundles);
        }

        await session.clickLink("Следующая страница");
      }

      return result("limited", "max_pages", companies, pages, rawBundles);
    } catch (error) {
      if (error instanceof BrowserContractError) {
        return result("blocked", "contract_drift", companies, pages, rawBundles);
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

function result(
  status: DiscoveryResult["status"],
  reason: string,
  companies: readonly DiscoveredCompany[],
  pages: readonly DiscoveryPage[],
  rawBundles: readonly ReturnType<typeof checksumBrowserRawBundle>[],
): DiscoveryResult {
  return { status, reason, companies, pages, rawBundles };
}

async function verifyRenderedFilters(session: BrowserSession, scope: DiscoveryScope): Promise<void> {
  const renderedOkved = parseOkvedCode(await session.readLabeledText("ОКВЭД"));
  const renderedStatus = await session.readLabeledText("Статус");
  if (renderedOkved !== scope.okved || renderedStatus !== (scope.onlyActive ? "Только действующие" : "Все")) {
    throw new BrowserContractError("rendered filters do not match the requested scope");
  }
}

async function readCompany(
  session: BrowserSession,
): Promise<Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion">> {
  const optional = (value: string) => value === "—" ? null : value.replace(/\s+/g, " ").trim();
  const sourceRecordKey = (await session.readLabeledText("Ключ записи")).trim();
  if (!/^[0-9]+$/.test(sourceRecordKey)) {
    throw new BrowserContractError("company source record key is invalid");
  }

  return {
    sourceRecordKey,
    inn: parseLegalEntityInn((await session.readLabeledText("ИНН")).trim()),
    name: (await session.readLabeledText("Наименование")).trim(),
    website: optional(await session.readLabeledText("Сайт")),
    phone: optional(await session.readLabeledText("Телефон")),
    email: optional(await session.readLabeledText("Email"))?.toLowerCase() ?? null,
    okvedCode: parseOkvedCode(await session.readLabeledText("ОКВЭД")),
    isPrimary: (await session.readLabeledText("Тип ОКВЭД")) === "Основной",
  };
}

export interface PlaywrightBrowserSessionFactoryOptions {
  now?: () => Date;
  sensitiveQueryParameters?: readonly string[];
}

export class PlaywrightBrowserSessionFactory implements BrowserSessionFactory {
  readonly #allowedOrigin: string;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];

  constructor(allowedOrigin: string, options: PlaywrightBrowserSessionFactoryOptions = {}) {
    this.#allowedOrigin = new URL(allowedOrigin).origin;
    this.#now = options.now ?? (() => new Date());
    this.#sensitiveQueryParameters = [...new Set([
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...(options.sensitiveQueryParameters ?? []),
    ])];
  }

  async open(): Promise<BrowserSession> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    return PlaywrightBrowserSession.create(
      browser,
      context,
      this.#allowedOrigin,
      this.#now,
      this.#sensitiveQueryParameters,
    );
  }
}

class BrowserContractError extends Error {}

export class ExternalBrowserRequestError extends Error {}

class PlaywrightBrowserSession implements BrowserSession {
  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #now: () => Date;
  readonly #sensitiveQueryParameters: readonly string[];
  readonly #actions: BrowserRawBundle["actions"][number][] = [];
  readonly #externalOrigins = new Set<string>();
  #navigationStatus: number | null = null;

  private constructor(
    browser: Browser,
    context: BrowserContext,
    page: Page,
    now: () => Date,
    sensitiveQueryParameters: readonly string[],
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#now = now;
    this.#sensitiveQueryParameters = sensitiveQueryParameters;
  }

  static async create(
    browser: Browser,
    context: BrowserContext,
    allowedOrigin: string,
    now: () => Date,
    sensitiveQueryParameters: readonly string[],
  ): Promise<PlaywrightBrowserSession> {
    const page = await context.newPage();
    page.setDefaultTimeout(2_000);
    const session = new PlaywrightBrowserSession(browser, context, page, now, sensitiveQueryParameters);

    page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        session.#navigationStatus = response.status();
      }
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith("data:")) {
        await route.continue();
        return;
      }
      let origin: string;
      try {
        origin = new URL(requestUrl).origin;
      } catch {
        origin = requestUrl;
      }
      if (origin === allowedOrigin) {
        await route.continue();
        return;
      }
      session.#externalOrigins.add(origin);
      await route.abort("blockedbyclient");
    });

    return session;
  }

  async navigate(url: string): Promise<number | null> {
    try {
      const response = await this.#page.goto(url, { waitUntil: "load" });
      this.#navigationStatus = response?.status() ?? null;
      this.#record("navigate", sanitizeUrl(url, this.#sensitiveQueryParameters), "completed");
      this.#assertNoExternalRequests();
      return this.#navigationStatus;
    } catch (error) {
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

  async clickButton(name: string): Promise<void> {
    await this.#contractAction("click-button", name, async () => {
      await this.#page.getByRole("button", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
    });
  }

  async clickLink(name: string): Promise<void> {
    await this.#contractAction("click-link", name, async () => {
      await this.#page.getByRole("link", { name, exact: true }).click();
      await this.#page.waitForLoadState("load");
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
    try {
      const candidates = await this.#page.locator("dt").all();
      const exactMatches = [];
      for (const candidate of candidates) {
        if ((await candidate.innerText()).trim() === label) exactMatches.push(candidate);
      }
      if (exactMatches.length === 0) {
        throw new Error(`expected at least one exact label ${label}`);
      }
      const value = await exactMatches[0].evaluate(
        (element) => element.nextElementSibling?.textContent ?? "",
      );
      if (value.trim() === "") {
        throw new Error(`labeled value ${label} is empty`);
      }
      this.#record("read-labeled-text", label, "completed");
      this.#assertNoExternalRequests();
      return value.trim();
    } catch (error) {
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]> {
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
      this.#record("read-links", `${name}:${accessibleNamePrefix}`, "completed");
      this.#assertNoExternalRequests();
      return result;
    } catch (error) {
      this.#assertNoExternalRequests();
      throw new BrowserContractError(messageOf(error));
    }
  }

  async fingerprint(): Promise<string> {
    const dom = await this.#sanitizedDom([]);
    this.#assertNoExternalRequests();
    return sha256(dom);
  }

  async capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues: readonly string[] = [],
  ): Promise<BrowserRawBundle> {
    const sanitizedDomUtf8 = await this.#sanitizedDom(redactLabeledValues);
    const overlays = await this.#addRedactionOverlays(redactLabeledValues);
    let redactedScreenshotPng: Uint8Array;
    try {
      redactedScreenshotPng = await this.#page.screenshot({ fullPage: true, type: "png" });
    } finally {
      await this.#page.locator("[data-browser-capture-redaction]").evaluateAll((elements) => {
        for (const element of elements) element.remove();
      });
    }
    if (redactLabeledValues.some((label) => (overlays[label] ?? 0) === 0)) {
      throw new BrowserContractError("a sensitive contact label had no value to redact");
    }
    this.#record("capture", identity.sourceRecordKey ?? `page:${identity.page}`, "completed");
    this.#assertNoExternalRequests();

    return {
      parserVersion,
      finalUrl: sanitizeUrl(this.#page.url(), this.#sensitiveQueryParameters),
      capturedAt: this.#now().toISOString(),
      navigationStatus: this.#navigationStatus,
      sanitizedDomUtf8,
      redactedScreenshotPng,
      pageFingerprintSha256: sha256(sanitizedDomUtf8),
      identity,
      actions: [...this.#actions],
    };
  }

  async close(): Promise<void> {
    try {
      await this.#context.close();
    } finally {
      await this.#browser.close();
    }
    this.#assertNoExternalRequests();
  }

  async #contractAction(kind: string, target: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.#record(kind, target, "completed");
      this.#assertNoExternalRequests();
    } catch (error) {
      this.#assertNoExternalRequests();
      this.#record(kind, target, "contract-drift");
      throw new BrowserContractError(messageOf(error));
    }
  }

  async #sanitizedDom(redactLabeledValues: readonly string[]): Promise<Uint8Array> {
    const html = await this.#page.evaluate(({ sensitiveNames, redactLabels }) => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, [hidden], [data-secret], input[type=hidden], meta[http-equiv='set-cookie' i]")
        .forEach((element) => element.remove());
      const redacted = new Set(redactLabels);
      for (const term of clone.querySelectorAll("dt")) {
        if (redacted.has(term.textContent?.trim() ?? "")) {
          const value = term.nextElementSibling;
          if (value !== null) {
            for (const attribute of [...value.attributes]) {
              value.removeAttribute(attribute.name);
            }
            value.replaceChildren(document.createTextNode("[REDACTED]"));
          }
        }
      }
      const sensitive = new Set(sensitiveNames.map((name) => name.toLowerCase()));
      for (const element of clone.querySelectorAll("*")) {
        for (const attribute of [...element.attributes]) {
          const attributeName = attribute.name.toLowerCase();
          if (attributeName.startsWith("on") || /cookie|secret|token|authorization/.test(attributeName)) {
            element.removeAttribute(attribute.name);
            continue;
          }
          if (attributeName === "href" || attributeName === "src" || attributeName === "action") {
            try {
              const url = new URL(attribute.value, document.baseURI);
              for (const name of [...url.searchParams.keys()]) {
                if (sensitive.has(name.toLowerCase())) url.searchParams.delete(name);
              }
              element.setAttribute(attribute.name, url.toString());
            } catch {
              // Non-URL attributes are retained verbatim.
            }
          }
        }
      }
      return `<!doctype html>\n${clone.outerHTML}`;
    }, {
      sensitiveNames: this.#sensitiveQueryParameters,
      redactLabels: redactLabeledValues,
    });
    return new TextEncoder().encode(html);
  }

  async #addRedactionOverlays(labels: readonly string[]): Promise<Record<string, number>> {
    return this.#page.evaluate((wantedLabels) => {
      const counts: Record<string, number> = {};
      const terms = [...document.querySelectorAll("dt")];
      for (const label of wantedLabels) {
        counts[label] = 0;
        for (const term of terms.filter((candidate) => candidate.textContent?.trim() === label)) {
          const value = term.nextElementSibling;
          if (!(value instanceof HTMLElement)) continue;
          const rect = value.getBoundingClientRect();
          const overlay = document.createElement("div");
          overlay.dataset.browserCaptureRedaction = "true";
          overlay.setAttribute("aria-hidden", "true");
          Object.assign(overlay.style, {
            position: "absolute",
            left: `${rect.left + window.scrollX}px`,
            top: `${rect.top + window.scrollY}px`,
            width: `${Math.max(rect.width, 1)}px`,
            height: `${Math.max(rect.height, 1)}px`,
            background: "#000",
            zIndex: "2147483647",
          });
          document.body.append(overlay);
          counts[label] += 1;
        }
      }
      return counts;
    }, labels);
  }

  #record(kind: string, target: string, outcome: string): void {
    this.#actions.push({ at: this.#now().toISOString(), kind, target, outcome });
  }

  #assertNoExternalRequests(): void {
    if (this.#externalOrigins.size > 0) {
      throw new ExternalBrowserRequestError(
        `browser request escaped fixture allowlist: ${[...this.#externalOrigins].sort().join(", ")}`,
      );
    }
  }
}

function sanitizeUrl(value: string, sensitiveQueryParameters: readonly string[]): string {
  const url = new URL(value);
  const sensitive = new Set(sensitiveQueryParameters.map((name) => name.toLowerCase()));
  for (const name of [...url.searchParams.keys()]) {
    if (sensitive.has(name.toLowerCase())) url.searchParams.delete(name);
  }
  return url.toString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
