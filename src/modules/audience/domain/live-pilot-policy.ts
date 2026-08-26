import { createHash } from "node:crypto";

const reviewedPolicy = {
  version: 1,
  scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26",
  owner: "Veronica — АСТ Форум repository operator",
  authorization: {
    reviewedAt: "2026-08-26",
    consumedAt: "2026-08-26",
    status: "consumed",
  },
  command: {
    kind: "live-pilot",
    okved: "43.11",
    year: 2025,
    maxCompanies: 10,
  },
  runScope: {
    okved: "43.11",
    year: 2025,
    dryRun: true,
    maxPages: 2,
    maxCompanies: 10,
    onlyActive: false,
    requiredFinancialMetrics: ["revenue", "income", "expenses"],
  },
  origins: [
    "https://www.list-org.com",
    "https://bo.nalog.gov.ru",
    "https://www.nalog.gov.ru",
    "https://file.nalog.ru",
  ],
  routes: [
    "https://www.list-org.com/search",
    "https://www.list-org.com/company/<visible-id>",
    "https://bo.nalog.gov.ru/",
    "BFO exact visible same-origin GET form/link destination (one-shot)",
    "https://www.nalog.gov.ru/opendata/7707329152-revexp/",
    "https://file.nalog.ru/opendata/7707329152-revexp/<validated-2025-archive>.zip",
  ],
  actions: [
    "two List-Org result pages",
    "twelve sequential organization-card inspections",
    "ten sequential BFO 2025 report inspections",
    "one revexp metadata resolution and one archive download",
  ],
  limits: {
    listOrgPages: 2,
    sourceOccurrences: 12,
    acceptedCompanies: 10,
    concurrentBrowserRequests: 1,
    concurrentArchiveRequests: 1,
    compressedArchiveBytes: 268_435_456,
    expandedArchiveBytes: 1_073_741_824,
  },
  retention: "immutable minimized raw evidence; no screenshots, action traces, CAPTCHA, cookies, or session material",
} as const;

const canonicalPolicy = JSON.stringify(reviewedPolicy);

export const LIVE_PILOT_POLICY = Object.freeze({
  ...reviewedPolicy,
  checksumSha256: createHash("sha256").update(canonicalPolicy).digest("hex"),
});

export type LivePilotCommandContract = typeof LIVE_PILOT_POLICY.command;
