import { once } from "node:events";
import { createInflateRaw, type InflateRaw } from "node:zlib";

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
const MAX_ZIP_MEMBER_NAME_BYTES = 65_535;
const MAX_ZIP_EXTRA_BYTES = 65_535;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const MAX_LOCAL_HEADER_BYTES = 30 + MAX_ZIP_MEMBER_NAME_BYTES + MAX_ZIP_EXTRA_BYTES;
const MAX_CENTRAL_RECORD_BYTES = 46
  + MAX_ZIP_MEMBER_NAME_BYTES
  + MAX_ZIP_EXTRA_BYTES
  + MAX_ZIP_COMMENT_BYTES;
// Retain only the one local header and one central record that policy permits.
const MAX_ZIP_TAIL_BYTES = 16 + MAX_CENTRAL_RECORD_BYTES + 22 + MAX_ZIP_COMMENT_BYTES;
// A 4 KiB DEFLATE input slice bounds even a maximum-ratio decoder callback to
// a few MiB, so the cumulative quota is checked well before a 1 GiB allocation.
const MAX_UNZIP_INPUT_CHUNK_BYTES = 4 * 1024;
const DEFLATE_VERIFIER_OUTPUT_CHUNK_BYTES = 16 * 1024;
const DEFLATE_VERIFIER_HIGH_WATER_BYTES = 16 * 1024;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const SUPPORTED_ZIP_FLAGS = 0x0006 | DATA_DESCRIPTOR_FLAG | UTF8_FLAG;
const CRC32_TABLE = createCrc32Table();

