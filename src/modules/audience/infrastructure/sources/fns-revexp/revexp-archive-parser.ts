import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { SaxesParser, type SaxesTagPlain } from "saxes";

import type { FinancialMetricEvidence } from "../../../domain/financial";
import { parseLegalEntityInn, type LegalEntityInn } from "../../../domain/inn";
import {
  parseRevexp,
  type RevexpParserContext,
  type RevexpSelectedRecord,
} from "./revexp-parser";
import { REVEXP_MAX_COMPRESSED_BYTES } from "./revexp-release";

export const REVEXP_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_TARGET_INNS = 10;
const MAX_ZIP_TAIL_BYTES = 22 + 65_535;

export interface RevexpArchiveParserContext extends Omit<RevexpParserContext, "sourceRecordKey"> {
  sourceRecordKey: string | ((inn: LegalEntityInn) => string);
  instrumentation?: {
    onRecordComplete(snapshot: {
      completedRecords: number;
      retainedTargetRecords: number;
    }): void;
  };
  /** Tests may lower, but never raise, the production ceilings. */
  testLimits?: {
    compressedBytes: number;
    expandedBytes: number;
  };
}

interface CandidateRecord {
  record: RevexpSelectedRecord;
  correctionNumber: number;
  correctionDate: string;
  documentId: string;
  ordinal: number;
}

interface XmlRecordState {
  inn?: string;
  income?: string;
  expenses?: string;
  correctionNumber?: string;
  correctionDate?: string;
  documentId?: string;
}

