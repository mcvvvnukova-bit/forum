import {
  parseMoneyText,
  type FinancialMetricEvidence,
  type MoneyText,
} from "../../../domain/financial";
import { parseLegalEntityInn, type LegalEntityInn } from "../../../domain/inn";

const expectedForm = "0710002";
const compatibleRubleUnits = new Set(["RUB", "RUBLES"]);

export interface BfoParserContext {
  inn: LegalEntityInn;
  reportYear: number;
  rawFetchKey: string;
  parserVersion: string;
}

export interface BfoParseResult {
  inn: LegalEntityInn;
  reportYear: number;
  revenue: MoneyText | null;
  evidence: FinancialMetricEvidence[];
}

export interface BfoVisibleParserContext extends BfoParserContext {
  sourceRecordKey: string;
  observedAt: string;
}

interface BfoFixtureReport {
  inn: string;
  form: string;
  reportYear: number;
  unit: string;
  correctedAt: string;
  sourceRecordKey: string;
  lines: Record<string, string>;
}

export function parseBfo(input: Uint8Array, context: BfoParserContext): BfoParseResult {
  const reports = parseFixture(input);
  const companyReports = reports.filter((report) => report.inn === context.inn);

  if (companyReports.length === 0) {
    throw new Error("BFO fixture does not contain the requested legal-entity INN");
  }
  const requestedYearReports = companyReports.filter((report) => report.reportYear === context.reportYear);
  if (requestedYearReports.length === 0) {
    throw new Error("BFO fixture report year does not match the requested year");
  }
  for (const report of requestedYearReports) validateReport(report);

  const selected = requestedYearReports.toSorted(compareCorrections).at(-1)!;
  const revenueText = selected.lines["2110"];

  if (revenueText === undefined) {
    return { inn: context.inn, reportYear: context.reportYear, revenue: null, evidence: [] };
  }

  const revenue = parseMoneyText(revenueText, "dot");
  return {
    inn: context.inn,
    reportYear: context.reportYear,
    revenue,
    evidence: [{
      inn: context.inn,
      reportYear: context.reportYear,
      metric: "revenue",
      value: revenue,
      sourceKind: "fns_bfo",
      sourceRecordKey: selected.sourceRecordKey,
      observedAt: new Date(Date.parse(selected.correctedAt)).toISOString(),
      rawFetchKey: context.rawFetchKey,
      parserVersion: context.parserVersion,
    }],
  };
}

export function parseBfoVisibleReport(
  input: Uint8Array,
  context: BfoVisibleParserContext,
): BfoParseResult {
  parseLegalEntityInn(context.inn);
  if (context.reportYear !== 2025) {
    throw new Error("BFO visible report year must be exactly 2025");
  }
  let dom: string;
  try {
    dom = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (error) {
    throw new Error(`BFO visible report UTF-8 is malformed: ${errorMessage(error)}`);
  }
  if (!Number.isSafeInteger(Date.parse(context.observedAt))) {
    throw new Error("BFO visible report observation timestamp is invalid");
  }
  if (context.sourceRecordKey.trim() === "") {
    throw new Error("BFO visible report source record key is required");
  }

  const expectedHeading = `Отчетность за ${context.reportYear} год`;
  if (!hasExactTagText(dom, "h1", expectedHeading)) {
    throw new Error("BFO visible report year does not match the requested year");
  }
  const inns = labeledValues(dom, "ИНН");
  if (inns.length !== 1 || inns[0] !== context.inn) {
    throw new Error("BFO visible report INN does not match the requested legal entity INN");
  }

  const restricted = hasExactTagText(dom, "p", "Доступ к отчетности ограничен");
  const unavailable = hasExactTagText(dom, "p", `${expectedHeading} отсутствует`);
  if (restricted && unavailable) {
    throw new Error("BFO visible report contains conflicting availability markers");
  }
  if (restricted || unavailable) {
    return { inn: context.inn, reportYear: context.reportYear, revenue: null, evidence: [] };
  }

  if (!hasExactTagText(dom, "h2", `Форма по ОКУД ${expectedForm}`)) {
    throw new Error("BFO visible report form must be 0710002");
  }
  if (!hasExactTagText(dom, "p", "Ед. измерения: тыс. ₽")) {
    throw new Error("BFO visible report unit must be thousands of rubles");
  }

  const revenueRows = tableRows(dom).filter((cells) => cells[1] === "2110");
  if (revenueRows.length === 0) {
    return { inn: context.inn, reportYear: context.reportYear, revenue: null, evidence: [] };
  }
  if (revenueRows.length > 1) {
    const amounts = new Set(revenueRows.map((cells) => cells[2]));
    throw new Error(amounts.size > 1
      ? "BFO visible report contains conflicting line 2110 rows"
      : "BFO visible report contains duplicate line 2110 rows");
  }
  const row = revenueRows[0]!;
  if (row.length !== 3 || row[0] !== "Выручка" || row[2] === undefined) {
    throw new Error("BFO visible report line 2110 is malformed");
  }

  const revenue = parseDisplayedThousands(row[2]);
  return {
    inn: context.inn,
    reportYear: context.reportYear,
    revenue,
    evidence: [{
      inn: context.inn,
      reportYear: context.reportYear,
      metric: "revenue",
      value: revenue,
      sourceKind: "fns_bfo",
      sourceRecordKey: context.sourceRecordKey,
      observedAt: new Date(Date.parse(context.observedAt)).toISOString(),
      rawFetchKey: context.rawFetchKey,
      parserVersion: context.parserVersion,
    }],
  };
}

function parseFixture(input: Uint8Array): BfoFixtureReport[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
  } catch (error) {
    throw new Error(`BFO fixture JSON is malformed: ${errorMessage(error)}`);
  }

  if (!isRecord(decoded) || decoded.fixtureContract !== "fns-bfo/1.0" || !Array.isArray(decoded.reports)) {
    throw new Error("BFO fixture contract is invalid");
  }

  return decoded.reports.map((report) => parseReport(report));
}