export interface RevexpArchiveParserContext extends Omit<RevexpParserContext, "sourceRecordKey"> {
  sourceRecordKey: string | ((inn: LegalEntityInn) => string);
  instrumentation?: {
    onRecordComplete?(snapshot: {
      completedRecords: number;
      retainedTargetRecords: number;
    }): void;
    onExpandedChunk?(snapshot: {
      byteLength: number;
      cumulativeExpandedBytes: number;
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

interface ObservedZipMember {
  name: string;
  compression: number;
  declaredCompressedSize?: number;
  declaredExpandedSize?: number;
  expandedBytes: number;
  crc32State: number;
  crc32?: number;
  actualDeflateCompressedBytes?: number;
  actualDeflateExpandedBytes?: number;
}

type DeflateBoundaryResult =
  | { status: "boundary_found"; consumedBytes: number; expandedBytes: number }
  | { status: "failed"; error: Error };

interface DeflateBoundaryVerifier {
  stream: InflateRaw;
  completion: Promise<DeflateBoundaryResult>;
  result?: DeflateBoundaryResult;
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
  let observedDataMember: ObservedZipMember | undefined;
  let localHeaderInspected = false;
  let deflateBoundaryVerifier: DeflateBoundaryVerifier | undefined;
  let deflateVerifierFeedOffset = 0;
  let zipPrefix: Uint8Array = new Uint8Array(0);
  let zipTail: Uint8Array = new Uint8Array(0);
  let fatalError: Error | undefined;

  const unzip = new Unzip((file) => {
    if (fatalError !== undefined) return;
    archiveMembers += 1;
    try {
      assertSafeMemberName(file.name);
      if (file.name.endsWith("/")) {
        throw new Error("revexp ZIP directory members are not allowed");
      }
      dataMembers += 1;
      if (dataMembers !== 1) throw new Error("revexp ZIP must contain exactly one data member");
      if (!file.name.toLowerCase().endsWith(".xml")) {
        throw new Error("revexp ZIP data member must be XML");
      }
      if (file.originalSize !== undefined && expandedBytes + file.originalSize > limits.expandedBytes) {
        throw new Error("revexp ZIP exceeds the 1 GiB cumulative expanded-byte ceiling");
      }
      observedDataMember = {
        name: file.name,
        compression: file.compression,
        ...(file.size === undefined ? {} : { declaredCompressedSize: file.size }),
        ...(file.originalSize === undefined ? {} : { declaredExpandedSize: file.originalSize }),
        expandedBytes: 0,
        crc32State: 0xffff_ffff,
      };
      attachXmlParser(file, observedDataMember);
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
      zipPrefix = appendZipPrefix(zipPrefix, chunk);
      zipTail = appendZipTail(zipTail, chunk);
      for (let offset = 0; offset < chunk.byteLength; offset += MAX_UNZIP_INPUT_CHUNK_BYTES) {
        unzip.push(chunk.subarray(offset, offset + MAX_UNZIP_INPUT_CHUNK_BYTES), false);
        if (fatalError !== undefined) throw fatalError;
      }
      await advanceDeflateBoundaryVerifier(
        chunk,
        compressedBytes - chunk.byteLength,
        compressedBytes,
      );
    }
    if (compressedBytes === 0) throw new Error("revexp archive stream is empty");
    unzip.push(new Uint8Array(0), true);
    if (fatalError !== undefined) throw fatalError;
    if (dataMembers !== 1 || finalizedDataMembers !== 1) {
      throw new Error("revexp ZIP must contain exactly one complete data member");
    }
    if (observedDataMember?.compression === 8) {
      if (deflateBoundaryVerifier === undefined) {
        throw new Error("revexp ZIP DEFLATE boundary verifier did not observe a complete local header");
      }
      const boundary = await finishDeflateBoundaryVerifier(
        deflateBoundaryVerifier,
      );
      observedDataMember.actualDeflateCompressedBytes = boundary.consumedBytes;
      observedDataMember.actualDeflateExpandedBytes = boundary.expandedBytes;
    }
    validateZipStructure({
      prefix: zipPrefix,
      tail: zipTail,
      totalBytes: compressedBytes,
      observedMembers: archiveMembers,
      observedDataMember,
      limits,
    });
  } catch (error) {
    deflateBoundaryVerifier?.stream.destroy();
    const message = errorMessage(error);
    if (/^revexp /u.test(message)) throw asError(error);
    throw new Error(`revexp ZIP is malformed: ${message}`);
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

  function attachXmlParser(file: UnzipFile, observedMember: ObservedZipMember): void {
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
        context.instrumentation?.onRecordComplete?.({
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
        observedMember.expandedBytes += bytes.byteLength;
        observedMember.crc32State = updateCrc32(observedMember.crc32State, bytes);
        context.instrumentation?.onExpandedChunk?.({
          byteLength: bytes.byteLength,
          cumulativeExpandedBytes: expandedBytes,
        });
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
        observedMember.crc32 = (observedMember.crc32State ^ 0xffff_ffff) >>> 0;
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

  async function advanceDeflateBoundaryVerifier(
    chunk: Uint8Array,
    chunkOffset: number,
    archiveOffset: number,
  ): Promise<void> {
    let createdForCurrentChunk = false;
    if (!localHeaderInspected) {
      const localHeader = readCompleteLocalHeader(zipPrefix);
      if (localHeader === undefined) return;
      localHeaderInspected = true;
      if (localHeader.method !== 8) return;
      deflateBoundaryVerifier = createDeflateBoundaryVerifier(limits.expandedBytes);
      deflateVerifierFeedOffset = localHeader.dataOffset;
      const submittedBytes = await writeDeflateVerifier(
        deflateBoundaryVerifier,
        zipPrefix.subarray(localHeader.dataOffset),
      );
      deflateVerifierFeedOffset += submittedBytes;
      createdForCurrentChunk = true;
    }
    if (deflateBoundaryVerifier === undefined) return;
    if (deflateBoundaryVerifier.result?.status === "boundary_found") return;
    if (deflateBoundaryVerifier.result?.status === "failed") {
      throw deflateBoundaryVerifier.result.error;
    }
    if (deflateVerifierFeedOffset < chunkOffset) {
      throw new Error("revexp ZIP DEFLATE verifier input contains an internal gap");
    }
    if (deflateVerifierFeedOffset > chunkOffset && !createdForCurrentChunk) {
      throw new Error("revexp ZIP DEFLATE verifier input duplicates payload bytes");
    }
    if (deflateVerifierFeedOffset > archiveOffset) {
      throw new Error("revexp ZIP DEFLATE verifier input offset exceeds the archive stream");
    }
    if (deflateVerifierFeedOffset === archiveOffset) return;
    const submittedBytes = await writeDeflateVerifier(
      deflateBoundaryVerifier,
      chunk.subarray(deflateVerifierFeedOffset - chunkOffset),
    );
    deflateVerifierFeedOffset += submittedBytes;
    if (!hasFoundDeflateBoundary(deflateBoundaryVerifier)
      && deflateVerifierFeedOffset !== archiveOffset) {
      throw new Error("revexp ZIP DEFLATE verifier did not consume contiguous archive input");
    }
  }
}

function hasFoundDeflateBoundary(verifier: DeflateBoundaryVerifier): boolean {
  return verifier.result?.status === "boundary_found";
}

function readCompleteLocalHeader(prefix: Uint8Array): { dataOffset: number; method: number } | undefined {
  if (prefix.byteLength < 30 || readUint32(prefix, 0) !== 0x04034b50) return undefined;
  const dataOffset = 30 + readUint16(prefix, 26) + readUint16(prefix, 28);
  if (prefix.byteLength < dataOffset) return undefined;
  return { dataOffset, method: readUint16(prefix, 8) };
}

function createDeflateBoundaryVerifier(expandedByteCeiling: number): DeflateBoundaryVerifier {
  const streamOptions = {
    chunkSize: DEFLATE_VERIFIER_OUTPUT_CHUNK_BYTES,
    readableHighWaterMark: DEFLATE_VERIFIER_HIGH_WATER_BYTES,
    writableHighWaterMark: DEFLATE_VERIFIER_HIGH_WATER_BYTES,
  };
  const stream = createInflateRaw(streamOptions);
  let expandedBytes = 0;
  let resolveResult: (result: DeflateBoundaryResult) => void = () => {};
  const verifier: DeflateBoundaryVerifier = {
    stream,
    completion: new Promise((resolve) => { resolveResult = resolve; }),
  };
  const settle = (result: DeflateBoundaryResult): void => {
    if (verifier.result !== undefined) return;
    verifier.result = result;
    resolveResult(result);
  };
  stream.on("data", (bytes: Buffer) => {
    expandedBytes += bytes.byteLength;
    if (expandedBytes > expandedByteCeiling) {
      stream.destroy(new Error("revexp ZIP DEFLATE verifier exceeds the cumulative expanded-byte ceiling"));
    }
    // Keep the readable side flowing; every bounded output chunk is discarded immediately.
  });
  stream.once("error", (error) => {
    settle({
      status: "failed",
      error: new Error(`revexp ZIP DEFLATE verifier failed: ${errorMessage(error)}`),
    });
  });
  stream.once("end", () => {
    // Node 24 stops bytesWritten at the raw DEFLATE end marker even when the
    // same write also contains a descriptor or central-directory bytes.
    const consumedBytes = stream.bytesWritten;
    if (!Number.isSafeInteger(consumedBytes) || consumedBytes < 0) {
      settle({
        status: "failed",
        error: new Error("revexp ZIP DEFLATE verifier did not report an exact consumed-byte count"),
      });
      return;
    }
    settle({ status: "boundary_found", consumedBytes, expandedBytes });
  });
  stream.once("close", () => {
    settle({
      status: "failed",
      error: new Error("revexp ZIP DEFLATE verifier closed before reporting consumed bytes"),
    });
  });
  return verifier;
}

async function writeDeflateVerifier(
  verifier: DeflateBoundaryVerifier,
  bytes: Uint8Array,
): Promise<number> {
  let submittedBytes = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_UNZIP_INPUT_CHUNK_BYTES) {
    if (verifier.result?.status === "boundary_found") return submittedBytes;
    if (verifier.result?.status === "failed") throw verifier.result.error;
    const input = bytes.subarray(offset, offset + MAX_UNZIP_INPUT_CHUNK_BYTES);
    let acceptsMore: boolean;
    try {
      acceptsMore = verifier.stream.write(input);
      submittedBytes += input.byteLength;
    } catch (error) {
      throw new Error(`revexp ZIP DEFLATE verifier failed: ${errorMessage(error)}`);
    }
    if (acceptsMore) continue;
    let outcome: "drain" | DeflateBoundaryResult;
    try {
      outcome = await Promise.race([
        once(verifier.stream, "drain").then(() => "drain" as const),
        verifier.completion,
      ]);
    } catch (error) {
      throw new Error(`revexp ZIP DEFLATE verifier failed: ${errorMessage(error)}`);
    }
    if (outcome === "drain") continue;
    if (outcome.status === "failed") throw outcome.error;
    return submittedBytes;
  }
  return submittedBytes;
}

async function finishDeflateBoundaryVerifier(
  verifier: DeflateBoundaryVerifier,
): Promise<Extract<DeflateBoundaryResult, { status: "boundary_found" }>> {
  if (verifier.result !== undefined) {
    if (verifier.result.status === "failed") throw verifier.result.error;
    return verifier.result;
  }
  try {
    verifier.stream.end();
  } catch (error) {
    throw new Error(`revexp ZIP DEFLATE verifier failed: ${errorMessage(error)}`);
  }
  const result = await verifier.completion;
  if (result.status === "failed") throw result.error;
  return result;
}

function appendZipPrefix(previous: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (previous.byteLength >= MAX_LOCAL_HEADER_BYTES) return previous;
  const appendedBytes = Math.min(chunk.byteLength, MAX_LOCAL_HEADER_BYTES - previous.byteLength);
  const prefix = new Uint8Array(previous.byteLength + appendedBytes);
  prefix.set(previous);
  prefix.set(chunk.subarray(0, appendedBytes), previous.byteLength);
  return prefix;
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

function validateZipStructure(input: {
  prefix: Uint8Array;
  tail: Uint8Array;
  totalBytes: number;
  observedMembers: number;
  observedDataMember: ObservedZipMember | undefined;
  limits: { compressedBytes: number; expandedBytes: number };
}): void {
  const { prefix, tail, totalBytes, observedMembers, observedDataMember, limits } = input;
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
    || centralOffset === 0xffffffff) {
    throw new Error("revexp ZIP is malformed: central-directory metadata is inconsistent");
  }
  if (totalEntries !== 1 || observedMembers !== 1 || observedDataMember === undefined) {
    throw new Error("revexp ZIP must contain exactly one central-directory record");
  }
  if (centralSize < 46 || centralSize > MAX_CENTRAL_RECORD_BYTES) {
    throw new Error("revexp ZIP is malformed: central-directory record length is invalid");
  }
  if (centralOffset + centralSize !== absoluteEndOffset) {
    throw new Error("revexp ZIP is malformed: central-directory metadata is inconsistent");
  }
  const tailStart = totalBytes - tail.byteLength;
  if (centralOffset < tailStart) {
    throw new Error("revexp ZIP is malformed: central-directory record exceeds the retained validation window");
  }
  const recordOffset = centralOffset - tailStart;
  if (readUint32(tail, recordOffset) !== 0x02014b50) {
    throw new Error("revexp ZIP is malformed: central-directory record signature is invalid");
  }
  const centralFlags = readUint16(tail, recordOffset + 8);
  const centralMethod = readUint16(tail, recordOffset + 10);
  const centralCrc = readUint32(tail, recordOffset + 16);
  const centralCompressedSize = readUint32(tail, recordOffset + 20);
  const centralExpandedSize = readUint32(tail, recordOffset + 24);
  const centralNameLength = readUint16(tail, recordOffset + 28);
  const centralExtraLength = readUint16(tail, recordOffset + 30);
  const centralCommentLength = readUint16(tail, recordOffset + 32);
  const centralDiskStart = readUint16(tail, recordOffset + 34);
  const localHeaderOffset = readUint32(tail, recordOffset + 42);
  const centralRecordLength = 46 + centralNameLength + centralExtraLength + centralCommentLength;
  if (centralRecordLength !== centralSize || recordOffset + centralRecordLength !== endOffset) {
    throw new Error("revexp ZIP is malformed: central-directory record length is invalid");
  }
  if (centralDiskStart !== 0
    || centralCompressedSize === 0xffff_ffff
    || centralExpandedSize === 0xffff_ffff
    || localHeaderOffset === 0xffff_ffff) {
    throw new Error("revexp ZIP is malformed: ZIP64 or multi-disk metadata is not supported");
  }
  assertSupportedZipFlags(centralFlags, centralMethod, "central");
  assertSupportedCompression(centralMethod, "central");
  if (centralCompressedSize > limits.compressedBytes) {
    throw new Error("revexp ZIP central compressed size exceeds the compressed-byte ceiling");
  }
  if (centralExpandedSize > limits.expandedBytes) {
    throw new Error("revexp ZIP central expanded-size claim exceeds the expanded-byte ceiling");
  }
  const centralNameBytes = tail.subarray(recordOffset + 46, recordOffset + 46 + centralNameLength);
  const centralName = decodeZipName(centralNameBytes, centralFlags, "central");
  assertSafeMemberName(centralName);

  if (localHeaderOffset !== 0) {
    throw new Error("revexp ZIP is malformed: central local-header offset is invalid");
  }
  if (prefix.byteLength < 30 || readUint32(prefix, 0) !== 0x04034b50) {
    throw new Error("revexp ZIP is malformed: local-header record is missing");
  }
  const localFlags = readUint16(prefix, 6);
  const localMethod = readUint16(prefix, 8);
  const localCrc = readUint32(prefix, 14);
  const localCompressedSize = readUint32(prefix, 18);
  const localExpandedSize = readUint32(prefix, 22);
  const localNameLength = readUint16(prefix, 26);
  const localExtraLength = readUint16(prefix, 28);
  const dataOffset = 30 + localNameLength + localExtraLength;
  if (dataOffset > prefix.byteLength) {
    throw new Error("revexp ZIP is malformed: local-header record is truncated");
  }
  assertSupportedZipFlags(localFlags, localMethod, "local");
  assertSupportedCompression(localMethod, "local");
  const localNameBytes = prefix.subarray(30, 30 + localNameLength);
  const localName = decodeZipName(localNameBytes, localFlags, "local");
  assertSafeMemberName(localName);
  if (localFlags !== centralFlags) {
    throw new Error("revexp ZIP is malformed: local and central flags differ");
  }
  if (localMethod !== centralMethod || observedDataMember.compression !== centralMethod) {
    throw new Error("revexp ZIP is malformed: local and central compression method differs");
  }
  if (!bytesEqual(localNameBytes, centralNameBytes)
    || localName !== centralName
    || observedDataMember.name !== centralName) {
    throw new Error("revexp ZIP is malformed: local and central member name differs");
  }
  if (centralMethod === 8
    && observedDataMember.actualDeflateCompressedBytes !== centralCompressedSize) {
    throw new Error("revexp ZIP DEFLATE stream consumed bytes differ from the declared compressed size");
  }
  if (centralMethod === 8
    && observedDataMember.actualDeflateExpandedBytes !== centralExpandedSize) {
    throw new Error("revexp ZIP DEFLATE expanded bytes differ from the declared expanded size");
  }
  if (observedDataMember.declaredCompressedSize !== undefined
    && observedDataMember.declaredCompressedSize !== centralCompressedSize) {
    throw new Error("revexp ZIP is malformed: declared compressed size differs");
  }
  if (observedDataMember.declaredExpandedSize !== undefined
    && observedDataMember.declaredExpandedSize !== centralExpandedSize) {
    throw new Error("revexp ZIP is malformed: declared expanded size differs");
  }
  if (observedDataMember.expandedBytes !== centralExpandedSize) {
    throw new Error("revexp ZIP is malformed: actual and central expanded size differs");
  }
  if (observedDataMember.crc32 === undefined || observedDataMember.crc32 !== centralCrc) {
    throw new Error("revexp ZIP is malformed: actual and central CRC differ");
  }

  const dataEnd = dataOffset + centralCompressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
    throw new Error("revexp ZIP is malformed: compressed size overlaps the central directory");
  }
  if ((localFlags & DATA_DESCRIPTOR_FLAG) === 0) {
    if (localCrc !== centralCrc) throw new Error("revexp ZIP is malformed: local and central CRC differ");
    if (localCompressedSize !== centralCompressedSize) {
      throw new Error("revexp ZIP is malformed: local and central compressed size differs");
    }
    if (localExpandedSize !== centralExpandedSize) {
      throw new Error("revexp ZIP is malformed: local and central expanded size differs");
    }
    if (dataEnd !== centralOffset) {
      throw new Error("revexp ZIP is malformed: trailing data precedes the central directory");
    }
    return;
  }

  if (localCrc !== 0 || localCompressedSize !== 0 || localExpandedSize !== 0) {
    throw new Error("revexp ZIP is malformed: data-descriptor local claims are ambiguous");
  }
  validateDataDescriptor({
    tail,
    tailStart,
    descriptorOffset: dataEnd,
    centralOffset,
    centralCrc,
    centralCompressedSize,
    centralExpandedSize,
  });
}

function validateDataDescriptor(input: {
  tail: Uint8Array;
  tailStart: number;
  descriptorOffset: number;
  centralOffset: number;
  centralCrc: number;
  centralCompressedSize: number;
  centralExpandedSize: number;
}): void {
  const {
    tail,
    tailStart,
    descriptorOffset,
    centralOffset,
    centralCrc,
    centralCompressedSize,
    centralExpandedSize,
  } = input;
  if (descriptorOffset < tailStart) {
    throw new Error("revexp ZIP is malformed: data descriptor exceeds the retained validation window");
  }
  const offset = descriptorOffset - tailStart;
  const signed = readUint32(tail, offset) === 0x08074b50;
  const valueOffset = offset + (signed ? 4 : 0);
  const descriptorLength = signed ? 16 : 12;
  if (descriptorOffset + descriptorLength !== centralOffset
    || valueOffset + 12 > tail.byteLength) {
    throw new Error("revexp ZIP is malformed: data descriptor length is invalid");
  }
  if (readUint32(tail, valueOffset) !== centralCrc) {
    throw new Error("revexp ZIP is malformed: data-descriptor CRC differs");
  }
  if (readUint32(tail, valueOffset + 4) !== centralCompressedSize) {
    throw new Error("revexp ZIP is malformed: data-descriptor compressed size differs");
  }
  if (readUint32(tail, valueOffset + 8) !== centralExpandedSize) {
    throw new Error("revexp ZIP is malformed: data-descriptor expanded size differs");
  }
}

function assertSupportedZipFlags(flags: number, method: number, source: "local" | "central"): void {
  if ((flags & ~SUPPORTED_ZIP_FLAGS) !== 0 || (flags & 0x0001) !== 0) {
    throw new Error(`revexp ZIP is malformed: ${source} flags are unsupported`);
  }
  if (method !== 8 && (flags & 0x0006) !== 0) {
    throw new Error(`revexp ZIP is malformed: ${source} flags are inconsistent with compression method`);
  }
}

function assertSupportedCompression(method: number, source: "local" | "central"): void {
  if (method !== 0 && method !== 8) {
    throw new Error(`revexp ZIP is malformed: ${source} compression method is unsupported`);
  }
}

function decodeZipName(bytes: Uint8Array, flags: number, source: "local" | "central"): string {
  try {
    if ((flags & UTF8_FLAG) !== 0) return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (bytes.some((byte) => byte > 0x7f)) {
      throw new Error("non-ASCII member name lacks the UTF-8 flag");
    }
    return new TextDecoder("ascii", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`revexp ZIP is malformed: ${source} member name is invalid: ${errorMessage(error)}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function updateCrc32(state: number, bytes: Uint8Array): number {
  let crc = state >>> 0;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return crc;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = ((value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0)) >>> 0;
    }
    table[index] = value;
  }
  return table;
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
