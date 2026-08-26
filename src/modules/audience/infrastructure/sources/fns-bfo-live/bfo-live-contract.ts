import type {
  BrowserCaptureProjection,
  BrowserVisibleTableProjection,
} from "../../../application/ports/browser-session";
import type { LegalEntityInn } from "../../../domain/inn";
import { BrowserContractError } from "../list-org-browser/browser-record-policy";
import {
  parseBfoVisibleReport,
  type BfoVisibleParserContext,
  type BfoParseResult,
} from "../fns-bfo/bfo-parser";

export const BFO_SEARCH_FIELD = "Введите ИНН или название организации";
export const BFO_SEARCH_LANDMARK = "Поиск организации";
export const BFO_RESULTS_LANDMARK = "Результаты поиска";
export const BFO_ORGANIZATION_LANDMARK = "Организация";
export const BFO_REPORT_LANDMARK = "Отчетность за 2025 год";
export const BFO_CAPTCHA_LANDMARK = "Подтверждение CAPTCHA";
export const BFO_SOFT_BLOCK_LANDMARK = "Доступ временно ограничен";
export const BFO_RESTRICTED_TEXT = "Доступ к отчетности ограничен";
export const BFO_UNAVAILABLE_TEXT = "Отчетность за 2025 год отсутствует";

const REPORT_ROOT = `main[aria-label="${BFO_REPORT_LANDMARK}"]`;
const FORM_ROOT = 'section[aria-label="Форма по ОКУД 0710002"]';

export const BFO_REPORT_TABLE_PROJECTION: BrowserVisibleTableProjection = {
  scopeIdentity: "fns-bfo:0710002",
  selector: `${FORM_ROOT} > table`,
  expectedColumnCount: 3,
  matchColumnIndex: 1,
  matchText: "2110",
  retainedMatchColumnIndexes: [0, 1, 2],
  retainedOtherColumnIndexes: [1],
};

export const BFO_REPORT_IDENTITY_PROJECTION_SELECTORS = [
  `${REPORT_ROOT} > h1:text-is("${BFO_REPORT_LANDMARK}")`,
  `${REPORT_ROOT} dt:text-is("ИНН")`,
  `${REPORT_ROOT} dt:text-is("ИНН") + dd`,
] as const;

export const BFO_REPORT_FORM_PROJECTION_SELECTORS = [
  ...BFO_REPORT_IDENTITY_PROJECTION_SELECTORS,
  `${REPORT_ROOT} dt:text-is("Номер корректировки")`,
  `${REPORT_ROOT} dt:text-is("Номер корректировки") + dd`,
  `${REPORT_ROOT} dt:text-is("Дата представления отчетности")`,
  `${REPORT_ROOT} dt:text-is("Дата представления отчетности") + dd`,
  `${FORM_ROOT} > h2:text-is("Форма по ОКУД 0710002")`,
  `${FORM_ROOT} > p:text-is("Ед. измерения: тыс. ₽")`,
] as const;

export const BFO_REVENUE_PROJECTION_SELECTORS = [
  ...BFO_REPORT_FORM_PROJECTION_SELECTORS,
] as const;

export function bfoNoDataProjectionSelectors(
  reason: "report_restricted" | "report_unavailable" | "line_2110_absent",
): readonly string[] {
  if (reason === "report_restricted") {
    return [
      ...BFO_REPORT_IDENTITY_PROJECTION_SELECTORS,
      `${REPORT_ROOT} > p:text-is("${BFO_RESTRICTED_TEXT}")`,
    ];
  }
  if (reason === "report_unavailable") {
    return [
      ...BFO_REPORT_IDENTITY_PROJECTION_SELECTORS,
      `${REPORT_ROOT} > p:text-is("${BFO_UNAVAILABLE_TEXT}")`,
    ];
  }
  return BFO_REPORT_FORM_PROJECTION_SELECTORS;
}

export function selectBfoOrganizationHref(
  names: readonly string[],
  hrefs: readonly string[],
  inn: LegalEntityInn,
): string {
  if (names.length !== hrefs.length) {
    throw new BrowserContractError("BFO visible result names and links do not align");
  }
  const matches: string[] = [];
  for (const [index, name] of names.entries()) {
    const href = hrefs[index]!;
    const visibleInns = [...name.matchAll(/(?:^|[^0-9])([0-9]{10})(?![0-9])/gu)]
      .map((match) => match[1]!);
    if (!visibleInns.includes(inn)) continue;
    if (visibleInns.length !== 1) {
      throw new BrowserContractError("BFO organization result contains an ambiguous visible INN");
    }
    matches.push(href);
  }
  if (matches.length !== 1) {
    throw new BrowserContractError("BFO search must contain one unambiguous visible result for the requested INN");
  }
  return matches[0]!;
}

export function parseBfoReportProjection(
  projection: BrowserCaptureProjection,
  context: BfoVisibleParserContext,
): BfoParseResult {
  try {
    return parseBfoVisibleReport(projection.sanitizedDomUtf8, context);
  } catch (error) {
    throw new BrowserContractError(error instanceof Error ? error.message : String(error));
  }
}
