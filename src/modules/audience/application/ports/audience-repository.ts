import type { StoredRawObject } from "./raw-object-storage";
import type { DiscoveredCompany } from "../../domain/discovery";
import type { BrowserActionEvent } from "../../domain/discovery";
import type { FinancialMetricEvidence } from "../../domain/financial";

export type CrawlStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

export interface FencedTask {
  id: string;
  runId: string;
  taskKind: string;
  fencingToken: number;
}

export interface TaskState {
  id: string;
  runId: string;
  taskKind: string;
  status: CrawlStatus;
  resultJson: unknown;
}

export type DiscoveryTaskStart =
  | { state: "acquired"; task: FencedTask }
  | { state: "busy"; taskId: string }
  | { state: "completed"; task: TaskState };

export interface DiscoveryRunInput {
  runId: string;
  scope: {
    okved: string;
    year: number;
    dryRun: boolean;
    maxPages: number;
    maxCompanies: number;
  };
  fixtureVersion: string;
  parserVersion: string;
  leaseSeconds: number;
}

export interface CapturedRawObject {
  id: string;
  sourceKind: string;
  sourceRecordKey: string;
  finalUrl: string;
  navigationStatus: number | null;
  capturedAt: string;
  parserVersion: string;
  stored: StoredRawObject;
}

export interface CompleteDiscoveryInput {
  task: FencedTask;
  status: "succeeded" | "blocked";
  reason: string;
  dryRun: boolean;
  candidates: readonly DiscoveredCompany[];
  rejects?: readonly DiscoveryEvidenceReference[];
  blockers?: readonly DiscoveryEvidenceReference[];
  rawObjects: readonly CapturedRawObject[];
  discovery: DiscoveryAudit;
}

export interface DiscoveryEvidenceReference {
  sourceRecordKey: string;
  reason: string;
  rawFetchKey: string;
  detail?: string;
}

export interface DiscoveryAudit {
  occurrences: number;
  uniqueSourceRecords: number;
  acceptedCompanies: number;
  duplicates: number;
  rejected: number;
}

export interface ReplayInput {
  runId: string;
  status: CrawlStatus;
  terminalReason: string | null;
  candidates: readonly DiscoveredCompany[];
  rawObjects: readonly StoredRawObject[];
}

export interface PublicationCounts {
  companies: number;
  companyOkveds: number;
  runCompanyMatches: number;
}

export interface ReconciliationReport {
  runId: string;
  status: CrawlStatus;
  terminalReason: string | null;
  discovery: DiscoveryAudit;
  tasks: {
    total: number;
    nonTerminal: number;
  };
  financial: {
    revenue: number;
    income: number;
    expenses: number;
  };
  unexplainedSourceFetches: number;
  sourceFetches: number;
  stagedCompanies: number;
  companies: number;
  companyOkveds: number;
  runCompanyMatches: number;
  published: boolean;
  consistent: boolean;
}

export interface FinancialPublicationInput {
  task: FencedTask;
  evidence: readonly FinancialMetricEvidence[];
  rawObjects?: readonly CapturedRawObject[];
}

export interface AudienceRepository {
  startDiscoveryRun(input: DiscoveryRunInput): Promise<DiscoveryTaskStart>;
  createDiscoveryRun(input: DiscoveryRunInput): Promise<FencedTask>;
  prepareTask(taskId: string, runId: string, taskKind: string): Promise<void>;
  createTask(runId: string, taskKind: string, leaseSeconds: number): Promise<FencedTask>;
  acquireTask(taskId: string, leaseSeconds: number): Promise<FencedTask | null>;
  renewTaskLease(task: FencedTask, leaseSeconds: number): Promise<boolean>;
  taskState(taskId: string): Promise<TaskState | null>;
  recordBrowserAction(task: FencedTask, event: BrowserActionEvent): Promise<boolean>;
  completeDiscovery(input: CompleteDiscoveryInput): Promise<boolean>;
  failTask(task: FencedTask, errorCode: string, failRun: boolean): Promise<boolean>;
  loadReplayInput(runId: string): Promise<ReplayInput>;
  publishReplay(
    task: FencedTask,
    candidates: readonly DiscoveredCompany[],
    verifiedRawObjects: number,
  ): Promise<PublicationCounts | null>;
  publishFinancial(input: FinancialPublicationInput): Promise<boolean>;
  reconcile(runId: string): Promise<ReconciliationReport>;
  runStatus(runId: string): Promise<{ status: CrawlStatus; terminalReason: string | null } | null>;
}
