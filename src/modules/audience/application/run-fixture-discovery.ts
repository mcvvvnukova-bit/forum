import { randomUUID } from "node:crypto";

import type { OrganizationSource } from "../domain/discovery";
import { parseOkvedCode } from "../domain/okved";
import type { AudienceRepository } from "./ports/audience-repository";
import type { RawObjectStorage } from "./ports/raw-object-storage";
import { StaleTaskError } from "./stale-task-error";
import { withRenewingTaskLease } from "./task-lease";

const DISCOVERY_LEASE_SECONDS = 300;

export interface RunFixtureDiscoveryCommand {
  runId: string;
  okved: string;
  year: number;
  dryRun: boolean;
  maxPages: number;
  maxCompanies: number;
  fixtureVersion: string;
  parserVersion: string;
  taskKind?: "fixture_discovery" | "live_discovery";
  onlyActive?: boolean;
  sourceKind?: "list-org-browser" | "list-org-live";
}

export interface RunFixtureDiscoveryDependencies {
  repository: AudienceRepository;
  source: OrganizationSource;
  rawStorage: RawObjectStorage;
  leaseSeconds?: number;
  leaseRenewalIntervalMs?: number;
}

export interface RunSummary {
  runId: string;
  status: "succeeded" | "blocked";
  reason: string;
  discoveredCompanies: number;
  publishedCompanies: number;
  rawObjects: number;
}

export async function runFixtureDiscovery(
  command: RunFixtureDiscoveryCommand,
  dependencies: RunFixtureDiscoveryDependencies,
): Promise<RunSummary> {
  const taskKind = command.taskKind ?? "fixture_discovery";
  const onlyActive = command.onlyActive ?? true;
  const sourceKind = command.sourceKind ?? "list-org-browser";
  const okved = parseOkvedCode(command.okved);
  validateCommand(command);
  const leaseSeconds = dependencies.leaseSeconds ?? DISCOVERY_LEASE_SECONDS;
  const started = await dependencies.repository.startDiscoveryRun({
    runId: command.runId,
    scope: {
      okved,
      year: command.year,
      dryRun: command.dryRun,
      maxPages: command.maxPages,
      maxCompanies: command.maxCompanies,
      onlyActive,
      requiredFinancialMetrics: ["revenue", "income", "expenses"],
    },
    fixtureVersion: command.fixtureVersion,
    parserVersion: command.parserVersion,
    taskKind,
    leaseSeconds,
  });
  if (started.state === "busy") {
    throw new Error("fixture discovery task lease has not expired");
  }
  if (started.state === "completed") {
    return completedDiscoverySummary(started.task.resultJson, command.runId);
  }
  const task = started.task;

  try {
    const { result, rawObjects } = await withRenewingTaskLease(
      dependencies.repository,
      task,
      {
        leaseSeconds,
        renewalIntervalMs: dependencies.leaseRenewalIntervalMs,
      },
      async (signal) => {
        const result = await dependencies.source.collect({
          okved,
          onlyActive,
          maxPages: command.maxPages,
          maxCompanies: command.maxCompanies,
        }, {
          signal,
          actionLedger: {
            record: async (event) => {
              if (!await dependencies.repository.recordBrowserAction(task, event)) {
                throw new StaleTaskError(task.id);
              }
            },
          },
        });
        const rawObjects = [];
        for (const raw of result.rawBundles) {
          if (signal.aborted) throw new StaleTaskError(task.id);
          assertDiscoveryRawIdentity(raw, command.runId, command.parserVersion, sourceKind);
          const stored = await dependencies.rawStorage.put(raw);
          rawObjects.push({
            id: randomUUID(),
            sourceKind,
            sourceRecordKey: raw.identity.sourceRecordKey ?? `page:${raw.identity.page}`,
            mimeType: "application/json",
            finalUrl: raw.finalUrl,
            navigationStatus: raw.navigationStatus,
            capturedAt: raw.capturedAt,
            parserVersion: raw.parserVersion,
            stored,
          });
        }
        return { result, rawObjects };
      },
    );

    const status = result.status === "blocked" ? "blocked" : "succeeded";
    const occurrenceKeys = result.pages.flatMap((page) =>
      page.occurrences.map((occurrence) => occurrence.sourceRecordKey)
    );
    const uniqueSourceRecords = new Set(occurrenceKeys).size;
    const materializedSourceRecords = new Set([
      ...result.companies.map((company) => company.sourceRecordKey),
      ...result.rejects.map((reject) => reject.sourceRecordKey),
    ]);
    const occurrenceSourceRecords = new Set(occurrenceKeys);
    const blockedOrConflicted = new Set(result.blockers.flatMap((blocker) =>
      blocker.reason === "duplicate_conflict"
        && blocker.sourceRecordKey !== undefined
        && occurrenceSourceRecords.has(blocker.sourceRecordKey)
        && !materializedSourceRecords.has(blocker.sourceRecordKey)
        ? [blocker.sourceRecordKey]
        : []
    )).size;
    const completed = await dependencies.repository.completeDiscovery({
      task,
      status,
      reason: result.reason,
      dryRun: command.dryRun,
      candidates: result.companies,
      rejects: result.rejects.map((reject) => ({
        sourceRecordKey: reject.sourceRecordKey,
        reason: reject.reason,
        rawFetchKey: reject.raw.checksumSha256,
      })),
      blockers: result.blockers.map((blocker) => ({
        sourceRecordKey: blocker.sourceRecordKey
          ?? `page:${blocker.raw.identity.page}`,
        reason: blocker.reason,
        rawFetchKey: blocker.raw.checksumSha256,
        ...(blocker.detail === undefined ? {} : { detail: blocker.detail }),
      })),
      rawObjects,
      discovery: {
        occurrences: occurrenceKeys.length,
        uniqueSourceRecords,
        acceptedCompanies: result.companies.length,
        duplicates: occurrenceKeys.length - uniqueSourceRecords,
        rejected: result.rejects.length,
        blockedOrConflicted,
        acceptedSourceRecordKeys: result.companies.map((company) => company.sourceRecordKey),
        pageIdentities: result.pages.map((page) => ({
          page: page.page,
          orderedSourceRecordKeys: [...page.orderedSourceRecordKeys],
          resultFingerprintSha256: page.resultFingerprintSha256,
        })),
      },
    });
    if (!completed) throw new StaleTaskError(task.id);

    return {
      runId: command.runId,
      status,
      reason: result.reason,
      discoveredCompanies: result.companies.length,
      publishedCompanies: 0,
      rawObjects: rawObjects.length,
    };
  } catch (error) {
    if (!(error instanceof StaleTaskError)) {
      await dependencies.repository.failTask(
        task,
        taskKind === "live_discovery" ? "live_discovery_failed" : "fixture_discovery_failed",
        true,
      );
    }
    throw error;
  }
}

