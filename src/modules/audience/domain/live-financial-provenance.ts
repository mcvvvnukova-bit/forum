import type { FinancialMetric } from "./financial";

const BFO_REPORT_FORM = "0710002";
const REVEXP_DATASET_ID = "7707329152-revexp";

interface FinancialSourceIdentity {
  readonly rawSourceKind: string;
  readonly sourceRecordKey: string;
}

export function isExactLiveFinancialEvidenceIdentity(
  companyInn: string,
  reportYear: number,
  metric: FinancialMetric,
  identity: FinancialSourceIdentity,
): boolean {
  if (metric === "revenue") {
    return isExactLiveBfoIdentity(companyInn, reportYear, identity);
  }
  return identity.rawSourceKind === "fns-revexp"
    && identity.sourceRecordKey === `${companyInn}:${reportYear}:revexp`;
}

export function isExactLiveFinancialAttemptIdentity(
  companyInn: string,
  reportYear: number,
  metric: FinancialMetric,
  identity: FinancialSourceIdentity,
): boolean {
  if (metric === "revenue") {
    return isExactLiveBfoIdentity(companyInn, reportYear, identity);
  }
  return identity.rawSourceKind === "fns-revexp"
    && identity.sourceRecordKey === liveRevexpRawSourceRecordKey(reportYear);
}

export function expectedLiveFinancialRawSourceRecordKey(
  reportYear: number,
  metric: FinancialMetric,
  evidenceSourceRecordKey: string,
): string {
  return metric === "revenue"
    ? evidenceSourceRecordKey
    : liveRevexpRawSourceRecordKey(reportYear);
}

function isExactLiveBfoIdentity(
  companyInn: string,
  reportYear: number,
  identity: FinancialSourceIdentity,
): boolean {
  const [inn, year, form, statement, ...unexpected] = identity.sourceRecordKey.split(":");
  return identity.rawSourceKind === "fns-bfo-live"
    && inn === companyInn
    && year === String(reportYear)
    && form === BFO_REPORT_FORM
    && statement !== undefined
    && statement.trim() !== ""
    && unexpected.length === 0;
}

function liveRevexpRawSourceRecordKey(reportYear: number): string {
  return `${REVEXP_DATASET_ID}:${reportYear}`;
}
