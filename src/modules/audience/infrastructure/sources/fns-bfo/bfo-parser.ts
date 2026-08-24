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
  return left.correctedAt.localeCompare(right.correctedAt) || left.sourceRecordKey.localeCompare(right.sourceRecordKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
