import { SaxesParser } from "saxes";

import {
  parseMoneyText,
  type FinancialMetricEvidence,
} from "../../../domain/financial";
import { parseLegalEntityInn, type LegalEntityInn } from "../../../domain/inn";

export interface RevexpParserContext {
  reportYear: number;
  sourceRecordKey: string;
  rawFetchKey: string;
  parserVersion: string;
}

export function parseRevexp(input: Uint8Array, context: RevexpParserContext): FinancialMetricEvidence[] {
  let innText: string | undefined;
  let incomeText: string | undefined;
  let expensesText: string | undefined;
  let xmlError: Error | undefined;
  const parser = new SaxesParser();

  parser.on("opentag", (tag) => {
    const attributes = tag.attributes;
    innText ??= attributes["ИННЮЛ"];
    incomeText ??= attributes["СумДоход"];
    expensesText ??= attributes["СумРасход"];
  });
  parser.on("error", (error) => {
    xmlError ??= error;
  });

  try {
    parser.write(new TextDecoder("utf-8", { fatal: true }).decode(input)).close();
  } catch (error) {
    throw new Error(`revexp XML is malformed: ${errorMessage(error)}`);
  }

  if (xmlError !== undefined) {
    throw new Error(`revexp XML is malformed: ${xmlError.message}`);
  }
  if (innText === undefined) {
    throw new Error("revexp XML does not contain ИННЮЛ");
  }

  const inn = parseLegalEntityInn(innText);
  return createEvidence(inn, incomeText, expensesText, context);
}

function createEvidence(
  inn: LegalEntityInn,
  incomeText: string | undefined,
  expensesText: string | undefined,
  context: RevexpParserContext,
): FinancialMetricEvidence[] {
  const evidence: FinancialMetricEvidence[] = [];

  if (incomeText !== undefined) {
    evidence.push({
      inn,
      reportYear: context.reportYear,
      metric: "income",
      value: parseMoneyText(incomeText, "dot"),
      sourceKind: "fns_revexp",
      sourceRecordKey: context.sourceRecordKey,
      rawFetchKey: context.rawFetchKey,
      parserVersion: context.parserVersion,
    });
  }
  if (expensesText !== undefined) {
    evidence.push({
      inn,
      reportYear: context.reportYear,
      metric: "expenses",
      value: parseMoneyText(expensesText, "dot"),
      sourceKind: "fns_revexp",
      sourceRecordKey: context.sourceRecordKey,
      rawFetchKey: context.rawFetchKey,
      parserVersion: context.parserVersion,
    });
  }

  return evidence;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
