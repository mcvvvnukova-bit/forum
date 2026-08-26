import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { Zip, ZipDeflate, zipSync } from "fflate";

import { parseMoneyText } from "../../../src/modules/audience/domain/financial";
import { selectRevexpMetrics } from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser";
import { parseRevexp } from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser";

const context = {
  reportYear: 2025,
  sourceRecordKey: "7707083893:2025:revexp",
  observedAt: "2026-08-24T09:00:00.000Z",
  rawFetchKey: "raw/fns-revexp/7707083893-2025.xml",
  parserVersion: "fns-revexp/1.0.0",
};

describe("parseRevexp", () => {
  it("maps one selected streaming record through the same domain boundary", () => {
    expect(parseRevexp({
      inn: "7707083893",
      income: "999999999999999999999999999999",
      expenses: "42",
    }, context).map((item) => [item.metric, item.value])).toEqual([
      ["income", "999999999999999999999999999999.00"],
      ["expenses", "42.00"],
    ]);
  });

  it("maps only revexp income and expenses and retains fixture provenance", async () => {
    const xml = await readFile(new URL("../../fixtures/fns-revexp/revexp.xml", import.meta.url));

    expect(parseRevexp(xml, context)).toEqual([
      {
        inn: "7707083893",
        reportYear: 2025,
        metric: "income",
        value: "150000.00",
        sourceKind: "fns_revexp",
        sourceRecordKey: "7707083893:2025:revexp",
        observedAt: "2026-08-24T09:00:00.000Z",
        rawFetchKey: "raw/fns-revexp/7707083893-2025.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
      {
        inn: "7707083893",
        reportYear: 2025,
        metric: "expenses",
        value: "0.00",
        sourceKind: "fns_revexp",
        sourceRecordKey: "7707083893:2025:revexp",
        observedAt: "2026-08-24T09:00:00.000Z",
        rawFetchKey: "raw/fns-revexp/7707083893-2025.xml",
        parserVersion: "fns-revexp/1.0.0",
      },
    ]);
  });

  it("does not invent an expense evidence row when СумРасход is absent", () => {
    const xml = new TextEncoder().encode(
      '<Документ><СвЮЛ ИННЮЛ="7707083893"/><Показатели СумДоход="0"/></Документ>',
    );

    expect(parseRevexp(xml, context).map((item) => [item.metric, item.value])).toEqual([
      ["income", "0.00"],
    ]);
  });

  it("keeps metrics inside each XML record when the first record omits a metric", () => {
    const xml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
      <Файл>
        <Документ><СвЮЛ ИННЮЛ="7707083893"/><Показатели СумДоход="100"/></Документ>
        <Документ><СвЮЛ ИННЮЛ="7710140679"/><Показатели СумРасход="25"/></Документ>
      </Файл>`);

    expect(parseRevexp(xml, context).map((item) => [item.inn, item.metric, item.value])).toEqual([
      ["7707083893", "income", "100.00"],
      ["7710140679", "expenses", "25.00"],
    ]);
  });

  it("incrementally decodes a UTF-8 code point split across the parser chunk boundary", () => {
    const prefix = '<?xml version="1.0" encoding="UTF-8"?><Файл>';
    const prefixBytes = new TextEncoder().encode(prefix).byteLength;
    // Place the first byte of the two-byte Cyrillic "Д" at offset 16,383 so
    // the decoder must carry it into the next 16,384-byte parser chunk.
    const padding = " ".repeat((16_382 - prefixBytes + 16_384) % 16_384);
    const xml = new TextEncoder().encode(
      `${prefix}${padding}<Документ><СвЮЛ ИННЮЛ="7707083893"/><Показатели СумДоход="7"/></Документ></Файл>`,
    );

    expect([...xml.slice(16_383, 16_385)]).toEqual([0xd0, 0x94]);
    expect(parseRevexp(xml, context).map((item) => [item.metric, item.value])).toEqual([
      ["income", "7.00"],
    ]);
  });

  it.each([
    ["an invalid legal-entity checksum", '<Документ><СвЮЛ ИННЮЛ="7707083894"/></Документ>', "checksum"],
    ["an individual INN", '<Документ><СвЮЛ ИННЮЛ="123456789012"/></Документ>', "legal entity"],
    ["malformed XML", '<Документ><СвЮЛ ИННЮЛ="7707083893"></Документ>', "XML"],
    ["exponent money", '<Документ><СвЮЛ ИННЮЛ="7707083893"/><Показатели СумДоход="1e3"/></Документ>', "decimal"],
    ["over-precise money", '<Документ><СвЮЛ ИННЮЛ="7707083893"/><Показатели СумДоход="1.234"/></Документ>', "decimal"],
  ])("rejects %s", (_case, source, expectedMessage) => {
    expect(() => parseRevexp(new TextEncoder().encode(source), context)).toThrow(expectedMessage);
  });
});

describe("selectRevexpMetrics", () => {
  const targetInns = [
    "7700000016", "7700000023", "7700000030", "7700000048", "7700000055",
    "7700000062", "7700000070", "7700000087", "7700000094", "7700000104",
  ] as const;
  const archiveContext = {
    reportYear: 2025,
    sourceRecordKey: (inn: string) => `${inn}:2025:7707329152-revexp`,
    observedAt: "2026-08-26T09:00:02.000Z",
    rawFetchKey: "a".repeat(64),
    parserVersion: "fns-revexp/1.0.0+xsd-5.10",
  };

  it("streams a large member, retains only target corrections, and leaves missing targets absent", async () => {
    const unrelated = Array.from({ length: 4_000 }, (_, index) =>
      `<Документ><СвЮЛ ИННЮЛ="${String(7800000000 + index)}"/><Показатели СумДоход="${index}"/></Документ>`).join("");
    const targets = targetInns.slice(0, 9).map((inn, index) =>
      `<Документ НомКорр="0" ДатаДок="2026-03-01"><СвЮЛ ИННЮЛ="${inn}"/><Показатели СумДоход="${index + 1}" СумРасход="${index + 101}"/></Документ>`).join("");
    const corrections = [
      `<Документ НомКорр="2" ДатаДок="2026-03-10"><СвЮЛ ИННЮЛ="7700000016"/><Показатели СумДоход="999999999999999999999999999999" СумРасход="222"/></Документ>`,
      `<Документ НомКорр="1" ДатаДок="2026-03-20"><СвЮЛ ИННЮЛ="7700000016"/><Показатели СумДоход="111" СумРасход="111"/></Документ>`,
    ].join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Файл>${unrelated}${targets}${corrections}</Файл>`;
    const archive = archiveWith({ "revexp-2025.xml": new TextEncoder().encode(xml) });
    let maxRetainedTargetRecords = 0;
    let completedRecords = 0;

    const evidence = await selectRevexpMetrics(chunked(archive, 97), targetInns, {
      ...archiveContext,
      instrumentation: {
        onRecordComplete(snapshot) {
          completedRecords = snapshot.completedRecords;
          maxRetainedTargetRecords = Math.max(maxRetainedTargetRecords, snapshot.retainedTargetRecords);
        },
      },
    });

    expect(completedRecords).toBe(4_011);
    expect(maxRetainedTargetRecords).toBeLessThanOrEqual(9);
    expect(evidence).toHaveLength(18);
    expect(evidence.slice(0, 2)).toEqual([
      expect.objectContaining({
        inn: "7700000016",
        metric: "income",
        value: "999999999999999999999999999999.00",
        sourceRecordKey: "7700000016:2025:7707329152-revexp",
        rawFetchKey: "a".repeat(64),
      }),
      expect.objectContaining({ inn: "7700000016", metric: "expenses", value: "222.00" }),
    ]);
    expect(new Set(evidence.map((item) => item.inn))).not.toContain("7700000104");
  });

  it.each([
    ["malformed XML", archiveWith({ "revexp.xml": new TextEncoder().encode("<Файл><Документ></Файл>") }), "XML"],
    ["a truncated ZIP", archiveWith({ "revexp.xml": validXml() }).subarray(0, archiveWith({ "revexp.xml": validXml() }).byteLength - 22), "ZIP"],
    ["a traversal member", archiveWith({ "../revexp.xml": validXml() }), "traversal"],
    ["a directory member carrying data", archiveWith({ "padding/": new Uint8Array(2_048), "revexp.xml": validXml() }), "directory"],
    ["multiple data members", archiveWith({ "one.xml": validXml(), "two.xml": validXml() }), "exactly one"],
  ])("rejects %s", async (_case, archive, expected) => {
    await expect(selectRevexpMetrics(chunked(archive, 13), targetInns, archiveContext)).rejects.toThrow(expected);
  });

  it("enforces the compressed-byte ceiling as chunks arrive", async () => {
    const archive = archiveWith({ "revexp.xml": validXml() });
    await expect(selectRevexpMetrics(chunked(archive, 3), targetInns, {
      ...archiveContext,
      testLimits: { compressedBytes: archive.byteLength - 1, expandedBytes: 1024 * 1024 },
    })).rejects.toThrow("compressed");
  });

  it("enforces the cumulative expanded-byte ceiling while members expand", async () => {
    const archive = streamingArchiveWith("revexp.xml", new TextEncoder().encode(
      `<?xml version="1.0"?><Файл>${" ".repeat(2_048)}</Файл>`,
    ));
    expect(archive[6]! & 0x08).toBe(0x08);
    await expect(selectRevexpMetrics(chunked(archive, 7), targetInns, {
      ...archiveContext,
      testLimits: { compressedBytes: 1024 * 1024, expandedBytes: 1_024 },
    })).rejects.toThrow("expanded");
  });

  it("bounds decoder output when one caller chunk is a high-ratio data-descriptor ZIP", async () => {
    const archive = streamingArchiveWith("revexp.xml", new TextEncoder().encode(
      `<?xml version="1.0"?><Файл>${" ".repeat(8 * 1024 * 1024)}</Файл>`,
    ));
    let maximumDecoderOutputBytes = 0;
    expect(archive.byteLength).toBeLessThan(10_000);
    expect(archive[6]! & 0x08).toBe(0x08);

    await expect(selectRevexpMetrics(chunked(archive, archive.byteLength), targetInns, {
      ...archiveContext,
      testLimits: { compressedBytes: 1024 * 1024, expandedBytes: 6 * 1024 * 1024 },
      instrumentation: {
        onRecordComplete() {},
        onExpandedChunk(snapshot) {
          maximumDecoderOutputBytes = Math.max(maximumDecoderOutputBytes, snapshot.byteLength);
        },
      },
    })).rejects.toThrow("expanded");
    expect(maximumDecoderOutputBytes).toBeGreaterThan(0);
    expect(maximumDecoderOutputBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it.each([
    ["a zeroed central-directory record", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset, centralSize) => {
      bytes.fill(0, centralOffset, centralOffset + centralSize);
    }), "central-directory record"],
    ["a missing central-directory record", withoutCentralRecord, "central-directory record"],
    ["a forged expanded-size claim", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint32(bytes, centralOffset + 24, 0x7fff_ffff);
    }), "expanded-byte"],
    ["an unsafe central compressed-size claim", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint32(bytes, centralOffset + 20, 0x7fff_ffff);
    }), "compressed-byte"],
    ["an unsafe local expanded-size claim", (archive: Uint8Array) => mutateCentral(archive, (bytes) => {
      writeUint32(bytes, 22, 0x7fff_ffff);
    }), "expanded"],
    ["a forged compressed-size claim", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint32(bytes, centralOffset + 20, readUint32(bytes, centralOffset + 20) + 1);
    }), "compressed size"],
    ["a forged CRC", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint32(bytes, centralOffset + 16, readUint32(bytes, centralOffset + 16) ^ 0xffff_ffff);
    }), "CRC"],
    ["a forged safe member name", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      bytes.set(new TextEncoder().encode("sevexp.xml"), centralOffset + 46);
    }), "name"],
    ["an unsafe central member name", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      bytes.set(new TextEncoder().encode("../bad.xml"), centralOffset + 46);
    }), "traversal"],
    ["an unsafe local member name", (archive: Uint8Array) => mutateCentral(archive, (bytes) => {
      bytes.set(new TextEncoder().encode("../bad.xml"), 30);
    }), "traversal"],
    ["a forged local-header offset", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint32(bytes, centralOffset + 42, 1);
    }), "local-header offset"],
    ["forged central flags", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint16(bytes, centralOffset + 8, readUint16(bytes, centralOffset + 8) ^ 0x0001);
    }), "flags"],
    ["a forged compression method", (archive: Uint8Array) => mutateCentral(archive, (bytes, centralOffset) => {
      writeUint16(bytes, centralOffset + 10, 99);
    }), "compression method"],
    ["a duplicate central-directory record", duplicateCentralRecord, "exactly one"],
    ["trailing data before the central directory", withTrailingByteBeforeCentral, "trailing data"],
  ])("rejects %s", async (_case, mutate, expected) => {
    const archive = mutate(archiveWith({ "revexp.xml": validXml() }));

    await expect(selectRevexpMetrics(chunked(archive, archive.byteLength), targetInns, archiveContext))
      .rejects.toThrow(expected);
  });

  it.each([
    ["CRC", 4],
    ["compressed size", 8],
    ["expanded size", 12],
  ])("rejects a forged data-descriptor %s", async (field, fieldOffset) => {
    const archive = mutateDataDescriptor(
      streamingArchiveWith("revexp.xml", validXml()),
      fieldOffset,
    );

    await expect(selectRevexpMetrics(chunked(archive, archive.byteLength), targetInns, archiveContext))
      .rejects.toThrow(`data-descriptor ${field}`);
  });
});

