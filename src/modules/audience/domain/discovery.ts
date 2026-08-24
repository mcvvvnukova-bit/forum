import type { LegalEntityInn } from "./inn";
import type { OkvedCode } from "./okved";

export class ExternalBrowserRequestError extends Error {
  readonly origins: readonly string[];

  constructor(origins: readonly string[]) {
    super(`browser request escaped fixture allowlist: ${origins.join(", ")}`);
    this.origins = origins;
  }
}

export type DiscoveryStatus = "succeeded" | "limited" | "blocked";

export interface DiscoveryScope {
  okved: OkvedCode;
  onlyActive: boolean;
  maxPages: number;
  maxCompanies: number;
}

export interface BrowserActionEvent {
  id: string;
  at: string;
  kind: string;
  target: string;
  outcome: "intent" | "completed" | "contract-drift" | "failed";
  navigationStatus: number | null;
}

export interface BrowserActionLedger {
  record(event: BrowserActionEvent): Promise<void>;
}

export interface DiscoveryExecutionContext {
  actionLedger?: BrowserActionLedger;
  signal?: AbortSignal;
}

export interface OrganizationSource {
  collect(scope: DiscoveryScope, execution?: DiscoveryExecutionContext): Promise<DiscoveryResult>;
}

export interface DiscoveredCompany {
  sourceRecordKey: string;
  inn: LegalEntityInn;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  okvedCode: OkvedCode;
  isPrimary: boolean;
  rawFetchKey: string;
  parserVersion: string;
}

export type CandidateContactEvidence =
  | { kind: "null" }
  | { kind: "sha256"; normalizedValueSha256: string };

export interface CandidateEvidence {
  sourceRecordKey: string;
  inn: string;
  name: string;
  website: string | null;
  okvedCode: string;
  isPrimary: boolean;
  phone: CandidateContactEvidence;
  email: CandidateContactEvidence;
}

export interface BrowserRawBundle {
  sourceKind: string;
  parserVersion: string;
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  sanitizedDomUtf8: Uint8Array;
  redactedScreenshotPng: Uint8Array;
  pageFingerprintSha256: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  candidateEvidence: CandidateEvidence | null;
  actions: readonly BrowserActionEvent[];
}

export interface ChecksummedBrowserRawBundle extends BrowserRawBundle {
  checksumSha256: string;
  artifacts: {
    sanitizedDomSha256: string;
    redactedScreenshotSha256: string;
    manifestSha256: string;
  };
  manifestUtf8: Uint8Array;
}

export interface DiscoveryOccurrence {
  sourceRecordKey: string;
  resultFingerprintBefore: string;
  resultFingerprintAfter: string;
}

export interface DiscoveryPage {
  page: number;
  raw: ChecksummedBrowserRawBundle;
  occurrences: readonly DiscoveryOccurrence[];
}

export type DiscoveryRejectReason =
  | "invalid_inn"
  | "ambiguous_okved"
  | "mismatched_okved"
  | "unknown_okved_role";

export interface DiscoveryReject {
  sourceRecordKey: string;
  reason: DiscoveryRejectReason;
  raw: ChecksummedBrowserRawBundle;
}

export interface DiscoveryBlocker {
  reason: string;
  sourceRecordKey?: string;
  detail?: string;
  raw: ChecksummedBrowserRawBundle;
}

export interface DiscoveryResult {
  status: DiscoveryStatus;
  reason: string;
  companies: readonly DiscoveredCompany[];
  pages: readonly DiscoveryPage[];
  rawBundles: readonly ChecksummedBrowserRawBundle[];
  rejects: readonly DiscoveryReject[];
  blockers: readonly DiscoveryBlocker[];
}