export async function selectRevexpMetrics(
  archiveStream: AsyncIterable<Uint8Array>,
  targetInns: readonly string[],
  context: RevexpArchiveParserContext,
): Promise<FinancialMetricEvidence[]> {
  const orderedTargets = validateTargets(targetInns);
  const targetSet = new Set<string>(orderedTargets);
  const limits = validatedLimits(context.testLimits);
  const retained = new Map<LegalEntityInn, CandidateRecord>();
  let completedRecords = 0;
  let compressedBytes = 0;
  let expandedBytes = 0;
  let archiveMembers = 0;
  let dataMembers = 0;
  let finalizedDataMembers = 0;
  let zipTail: Uint8Array = new Uint8Array(0);
  let fatalError: Error | undefined;

  const unzip = new Unzip((file) => {
    if (fatalError !== undefined) return;
    archiveMembers += 1;
    try {
      assertSafeMemberName(file.name);
      if (file.name.endsWith("/")) {
        if (file.originalSize !== undefined && file.originalSize !== 0) {
          throw new Error("revexp ZIP directory member must be empty");
        }
        file.ondata = (error, bytes) => {
          if (error !== null) fatalError ??= zipError(error);
          if (bytes.byteLength !== 0) fatalError ??= new Error("revexp ZIP directory member must be empty");
        };
        file.start();
        return;
      }
      dataMembers += 1;
      if (dataMembers !== 1) throw new Error("revexp ZIP must contain exactly one data member");
      if (!file.name.toLowerCase().endsWith(".xml")) {
        throw new Error("revexp ZIP data member must be XML");
      }
      if (file.originalSize !== undefined && expandedBytes + file.originalSize > limits.expandedBytes) {
        throw new Error("revexp ZIP exceeds the 1 GiB cumulative expanded-byte ceiling");
      }
      attachXmlParser(file);
    } catch (error) {
      fatalError ??= asError(error);
      file.terminate();
    }
  });
  unzip.register(UnzipInflate);

  try {
    for await (const chunk of archiveStream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("revexp archive stream yielded non-byte data");
      if (chunk.byteLength === 0) continue;
      compressedBytes += chunk.byteLength;
      if (compressedBytes > limits.compressedBytes) {
        throw new Error("revexp archive exceeds the 256 MiB compressed-byte ceiling");
      }
      zipTail = appendZipTail(zipTail, chunk);
      unzip.push(chunk, false);
      if (fatalError !== undefined) throw fatalError;
    }
    if (compressedBytes === 0) throw new Error("revexp archive stream is empty");
    unzip.push(new Uint8Array(0), true);
    if (fatalError !== undefined) throw fatalError;
    validateZipEnd(zipTail, compressedBytes, archiveMembers);
  } catch (error) {
    const message = errorMessage(error);
    if (/^revexp /u.test(message)) throw asError(error);
    throw new Error(`revexp ZIP is malformed: ${message}`);
  }

  if (dataMembers !== 1 || finalizedDataMembers !== 1) {
    throw new Error("revexp ZIP must contain exactly one complete data member");
  }

  const evidence: FinancialMetricEvidence[] = [];
  for (const inn of orderedTargets) {
    const candidate = retained.get(inn);
    if (candidate === undefined) continue;
    const sourceRecordKey = typeof context.sourceRecordKey === "function"
      ? context.sourceRecordKey(inn)
      : context.sourceRecordKey;
    evidence.push(...parseRevexp(candidate.record, {
      reportYear: context.reportYear,
      sourceRecordKey,
      observedAt: context.observedAt,
      rawFetchKey: context.rawFetchKey,
      parserVersion: context.parserVersion,
    }));
  }
  return evidence;

  function attachXmlParser(file: UnzipFile): void {
    let current: XmlRecordState | undefined;
    let xmlError: Error | undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const parser = new SaxesParser();

    parser.on("opentag", (tag) => {
      if (tag.name === "Документ") {
        if (current !== undefined) {
          fatalError ??= new Error("revexp XML contains nested Документ records");
          return;
        }
        current = {
          correctionNumber: attribute(tag, "НомКорр"),
          correctionDate: attribute(tag, "ДатаДок"),
          documentId: attribute(tag, "ИдДок"),
        };
      }
      if (current === undefined) return;
      current.inn ??= attribute(tag, "ИННЮЛ");
      current.income ??= attribute(tag, "СумДоход");
      current.expenses ??= attribute(tag, "СумРасход");
    });
    parser.on("closetag", (tag) => {
      if (tag.name !== "Документ" || current === undefined) return;
      const finished = current;
      current = undefined;
      completedRecords += 1;
      try {
        if (finished.inn === undefined) throw new Error("revexp XML does not contain ИННЮЛ");
        if (targetSet.has(finished.inn)) retainTarget(finished, completedRecords);
        context.instrumentation?.onRecordComplete({
          completedRecords,
          retainedTargetRecords: retained.size,
        });
      } catch (error) {
        fatalError ??= asError(error);
      }
    });
    parser.on("error", (error) => { xmlError ??= error; });

    file.ondata = (error, bytes, final) => {
      if (fatalError !== undefined) return;
      if (error !== null) {
        fatalError = zipError(error);
        return;
      }
      try {
        expandedBytes += bytes.byteLength;
        if (expandedBytes > limits.expandedBytes) {
          fatalError = new Error("revexp ZIP exceeds the 1 GiB cumulative expanded-byte ceiling");
          file.terminate();
          return;
        }
        parser.write(decoder.decode(bytes, { stream: !final }));
        if (!final) return;
        parser.write(decoder.decode()).close();
        if (xmlError !== undefined) throw xmlError;
        if (current !== undefined) throw new Error("revexp XML ended inside a Документ record");
        if (completedRecords === 0) throw new Error("revexp XML does not contain ИННЮЛ");
        finalizedDataMembers += 1;
      } catch (caught) {
        fatalError ??= new Error(`revexp XML is malformed: ${errorMessage(caught)}`);
      }
    };
    file.start();
  }

  function retainTarget(record: XmlRecordState, ordinal: number): void {
    const inn = parseLegalEntityInn(record.inn!);
    const candidate: CandidateRecord = {
      record: {
        inn,
        ...(record.income === undefined ? {} : { income: record.income }),
        ...(record.expenses === undefined ? {} : { expenses: record.expenses }),
      },
      correctionNumber: correctionNumber(record.correctionNumber),
      correctionDate: correctionDate(record.correctionDate),
      documentId: record.documentId ?? "",
      ordinal,
    };
    const previous = retained.get(inn);
    if (previous === undefined || compareCandidate(candidate, previous) > 0) retained.set(inn, candidate);
  }
}