function assertDiscoveryRawIdentity(
  raw: Awaited<ReturnType<OrganizationSource["collect"]>>["rawBundles"][number],
  runId: string,
  parserVersion: string,
  sourceKind: "list-org-browser" | "list-org-live",
): void {
  const sourceRecordKey = raw.identity.sourceRecordKey ?? `page:${raw.identity.page}`;
  if (raw.identity.runId !== runId
    || raw.sourceKind !== sourceKind
    || raw.parserVersion !== parserVersion
    || !Number.isSafeInteger(raw.identity.page)
    || raw.identity.page <= 0
    || (raw.candidateEvidence !== null
      && raw.candidateEvidence.sourceRecordKey !== sourceRecordKey)) {
    throw new Error("raw bundle identity does not belong to discovery run");
  }
}

function completedDiscoverySummary(value: unknown, runId: string): RunSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("completed discovery task has no result");
  }
  const summary = (value as Record<string, unknown>).summary;
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    throw new Error("completed discovery task has no summary");
  }
  const record = summary as Record<string, unknown>;
  if (record.runId !== runId
    || (record.status !== "succeeded" && record.status !== "blocked")
    || typeof record.reason !== "string"
    || !Number.isSafeInteger(record.discoveredCompanies)
    || !Number.isSafeInteger(record.publishedCompanies)
    || !Number.isSafeInteger(record.rawObjects)) {
    throw new Error("completed discovery task summary is invalid");
  }
  return {
    runId,
    status: record.status,
    reason: record.reason,
    discoveredCompanies: record.discoveredCompanies as number,
    publishedCompanies: record.publishedCompanies as number,
    rawObjects: record.rawObjects as number,
  };
}

function validateCommand(command: RunFixtureDiscoveryCommand): void {
  if (!isUuid(command.runId)) throw new Error("run id must be a UUID");
  if (!Number.isInteger(command.year) || command.year < 1900 || command.year > 9999) {
    throw new Error("year must be an integer between 1900 and 9999");
  }
  if (!Number.isSafeInteger(command.maxPages) || command.maxPages <= 0
    || !Number.isSafeInteger(command.maxCompanies) || command.maxCompanies <= 0) {
    throw new Error("fixture discovery requires positive bounded limits");
  }
  if (command.fixtureVersion.trim() === "" || command.parserVersion.trim() === "") {
    throw new Error("fixture and parser versions are required");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
