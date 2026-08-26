import type { LegalEntityInn } from "./inn";
import type { OkvedCode } from "./okved";
import {
  sanitizePolicyViolationIdentifier,
  type TerminalBlockReason,
} from "./terminal-block-reason";

export class ExternalBrowserRequestError extends Error {
  readonly origins: readonly string[];

  constructor(origins: readonly string[]) {
    const sanitized = [...new Set(origins.map(sanitizePolicyViolationIdentifier))].sort();
    super(`browser request escaped fixture allowlist: ${sanitized.join(", ")}`);
    this.origins = sanitized;
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
  sensitiveFormFieldNames?: readonly string[];
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

/** A minimized visible-DOM projection. It deliberately has no screenshot or
 * browser-action fields: absence is part of the checksummed artifact contract. */
export interface ProjectionRawBundle {
  artifactKind: "projection";
  sourceKind: string;
  parserVersion: string;
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  sanitizedDomUtf8: Uint8Array;
  pageFingerprintSha256: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  candidateEvidence: CandidateEvidence | null;
  sensitiveFormFieldNames: readonly string[];
}

export interface ChecksummedProjectionRawBundle extends ProjectionRawBundle {
  checksumSha256: string;
  artifacts: {
    sanitizedProjectionSha256: string;
    manifestSha256: string;
  };
  manifestUtf8: Uint8Array;
}

export type ChecksummedDiscoveryRawBundle =
  | ChecksummedBrowserRawBundle
  | ChecksummedProjectionRawBundle;

export interface DiscoveryOccurrence {
  sourceRecordKey: string;
  resultFingerprintBefore: string;
  resultFingerprintAfter: string;
}

export interface DiscoveryPage {
  page: number;
  raw: ChecksummedDiscoveryRawBundle;
  occurrences: readonly DiscoveryOccurrence[];
  orderedSourceRecordKeys: readonly string[];
  resultFingerprintSha256: string;
}

export type DiscoveryRejectReason =
  | "invalid_inn"
  | "ambiguous_okved"
  | "mismatched_okved"
  | "unknown_okved_role";

export interface DiscoveryReject {
  sourceRecordKey: string;
  reason: DiscoveryRejectReason;
  raw: ChecksummedDiscoveryRawBundle;
}

export interface DiscoveryBlocker {
  reason: TerminalBlockReason;
  sourceRecordKey?: string;
  detail?: string;
  raw: ChecksummedDiscoveryRawBundle;
}

export type DiscoverySkipReason = "individual_entrepreneur" | "duplicate_inn";

export interface DiscoverySkip {
  sourceRecordKey: string;
  reason: DiscoverySkipReason;
  duplicateOfSourceRecordKey?: string;
  raw: ChecksummedDiscoveryRawBundle;
}

export interface DiscoveryResult {
  status: DiscoveryStatus;
  reason: string;
  companies: readonly DiscoveredCompany[];
  pages: readonly DiscoveryPage[];
  rawBundles: readonly ChecksummedDiscoveryRawBundle[];
  rejects: readonly DiscoveryReject[];
  blockers: readonly DiscoveryBlocker[];
  skips?: readonly DiscoverySkip[];
}

export interface BrowserDiscoveryResult extends Omit<
  DiscoveryResult,
  "pages" | "rawBundles" | "rejects" | "blockers" | "skips"
> {
  pages: readonly (Omit<DiscoveryPage, "raw"> & { raw: ChecksummedBrowserRawBundle })[];
  rawBundles: readonly ChecksummedBrowserRawBundle[];
  rejects: readonly (Omit<DiscoveryReject, "raw"> & { raw: ChecksummedBrowserRawBundle })[];
  blockers: readonly (Omit<DiscoveryBlocker, "raw"> & { raw: ChecksummedBrowserRawBundle })[];
  skips?: readonly (Omit<DiscoverySkip, "raw"> & { raw: ChecksummedBrowserRawBundle })[];
}

export interface ProjectionDiscoveryResult extends Omit<
  DiscoveryResult,
  "pages" | "rawBundles" | "rejects" | "blockers" | "skips"
> {
  pages: readonly (Omit<DiscoveryPage, "raw"> & { raw: ChecksummedProjectionRawBundle })[];
  rawBundles: readonly ChecksummedProjectionRawBundle[];
  rejects: readonly (Omit<DiscoveryReject, "raw"> & { raw: ChecksummedProjectionRawBundle })[];
  blockers: readonly (Omit<DiscoveryBlocker, "raw"> & { raw: ChecksummedProjectionRawBundle })[];
  skips: readonly (Omit<DiscoverySkip, "raw"> & { raw: ChecksummedProjectionRawBundle })[];
}
