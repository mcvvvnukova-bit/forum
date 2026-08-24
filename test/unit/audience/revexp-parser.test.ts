import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseMoneyText } from "../../../src/modules/audience/domain/financial";
import { parseRevexp } from "../../../src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser";

const context = {
  reportYear: 2025,
  sourceRecordKey: "7707083893:2025:revexp",
  rawFetchKey: "raw/fns-revexp/7707083893-2025.xml",
  parserVersion: "fns-revexp/1.0.0",
};

describe("parseRevexp", () => {
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

describe("parseMoneyText", () => {
  it("normalizes a declared comma decimal without numeric conversion", () => {
    expect(parseMoneyText("12,3", "comma")).toBe("12.30");
  });

  it.each(["12,3", "1e3", "-1", "1.234"])("rejects %s outside its declared decimal contract", (value) => {
    expect(() => parseMoneyText(value, "dot")).toThrow("decimal");
  });
});