describe("parseMoneyText", () => {
  it("normalizes a declared comma decimal without numeric conversion", () => {
    expect(parseMoneyText("12,3", "comma")).toBe("12.30");
  });

  it.each(["12,3", "1e3", "-1", "1.234"])("rejects %s outside its declared decimal contract", (value) => {
    expect(() => parseMoneyText(value, "dot")).toThrow("decimal");
  });
});

function archiveWith(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

function streamingArchiveWith(name: string, data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let archiveError: Error | undefined;
  const archive = new Zip((error, bytes) => {
    if (error !== null) archiveError ??= error;
    else chunks.push(bytes.slice());
  });
  const member = new ZipDeflate(name, { level: 6 });
  archive.add(member);
  member.push(data, true);
  archive.end();
  if (archiveError !== undefined) throw archiveError;
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validXml(): Uint8Array {
  return new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8"?><Файл><Документ><СвЮЛ ИННЮЛ="7700000016"/><Показатели СумДоход="1"/></Документ></Файл>',
  );
}

async function* chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}

function mutateCentral(
  archive: Uint8Array,
  mutate: (bytes: Uint8Array, centralOffset: number, centralSize: number, eocdOffset: number) => void,
): Uint8Array {
  const bytes = archive.slice();
  const eocdOffset = findEocd(bytes);
  const centralOffset = readUint32(bytes, eocdOffset + 16);
  const centralSize = readUint32(bytes, eocdOffset + 12);
  mutate(bytes, centralOffset, centralSize, eocdOffset);
  return bytes;
}

