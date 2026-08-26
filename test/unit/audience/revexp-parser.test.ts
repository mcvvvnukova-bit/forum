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
