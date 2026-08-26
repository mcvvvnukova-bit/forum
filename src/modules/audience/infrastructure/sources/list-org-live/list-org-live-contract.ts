import type { BrowserCaptureProjection } from "../../../application/ports/browser-session";
import type { DiscoveryScope, DiscoveredCompany } from "../../../domain/discovery";
import { parseLegalEntityInn } from "../../../domain/inn";
import { parseOkvedCode } from "../../../domain/okved";
import { BrowserContractError } from "../list-org-browser/browser-record-policy";

const LEGAL_NAME_LABEL = "Полное юридическое наименование:";
const INN_KPP_LABEL = "ИНН / КПП:";
const PRIMARY_OKVED_LABEL = "Основной (по коду ОКВЭД ред.2):";
const ADDITIONAL_OKVED_CAPTION = "Дополнительные виды деятельности";

export const LIST_ORG_LIVE_CARD_PROJECTION_SELECTORS = [
  `main[aria-label="Карточка организации"] dt:text-is("${LEGAL_NAME_LABEL}")`,
  `main[aria-label="Карточка организации"] dt:text-is("${LEGAL_NAME_LABEL}") + dd`,
  `main[aria-label="Карточка организации"] dt:text-is("${INN_KPP_LABEL}")`,
  `main[aria-label="Карточка организации"] dt:text-is("${INN_KPP_LABEL}") + dd`,
  `main[aria-label="Карточка организации"] dt:text-is("${PRIMARY_OKVED_LABEL}")`,
  `main[aria-label="Карточка организации"] dt:text-is("${PRIMARY_OKVED_LABEL}") + dd`,
  `main[aria-label="Карточка организации"] table:has(caption:text-is("${ADDITIONAL_OKVED_CAPTION}"))`,
] as const;

export function listOrgLiveResultsProjectionSelectors(
  sourceRecordKeys: readonly string[],
): readonly string[] {
  return [
    'main[aria-label="Результаты поиска"] > h1',
    'main[aria-label="Результаты поиска"] dt:text-is("ОКВЭД")',
    'main[aria-label="Результаты поиска"] dt:text-is("ОКВЭД") + dd',
    'main[aria-label="Результаты поиска"] dt:text-is("Страница")',
    'main[aria-label="Результаты поиска"] dt:text-is("Страница") + dd',
    ...sourceRecordKeys.map((sourceRecordKey) => {
      if (!/^[1-9][0-9]*$/u.test(sourceRecordKey)) {
        throw new BrowserContractError("result source record key is malformed");
      }
      return `main[aria-label="Результаты поиска"] a[href="/company/${sourceRecordKey}"]`;
    }),
  ];
}

export type ListOrgLiveCard =
  | { kind: "legal-entity"; company: Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion"> }
  | { kind: "ip"; sourceRecordKey: string };

export function parseListOrgLiveCard(
  projection: BrowserCaptureProjection,
  sourceRecordKey: string,
  scope: DiscoveryScope,
): ListOrgLiveCard {
  if (!/^[1-9][0-9]*$/u.test(sourceRecordKey)) {
    throw new BrowserContractError("company source record key is malformed");
  }
  const dom = new TextDecoder("utf-8", { fatal: true }).decode(projection.sanitizedDomUtf8);
  const name = labeledValue(dom, LEGAL_NAME_LABEL);
  const innKpp = labeledValue(dom, INN_KPP_LABEL);
  const innMatch = /^(\d{10}|\d{12})(?:\s*\/\s*\d{9})?$/u.exec(innKpp);
  if (innMatch?.[1] === undefined) throw new BrowserContractError("INN / KPP is malformed");
  if (innMatch[1].length === 12) return { kind: "ip", sourceRecordKey };

  let inn: ReturnType<typeof parseLegalEntityInn>;
  try { inn = parseLegalEntityInn(innMatch[1]); } catch {
    throw new BrowserContractError("legal-entity INN is malformed");
  }
  const primaryOkved = leadingOkved(labeledValue(dom, PRIMARY_OKVED_LABEL));
  const additionalOkveds = additionalCodes(dom);
  const isPrimary = primaryOkved === scope.okved;
  if (!isPrimary && !additionalOkveds.includes(scope.okved)) {
    throw new BrowserContractError("company card does not contain the requested OKVED");
  }

  return {
    kind: "legal-entity",
    company: {
      sourceRecordKey,
      inn,
      name,
      website: null,
      phone: null,
      email: null,
      okvedCode: scope.okved,
      isPrimary,
    },
  };
}

function labeledValue(dom: string, label: string): string {
  const pattern = new RegExp(
    `<dt[^>]*>\\s*${escapeRegExp(label)}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`,
    "u",
  );
  const value = pattern.exec(dom)?.[1];
  if (value === undefined) throw new BrowserContractError(`required card label is missing: ${label}`);
  const text = plainText(value);
  if (text === "") throw new BrowserContractError(`required card value is empty: ${label}`);
  return text;
}

function leadingOkved(value: string): ReturnType<typeof parseOkvedCode> {
  const candidate = /^([0-9]{2}(?:\.[0-9]{1,2}){0,2})(?:\s|$)/u.exec(value)?.[1];
  if (candidate === undefined) throw new BrowserContractError("primary OKVED is malformed");
  try { return parseOkvedCode(candidate); } catch {
    throw new BrowserContractError("primary OKVED is malformed");
  }
}

function additionalCodes(dom: string): ReturnType<typeof parseOkvedCode>[] {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/u.exec(dom)?.[1];
  if (table === undefined) throw new BrowserContractError("additional OKVED table is missing");
  const codes: ReturnType<typeof parseOkvedCode>[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)) {
    const firstCell = /<td[^>]*>([\s\S]*?)<\/td>/u.exec(row[1] ?? "")?.[1];
    if (firstCell === undefined) continue;
    try { codes.push(parseOkvedCode(plainText(firstCell))); } catch {
      throw new BrowserContractError("additional OKVED is malformed");
    }
  }
  return codes;
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#[xX][0-9a-fA-F]+);/gu, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&nbsp;") return " ";
    const hexadecimal = entity.startsWith("&#x") || entity.startsWith("&#X");
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
