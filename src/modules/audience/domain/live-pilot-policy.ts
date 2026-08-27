import { createHash } from "node:crypto";

export interface LivePilotPolicyDocument {
  readonly version: number;
  readonly scopeKey: string;
  readonly owner: string;
  readonly authorization: LivePilotAuthorization;
  readonly command: {
    readonly kind: "live-pilot";
    readonly okved: string;
    readonly year: number;
    readonly maxCompanies: number;
  };
  readonly runScope: {
    readonly okved: string;
    readonly year: number;
    readonly dryRun: boolean;
    readonly maxPages: number;
    readonly maxCompanies: number;
    readonly onlyActive: boolean;
    readonly requiredFinancialMetrics: readonly ("revenue" | "income" | "expenses")[];
  };
  readonly origins: readonly string[];
  readonly routes: readonly string[];
  readonly actions: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly retention: string;
}

export interface LivePilotPolicy extends LivePilotPolicyDocument {
  readonly checksumSha256: string;
}

export type LivePilotAuthorization = LivePilotActiveAuthorization | LivePilotConsumedAuthorization;

export interface LivePilotActiveAuthorization {
  readonly reviewedAt: string;
  readonly expiresAt: string;
  readonly status: "active";
}

export interface LivePilotConsumedAuthorization {
  readonly reviewedAt: string;
  readonly expiresAt?: string;
  readonly consumedAt: string;
  readonly status: "consumed";
}

const reviewedPolicyV1Consumed = {
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
} as const satisfies LivePilotPolicyDocument;

const sharedPilotContract = {
  command: reviewedPolicyV1Consumed.command,
  runScope: reviewedPolicyV1Consumed.runScope,
  origins: reviewedPolicyV1Consumed.origins,
  routes: reviewedPolicyV1Consumed.routes,
  actions: reviewedPolicyV1Consumed.actions,
  limits: reviewedPolicyV1Consumed.limits,
  retention: reviewedPolicyV1Consumed.retention,
} as const;

const reviewedPolicyV2Active = {
  ...sharedPilotContract,
  version: 2,
  scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
  owner: "Veronica — АСТ Форум repository operator",
  authorization: {
    reviewedAt: "2026-08-27T09:40:50+03:00",
    expiresAt: "2026-08-27T21:40:50+03:00",
    status: "active",
  },
} as const satisfies LivePilotPolicyDocument;

const reviewedPolicyV2Consumed = {
  ...reviewedPolicyV2Active,
  authorization: {
    ...reviewedPolicyV2Active.authorization,
    consumedAt: "2026-08-27T08:39:58Z",
    status: "consumed",
  },
} as const satisfies LivePilotPolicyDocument;

export const LIVE_PILOT_POLICY_V1 = bindLivePilotPolicy(reviewedPolicyV1Consumed);
export const LIVE_PILOT_POLICY_V2_ACTIVE = bindLivePilotPolicy(reviewedPolicyV2Active);
export const LIVE_PILOT_POLICY_HISTORY = Object.freeze([
  LIVE_PILOT_POLICY_V1,
  LIVE_PILOT_POLICY_V2_ACTIVE,
] as const);
export const LIVE_PILOT_POLICY = bindLivePilotPolicy(reviewedPolicyV2Consumed);

export type LivePilotCommandContract = typeof LIVE_PILOT_POLICY.command;

export function checksumLivePilotPolicy(policy: LivePilotPolicyDocument): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function assertLivePilotPolicyChecksum(policy: LivePilotPolicy): void {
  const { checksumSha256, ...document } = policy;
  if (!/^[0-9a-f]{64}$/u.test(checksumSha256)
    || checksumLivePilotPolicy(document) !== checksumSha256) {
    throw new Error("LIVE_PILOT_POLICY_CHECKSUM_MISMATCH");
  }
}

export function assertLivePilotPolicyActive(policy: LivePilotPolicy, now: Date = new Date()): void {
  assertLivePilotPolicyChecksum(policy);
  if (policy.authorization.status !== "active") {
    throw new Error("LIVE_PILOT_AUTHORIZATION_CONSUMED");
  }
  if (!isCanonicalRfc3339Instant(policy.authorization.reviewedAt)
    || !isCanonicalRfc3339Instant(policy.authorization.expiresAt)) {
    throw new Error("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  }
  const expiry = Date.parse(policy.authorization.expiresAt);
  const currentTime = now.getTime();
  if (!Number.isFinite(currentTime) || currentTime > expiry) {
    throw new Error("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  }
}

function bindLivePilotPolicy(document: LivePilotPolicyDocument): LivePilotPolicy {
  return deepFreezePolicyGraph({
    ...document,
    checksumSha256: checksumLivePilotPolicy(document),
  });
}

function deepFreezePolicyGraph<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreezePolicyGraph(nested, seen);
  }
  return Object.freeze(value);
}

function isCanonicalRfc3339Instant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;

  const [, year, month, day, hour, minute, second] = match;
  const calendarYear = Number(year);
  const calendarMonth = Number(month);
  const calendarDay = Number(day);
  const calendarHour = Number(hour);
  const calendarMinute = Number(minute);
  const calendarSecond = Number(second);
  const calendar = new Date(Date.UTC(calendarYear, calendarMonth - 1, calendarDay));

  return calendar.getUTCFullYear() === calendarYear
    && calendar.getUTCMonth() === calendarMonth - 1
    && calendar.getUTCDate() === calendarDay
    && calendarHour <= 23
    && calendarMinute <= 59
    && calendarSecond <= 59
    && Number.isFinite(Date.parse(value));
}
