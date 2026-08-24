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

const DECODE_CHUNK_BYTES = 16_384;

interface RevexpRecordState {
  innText?: string;
  incomeText?: string;
  expensesText?: string;
}

export function parseRevexp(input: Uint8Array, context: RevexpParserContext): FinancialMetricEvidence[] {
  let currentRecord: RevexpRecordState | undefined;
  let records = 0;
  let xmlError: Error | undefined;
  let recordError: Error | undefined;
  const evidence: FinancialMetricEvidence[] = [];
  const parser = new SaxesParser();

  parser.on("opentag", (tag) => {
    if (tag.name === "Документ") {
      records += 1;
      if (currentRecord !== undefined) {
        recordError ??= new Error("revexp XML contains nested Документ records");
      }
      currentRecord = {};
    }
    if (currentRecord === undefined) return;
    const attributes = tag.attributes;
    currentRecord.innText ??= attributes["ИННЮЛ"];
    currentRecord.incomeText ??= attributes["СумДоход"];
    currentRecord.expensesText ??= attributes["СумРасход"];
  });
  parser.on("closetag", (tag) => {
    if (tag.name !== "Документ" || currentRecord === undefined) return;
    const record = currentRecord;
    currentRecord = undefined;
    if (record.innText === undefined) {
      recordError ??= new Error("revexp XML does not contain ИННЮЛ");
      return;
    }
    try {
      evidence.push(...createEvidence(
        parseLegalEntityInn(record.innText),
        record.incomeText,
        record.expensesText,
        context,
      ));
    } catch (error) {
      recordError ??= error instanceof Error ? error : new Error(errorMessage(error));
    }
  });
  parser.on("error", (error) => {
    xmlError ??= error;
  });

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let offset = 0; offset < input.byteLength; offset += DECODE_CHUNK_BYTES) {
      parser.write(decoder.decode(
        input.subarray(offset, Math.min(offset + DECODE_CHUNK_BYTES, input.byteLength)),
        { stream: true },
      ));
    }
    parser.write(decoder.decode()).close();
  } catch (error) {
    throw new Error(`revexp XML is malformed: ${errorMessage(error)}`);
  }

  if (xmlError !== undefined) {
    throw new Error(`revexp XML is malformed: ${xmlError.message}`);
  }
  if (records === 0) {
    throw new Error("revexp XML does not contain ИННЮЛ");
  }
  if (recordError !== undefined) throw recordError;
  return evidence;
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