function withoutCentralRecord(archive: Uint8Array): Uint8Array {
  const eocdOffset = findEocd(archive);
  const centralOffset = readUint32(archive, eocdOffset + 16);
  const centralSize = readUint32(archive, eocdOffset + 12);
  const bytes = new Uint8Array(archive.byteLength - centralSize);
  bytes.set(archive.subarray(0, centralOffset));
  bytes.set(archive.subarray(eocdOffset), centralOffset);
  writeUint32(bytes, centralOffset + 12, 0);
  return bytes;
}

function duplicateCentralRecord(archive: Uint8Array): Uint8Array {
  const eocdOffset = findEocd(archive);
  const centralOffset = readUint32(archive, eocdOffset + 16);
  const centralSize = readUint32(archive, eocdOffset + 12);
  const bytes = new Uint8Array(archive.byteLength + centralSize);
  bytes.set(archive.subarray(0, eocdOffset), 0);
  bytes.set(archive.subarray(centralOffset, eocdOffset), eocdOffset);
  const newEocdOffset = eocdOffset + centralSize;
  bytes.set(archive.subarray(eocdOffset), newEocdOffset);
  writeUint16(bytes, newEocdOffset + 8, 2);
  writeUint16(bytes, newEocdOffset + 10, 2);
  writeUint32(bytes, newEocdOffset + 12, centralSize * 2);
  return bytes;
}

