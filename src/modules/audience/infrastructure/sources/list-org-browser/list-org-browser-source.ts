import type {
  BrowserSession,
  BrowserSessionFactory,
} from "../../../application/ports/browser-session";
import { createCandidateEvidence } from "../../../domain/candidate-evidence";
import {
  ExternalBrowserRequestError,
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
import { checksumBrowserRawBundle } from "../../storage/raw-bundle";
import { sanitizeBrowserUrl as sanitizeUrl } from "./browser-raw-sanitizer";
import {
  BrowserPolicyContractError,
  PolicyBrowserSessionFactory,
  type PolicyBrowserSessionFactoryOptions,
} from "../browser/policy-browser";
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
      if (currentResultFingerprintSha256 !== ""
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
        currentOrderedSourceRecordKeys = [];
        currentResultFingerprintSha256 = "";
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
        const observedPageNumber = await session.readLabeledText("Страница");
        if (observedPageNumber !== String(pageNumber)) {
          throw new BrowserContractError("rendered result page identity does not match expected page");
        }
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
      if (error instanceof BrowserContractError || error instanceof BrowserPolicyContractError) {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export type PlaywrightBrowserSessionFactoryOptions = PolicyBrowserSessionFactoryOptions;

/** Compatibility fixture adapter. Live adapters use PolicyBrowserSessionFactory with HTTPS origins. */
export class PlaywrightBrowserSessionFactory extends PolicyBrowserSessionFactory {
  constructor(allowedOrigin: string, options: PlaywrightBrowserSessionFactoryOptions = {}) {
    super({ allowedOrigins: [new URL(allowedOrigin).origin], allowInsecureHttpForTesting: true }, options);
  }
}
