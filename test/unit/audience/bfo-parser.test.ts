import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import {
  parseBfo,
  parseBfoVisibleReport,
} from "../../../src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser";

const context = {
  inn: parseLegalEntityInn("7707083893"),
  reportYear: 2025,
  rawFetchKey: "raw/fns-bfo/7707083893-2025.json",
  parserVersion: "fns-bfo/1.0.0",
};

describe("parseBfo", () => {
  it("selects the newest correction and retains revenue evidence provenance", async () => {
    const report = await readFile(new URL("../../fixtures/fns-bfo/report-0710002.json", import.meta.url));

    expect(parseBfo(report, context)).toEqual({
      inn: "7707083893",
      reportYear: 2025,
      revenue: "125000.00",
      evidence: [
        {
          inn: "7707083893",
          reportYear: 2025,
          metric: "revenue",
          value: "125000.00",
          sourceKind: "fns_bfo",
          sourceRecordKey: "7707083893:2025:0710002:2",
          observedAt: "2026-04-01T09:00:00.000Z",
          rawFetchKey: "raw/fns-bfo/7707083893-2025.json",
          parserVersion: "fns-bfo/1.0.0",
        },
      ],
    });
  });

  it("orders correction timestamps by instant instead of their ISO offset text", () => {
    const report = fixture([
      {
        correctedAt: "2026-04-01T10:00:00+01:00",
        sourceRecordKey: "7707083893:2025:0710002:offset-0900z",
        lines: { "2110": "100" },
      },
      {
        correctedAt: "2026-04-01T09:30:00Z",
        sourceRecordKey: "7707083893:2025:0710002:utc-0930z",
        lines: { "2110": "200" },
      },
    ]);

    expect(parseBfo(report, context)).toMatchObject({
      revenue: "200.00",
      evidence: [{ sourceRecordKey: "7707083893:2025:0710002:utc-0930z" }],
    });
  });

  it("does not substitute a neighboring BFO line when line 2110 is absent", () => {
    const report = fixture([{ lines: { "2111": "999999" } }]);

    expect(parseBfo(report, context)).toEqual({
      inn: "7707083893",
      reportYear: 2025,
      revenue: null,
      evidence: [],
    });
  });

  it("retains literal revenue zero as evidence", () => {
    const report = fixture([{ lines: { "2110": "0" } }]);

    expect(parseBfo(report, context).evidence.map((item) => item.value)).toEqual(["0.00"]);
  });

  it("selects the requested report year when the fixture also carries prior-year history", () => {
    const report = fixture([
      { reportYear: 2024, lines: { "2110": "999999" } },
      { lines: { "2110": "125000" } },
    ]);

    expect(parseBfo(report, context).revenue).toBe("125000.00");
  });

  it.each([
    ["a wrong form", { form: "0710001" }, "form"],
    ["a wrong year", { reportYear: 2024 }, "year"],
    ["an incompatible unit", { unit: "THOUSAND_RUB" }, "unit"],
    ["an exponent amount", { lines: { "2110": "1e3" } }, "decimal"],
  ])("rejects %s", (_case, overrides, expectedMessage) => {
    expect(() => parseBfo(fixture([overrides]), context)).toThrow(expectedMessage);
  });
});