function withTrailingByteBeforeCentral(archive: Uint8Array): Uint8Array {
  const eocdOffset = findEocd(archive);
  const centralOffset = readUint32(archive, eocdOffset + 16);
  const bytes = new Uint8Array(archive.byteLength + 1);
  bytes.set(archive.subarray(0, centralOffset));
  bytes[centralOffset] = 0;
  bytes.set(archive.subarray(centralOffset), centralOffset + 1);
  writeUint32(bytes, eocdOffset + 1 + 16, centralOffset + 1);
  return bytes;
}

function mutateDataDescriptor(archive: Uint8Array, fieldOffset: number): Uint8Array {
  const bytes = archive.slice();
  const eocdOffset = findEocd(bytes);
  const centralOffset = readUint32(bytes, eocdOffset + 16);
  const descriptorOffset = centralOffset - 16;
  if (readUint32(bytes, descriptorOffset) !== 0x08074b50) {
    throw new Error("test ZIP has no signed data descriptor");
  }
  writeUint32(
    bytes,
    descriptorOffset + fieldOffset,
    readUint32(bytes, descriptorOffset + fieldOffset) ^ 0xffff_ffff,
  );
  return bytes;
}

function findEocd(bytes: Uint8Array): number {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50
      && offset + 22 + readUint16(bytes, offset + 20) === bytes.byteLength) return offset;
  }
  throw new Error("test ZIP has no EOCD");
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

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