function appendZipTail(previous: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (chunk.byteLength >= MAX_ZIP_TAIL_BYTES) {
    return chunk.slice(chunk.byteLength - MAX_ZIP_TAIL_BYTES);
  }
  const previousBytes = Math.min(previous.byteLength, MAX_ZIP_TAIL_BYTES - chunk.byteLength);
  const tail = new Uint8Array(previousBytes + chunk.byteLength);
  tail.set(previous.subarray(previous.byteLength - previousBytes), 0);
  tail.set(chunk, previousBytes);
  return tail;
}

function validateZipEnd(tail: Uint8Array, totalBytes: number, observedMembers: number): void {
  let endOffset = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (readUint32(tail, offset) !== 0x06054b50) continue;
    const commentLength = readUint16(tail, offset + 20);
    if (offset + 22 + commentLength === tail.byteLength) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("revexp ZIP is malformed: end-of-central-directory record is missing");
  const disk = readUint16(tail, endOffset + 4);
  const centralDisk = readUint16(tail, endOffset + 6);
  const diskEntries = readUint16(tail, endOffset + 8);
  const totalEntries = readUint16(tail, endOffset + 10);
  const centralSize = readUint32(tail, endOffset + 12);
  const centralOffset = readUint32(tail, endOffset + 16);
  const absoluteEndOffset = totalBytes - tail.byteLength + endOffset;
  if (disk !== 0
    || centralDisk !== 0
    || diskEntries !== totalEntries
    || totalEntries === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || totalEntries !== observedMembers
    || centralOffset + centralSize !== absoluteEndOffset) {
    throw new Error("revexp ZIP is malformed: central-directory metadata is inconsistent");
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0;
}

function validateTargets(inputs: readonly string[]): LegalEntityInn[] {
  if (inputs.length === 0 || inputs.length > MAX_TARGET_INNS) {
    throw new Error("revexp target set must contain between 1 and 10 legal-entity INNs");
  }
  const targets = inputs.map((inn) => parseLegalEntityInn(inn));
  if (new Set(targets).size !== targets.length) throw new Error("revexp target INNs must be unique");
  return targets;
}

function validatedLimits(testLimits: RevexpArchiveParserContext["testLimits"]): {
  compressedBytes: number;
  expandedBytes: number;
} {
  if (testLimits === undefined) {
    return {
      compressedBytes: REVEXP_MAX_COMPRESSED_BYTES,
      expandedBytes: REVEXP_MAX_EXPANDED_BYTES,
    };
  }
  if (!Number.isSafeInteger(testLimits.compressedBytes)
    || testLimits.compressedBytes <= 0
    || testLimits.compressedBytes > REVEXP_MAX_COMPRESSED_BYTES
    || !Number.isSafeInteger(testLimits.expandedBytes)
    || testLimits.expandedBytes <= 0
    || testLimits.expandedBytes > REVEXP_MAX_EXPANDED_BYTES) {
    throw new Error("revexp test limits may only lower the production byte ceilings");
  }
  return testLimits;
}

function assertSafeMemberName(name: string): void {
  if (name === ""
    || name.includes("\0")
    || name.includes("\\")
    || name.startsWith("/")
    || /^[A-Za-z]:/u.test(name)
    || name.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("revexp ZIP contains a traversal member name");
  }
}

function attribute(tag: SaxesTagPlain, name: string): string | undefined {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : undefined;
}

function correctionNumber(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  if (!/^[0-9]+$/u.test(value)) throw new Error("revexp correction number is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("revexp correction number is invalid");
  return parsed;
}

function correctionDate(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  let isoDate = value;
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value);
  if (russian !== null) isoDate = `${russian[3]}-${russian[2]}-${russian[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)
    || !Number.isFinite(Date.parse(`${isoDate}T00:00:00.000Z`))
    || new Date(Date.parse(`${isoDate}T00:00:00.000Z`)).toISOString().slice(0, 10) !== isoDate) {
    throw new Error("revexp correction date is invalid");
  }
  return isoDate;
}

function compareCandidate(left: CandidateRecord, right: CandidateRecord): number {
  return left.correctionNumber - right.correctionNumber
    || compareText(left.correctionDate, right.correctionDate)
    || compareText(left.documentId, right.documentId)
    || left.ordinal - right.ordinal;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function zipError(error: unknown): Error {
  return new Error(`revexp ZIP is malformed: ${errorMessage(error)}`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
