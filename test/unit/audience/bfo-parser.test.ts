import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseLegalEntityInn } from "../../../src/modules/audience/domain/inn";
import { parseBfo } from "../../../src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser";

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