function parseReport(value: unknown): BfoFixtureReport {
  if (!isRecord(value) || !isRecord(value.lines)) {
    throw new Error("BFO fixture report is invalid");
  }
  if (
    typeof value.inn !== "string" ||
    typeof value.form !== "string" ||
    typeof value.reportYear !== "number" ||
    typeof value.unit !== "string" ||
    typeof value.correctedAt !== "string" ||
    typeof value.sourceRecordKey !== "string"
  ) {
    throw new Error("BFO fixture report is invalid");
  }

  const lines: Record<string, string> = {};
  for (const [line, amount] of Object.entries(value.lines)) {
    if (typeof amount !== "string") throw new Error("BFO fixture line amount is invalid");
    lines[line] = amount;
  }

  return {
    inn: value.inn,
    form: value.form,
    reportYear: value.reportYear,
    unit: value.unit,
    correctedAt: value.correctedAt,
    sourceRecordKey: value.sourceRecordKey,
    lines,
  };
}

function validateReport(report: BfoFixtureReport): void {
  parseLegalEntityInn(report.inn);
  if (report.form !== expectedForm) {
    throw new Error("BFO fixture report form must be 0710002");
  }
  if (!compatibleRubleUnits.has(report.unit)) {
    throw new Error("BFO fixture report unit is not ruble-compatible");
  }
  if (!Number.isSafeInteger(Date.parse(report.correctedAt))) {
    throw new Error("BFO fixture correction timestamp is invalid");
  }
  if (report.sourceRecordKey.length === 0) {
    throw new Error("BFO fixture source record key is required");
  }
}

function compareCorrections(left: BfoFixtureReport, right: BfoFixtureReport): number {
  const leftEpochMs = Date.parse(left.correctedAt);
  const rightEpochMs = Date.parse(right.correctedAt);

  if (leftEpochMs !== rightEpochMs) return leftEpochMs < rightEpochMs ? -1 : 1;
  return left.sourceRecordKey.localeCompare(right.sourceRecordKey);
}

const MAX_DATABASE_MONEY_INTEGER = 9_999_999_999_999_999n;

function parseDisplayedThousands(value: string): MoneyText {
  const ungrouped = /^(?:0|[1-9][0-9]*)$/u.test(value);
  const grouped = /^[1-9][0-9]{0,2}(?: [0-9]{3})+$/u.test(value);
  if (!ungrouped && !grouped) {
    throw new Error("BFO visible revenue must be an integer with safe localized separators");
  }
  const rubles = BigInt(value.replaceAll(" ", "")) * 1000n;
  if (rubles > MAX_DATABASE_MONEY_INTEGER) {
    throw new Error("BFO visible revenue exceeds the database numeric(18,2) contract");
  }
  return parseMoneyText(rubles.toString(), "dot");
}

function labeledValues(dom: string, label: string): string[] {
  const values: string[] = [];
  const pattern = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gu;
  for (const match of dom.matchAll(pattern)) {
    if (plainText(match[1] ?? "") === label) values.push(plainText(match[2] ?? ""));
  }
  return values;
}

function tableRows(dom: string): string[][] {
  const rows: string[][] = [];
  for (const row of dom.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)) {
    const cells = [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)]
      .map((cell) => plainText(cell[1] ?? ""));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function hasExactTagText(dom: string, tag: string, expected: string): boolean {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gu");
  return [...dom.matchAll(pattern)].some((match) => plainText(match[1] ?? "") === expected);
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/gu, " "))
    .replace(/[\t\n\f\r ]+/gu, " ")
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#[xX][0-9a-fA-F]+);/gu, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&nbsp;") return "\u00a0";
    const hexadecimal = entity.startsWith("&#x") || entity.startsWith("&#X");
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
