import type { LegalEntityInn } from "./inn";
import type { OkvedCode } from "./okved";

export type DiscoveryStatus = "succeeded" | "limited" | "blocked";

export interface DiscoveryScope {
  okved: OkvedCode;
  onlyActive: boolean;
  maxPages: number;
  maxCompanies: number;
}

export interface OrganizationSource {
  collect(scope: DiscoveryScope): Promise<DiscoveryResult>;
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
}

export interface BrowserRawBundle {
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  sanitizedDomUtf8: Uint8Array;
  redactedScreenshotPng: Uint8Array;
  pageFingerprintSha256: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  actions: readonly { at: string; kind: string; target: string; outcome: string }[];
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

export interface DiscoveryResult {
  status: DiscoveryStatus;
  reason: string;
  companies: readonly DiscoveredCompany[];
  pages: readonly DiscoveryPage[];
  rawBundles: readonly ChecksummedBrowserRawBundle[];
}