describe("parseBfoVisibleReport", () => {
  const visibleContext = {
    ...context,
    sourceRecordKey: "7707083893:2025:0710002:visible",
    observedAt: "2026-08-26T12:00:00.000Z",
  };

  it("converts the exact localized thousand-ruble line 2110 with BigInt precision", () => {
    expect(parseBfoVisibleReport(visibleReport({
      rows: [
        ["Прочие доходы", "2340", "999 999"],
        ["Выручка", "2110", "1 654 023"],
        ["Себестоимость продаж", "2120", "987 654"],
      ],
    }), visibleContext)).toEqual({
      inn: "7707083893",
      reportYear: 2025,
      revenue: "1654023000.00",
      evidence: [{
        inn: "7707083893",
        reportYear: 2025,
        metric: "revenue",
        value: "1654023000.00",
        sourceKind: "fns_bfo",
        sourceRecordKey: "7707083893:2025:0710002:visible",
        observedAt: "2026-08-26T12:00:00.000Z",
        rawFetchKey: "raw/fns-bfo/7707083893-2025.json",
        parserVersion: "fns-bfo/1.0.0",
      }],
    });
  });

  it("returns absence only when the matching visible form has no line 2110", () => {
    expect(parseBfoVisibleReport(visibleReport({
      rows: [["Себестоимость продаж", "2120", "999 999"]],
    }), visibleContext)).toEqual({
      inn: "7707083893",
      reportYear: 2025,
      revenue: null,
      evidence: [],
    });
  });

  it("accepts only exact positive restricted or unavailable report markers as absence", () => {
    expect(parseBfoVisibleReport(visibleReport({ restricted: true }), visibleContext)).toEqual({
      inn: "7707083893",
      reportYear: 2025,
      revenue: null,
      evidence: [],
    });
    expect(parseBfoVisibleReport(visibleReport({ unavailable: true }), visibleContext).revenue)
      .toBeNull();
    expect(() => parseBfoVisibleReport(visibleReport({ omitForm: true }), visibleContext))
      .toThrow("form");
  });

  it("rejects conflicting restricted and unavailable report markers", () => {
    expect(() => parseBfoVisibleReport(visibleReport({ restricted: true, unavailable: true }), visibleContext))
      .toThrow("conflicting");
  });

  it.each([
    ["a wrong INN", { inn: "7700000016" }, "INN"],
    ["a wrong report year", { reportYear: 2024 }, "year"],
    ["a wrong form", { form: "0710001" }, "form"],
    ["a wrong unit", { unit: "Ед. измерения: ₽" }, "unit"],
  ] as const)("rejects %s", (_case, overrides, expectedMessage) => {
    expect(() => parseBfoVisibleReport(visibleReport(overrides), visibleContext))
      .toThrow(expectedMessage);
  });

  it("rejects duplicate or conflicting visible line 2110 rows", () => {
    expect(() => parseBfoVisibleReport(visibleReport({
      rows: [
        ["Выручка", "2110", "1 654 023"],
        ["Выручка", "2110", "1 654 024"],
      ],
    }), visibleContext)).toThrow(/duplicate|conflicting/u);
  });

  it.each([
    ["decimal comma", "1 654 023,5"],
    ["decimal dot", "1 654 023.5"],
    ["narrow no-break spaces", "1\u202f654\u202f023"],
    ["no-break spaces", "1\u00a0654\u00a0023"],
    ["malformed grouping", "16 54 023"],
    ["underscore separators", "1_654_023"],
    ["negative sign", "-1"],
    ["numeric(18,2) overflow after scaling", "10 000 000 000 000"],
  ])("rejects %s", (_case, amount) => {
    expect(() => parseBfoVisibleReport(visibleReport({
      rows: [["Выручка", "2110", amount]],
    }), visibleContext)).toThrow(/integer|separator|numeric/u);
  });

  it("accepts the largest thousand-ruble integer that fits numeric(18,2)", () => {
    expect(parseBfoVisibleReport(visibleReport({
      rows: [["Выручка", "2110", "9 999 999 999 999"]],
    }), visibleContext).revenue).toBe("9999999999999000.00");
  });

  it("rejects malformed UTF-8 and an invalid observation timestamp", () => {
    expect(() => parseBfoVisibleReport(new Uint8Array([0xff]), visibleContext)).toThrow("UTF-8");
    expect(() => parseBfoVisibleReport(visibleReport({}), {
      ...visibleContext,
      observedAt: "not-a-timestamp",
    })).toThrow("timestamp");
  });

  it("rejects a forged legal-entity INN brand with an invalid checksum", () => {
    expect(() => parseBfoVisibleReport(visibleReport({}), {
      ...visibleContext,
      inn: "7707083894" as typeof visibleContext.inn,
    })).toThrow("checksum");
  });

  it("rejects a non-2025 parser scope even when the page heading matches it", () => {
    expect(() => parseBfoVisibleReport(visibleReport({ reportYear: 2024 }), {
      ...visibleContext,
      reportYear: 2024,
    })).toThrow("2025");
  });
});

function fixture(overrides: readonly Record<string, unknown>[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    fixtureContract: "fns-bfo/1.0",
    reports: overrides.map((override, index) => ({
      inn: "7707083893",
      form: "0710002",
      reportYear: 2025,
      unit: "RUB",
      correctedAt: `2026-04-0${index + 1}T09:00:00.000Z`,
      sourceRecordKey: `7707083893:2025:0710002:${index + 1}`,
      lines: { "2110": "125000" },
      ...override,
    })),
  }));
}

function visibleReport(options: {
  inn?: string;
  reportYear?: number;
  form?: string;
  unit?: string;
  rows?: readonly (readonly [string, string, string])[];
  restricted?: boolean;
  unavailable?: boolean;
  omitForm?: boolean;
}): Uint8Array {
  const inn = options.inn ?? "7707083893";
  const reportYear = options.reportYear ?? 2025;
  const form = options.form ?? "0710002";
  const unit = options.unit ?? "Ед. измерения: тыс. ₽";
  const rows = options.rows ?? [["Выручка", "2110", "1 654 023"]];
  const body = options.restricted === true
    ? `<p>Доступ к отчетности ограничен</p>${options.unavailable === true
      ? `<p>Отчетность за ${reportYear} год отсутствует</p>`
      : ""}`
    : options.unavailable === true
      ? `<p>Отчетность за ${reportYear} год отсутствует</p>`
    : options.omitForm === true
      ? "<p>Нет данных</p>"
      : `<h2>Форма по ОКУД ${form}</h2><p>${unit}</p><table><tbody>${rows.map(([label, code, amount]) =>
        `<tr><td>${label}</td><td>${code}</td><td>${amount}</td></tr>`
      ).join("")}</tbody></table>`;
  return new TextEncoder().encode(
    `<!doctype html><html><body><main><h1>Отчетность за ${reportYear} год</h1><dl><dt>ИНН</dt><dd>${inn}</dd></dl>${body}</main></body></html>`,
  );
}
