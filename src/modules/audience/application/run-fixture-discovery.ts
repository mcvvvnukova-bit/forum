import { randomUUID } from "node:crypto";

import type { OrganizationSource } from "../domain/discovery";
import { parseOkvedCode } from "../domain/okved";
import type { AudienceRepository } from "./ports/audience-repository";
import type { RawObjectStorage } from "./ports/raw-object-storage";
import { StaleTaskError } from "./stale-task-error";

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
}

export interface RunFixtureDiscoveryDependencies {
  repository: AudienceRepository;
  source: OrganizationSource;
  rawStorage: RawObjectStorage;
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
  const okved = parseOkvedCode(command.okved);
  validateCommand(command);
  const task = await dependencies.repository.createDiscoveryRun({
    runId: command.runId,
    scope: {
      okved,
      year: command.year,
      dryRun: command.dryRun,
      maxPages: command.maxPages,
      maxCompanies: command.maxCompanies,
    },
    fixtureVersion: command.fixtureVersion,
    parserVersion: command.parserVersion,
    leaseSeconds: DISCOVERY_LEASE_SECONDS,
  });

  try {
    const result = await dependencies.source.collect({
      okved,
      onlyActive: true,
      maxPages: command.maxPages,
      maxCompanies: command.maxCompanies,
    });
    const rawObjects = [];
    for (const raw of result.rawBundles) {
      const stored = await dependencies.rawStorage.put(raw);
      rawObjects.push({
        id: randomUUID(),
        sourceKind: "list-org-browser",
        sourceRecordKey: raw.identity.sourceRecordKey ?? `page:${raw.identity.page}`,
        finalUrl: raw.finalUrl,
        navigationStatus: raw.navigationStatus,
        capturedAt: raw.capturedAt,
        parserVersion: raw.parserVersion,
        stored,
      });
    }

    const status = result.status === "blocked" ? "blocked" : "succeeded";
    const occurrenceKeys = result.pages.flatMap((page) =>
      page.occurrences.map((occurrence) => occurrence.sourceRecordKey)
    );
    const uniqueSourceRecords = new Set(occurrenceKeys).size;
    const completed = await dependencies.repository.completeDiscovery({
      task,
      status,
      reason: result.reason,
      dryRun: command.dryRun,
      candidates: result.companies,
      rawObjects,
      discovery: {
        occurrences: occurrenceKeys.length,
        uniqueSourceRecords,
        acceptedCompanies: result.companies.length,
        duplicates: occurrenceKeys.length - uniqueSourceRecords,
        rejected: 0,
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
      await dependencies.repository.failTask(task, "fixture_discovery_failed", true);
    }
    throw error;
  }
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
