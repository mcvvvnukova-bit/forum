import type { LegalEntityInn } from "./inn";

declare const moneyTextBrand: unique symbol;

export type FinancialMetric = "revenue" | "income" | "expenses";
export type MoneyText = string & { readonly [moneyTextBrand]: true };
export type MoneyFormat = "dot" | "comma";

export interface FinancialMetricEvidence {
  inn: LegalEntityInn;
  reportYear: number;
  metric: FinancialMetric;
  value: MoneyText;
  sourceKind: "fns_bfo" | "fns_revexp";
  sourceRecordKey: string;
  rawFetchKey: string;
  parserVersion: string;
}

export function parseMoneyText(value: string, format: MoneyFormat): MoneyText {
  const separator = format === "comma" ? "," : ".";
  const decimal = new RegExp(`^(\\d+)(?:\\${separator}(\\d{1,2}))?$`).exec(value);

  if (decimal === null) {
    throw new Error("money value must be a non-negative decimal with at most two fraction digits");
  }

  const integer = decimal[1].replace(/^0+(?=\d)/, "");
  const fraction = (decimal[2] ?? "").padEnd(2, "0");

  return `${integer}.${fraction}` as MoneyText;
}
