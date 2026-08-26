import type { FinancialMetricEvidence } from "../domain/financial";
import type {
  AudienceRepository,
  CapturedRawObject,
  FencedTask,
  FinancialMetricOutcomes,
} from "./ports/audience-repository";
import { StaleTaskError } from "./stale-task-error";
import { parseLegalEntityInn } from "../domain/inn";

const FINANCIAL_LEASE_SECONDS = 300;

export interface PublishFinancialEvidenceCommand {
  runId: string;
  reportYear: number;
  evidence: readonly FinancialMetricEvidence[];
  metricOutcomes: FinancialMetricOutcomes;
  rawObjects?: readonly CapturedRawObject[];
  taskKind?: "fixture_finance" | "live_finance";
  companyInn?: string;
  task?: FencedTask;
}

export interface PublishFinancialEvidenceDependencies {
  repository: AudienceRepository;
}

export async function assertFinancialRunScopeYear(
  runId: string,
  requestedYear: number,
  repository: AudienceRepository,
): Promise<void> {
  if (!Number.isSafeInteger(requestedYear) || requestedYear < 1900 || requestedYear > 9999) {
    throw new Error("financial report year is invalid");
  }
  const runScopeYear = await repository.loadRunScopeYear(runId);
  if (runScopeYear !== requestedYear) {
    throw new Error("financial evidence report year does not match immutable run scope");
  }
}

export async function publishFinancialEvidence(
  command: PublishFinancialEvidenceCommand,
  dependencies: PublishFinancialEvidenceDependencies,
): Promise<void> {
  const taskKind = command.taskKind ?? "fixture_finance";
  if (taskKind === "live_finance") {
    if (command.companyInn === undefined) throw new Error("live finance task requires a company INN");
    parseLegalEntityInn(command.companyInn);
    if (command.evidence.some((evidence) => evidence.inn !== command.companyInn)) {
      throw new Error("live finance evidence belongs to another company");
    }
    assertLiveCompanyFinancialProvenance(command.companyInn, command.evidence, command.metricOutcomes);
  } else if (command.companyInn !== undefined) {
    throw new Error("fixture finance task cannot own a company INN");
  }
  if (command.evidence.some((evidence) => evidence.reportYear !== command.reportYear)) {
    throw new Error("financial evidence report year does not match immutable run scope");
  }
  await assertFinancialRunScopeYear(
    command.runId,
    command.reportYear,
    dependencies.repository,
  );
  const task = command.task ?? await dependencies.repository.createTask(
    command.runId, taskKind, FINANCIAL_LEASE_SECONDS,
  );
  if (task.runId !== command.runId || task.taskKind !== taskKind) {
    throw new Error("financial task identity does not match command");
  }
  try {
    const published = await dependencies.repository.publishFinancial({
      task,
      reportYear: command.reportYear,
      evidence: command.evidence,
      metricOutcomes: command.metricOutcomes,
      rawObjects: command.rawObjects,
      ...(command.companyInn === undefined ? {} : { companyInn: command.companyInn }),
    });
    if (!published) throw new StaleTaskError(task.id);
  } catch (error) {
    if (!(error instanceof StaleTaskError)) {
      await dependencies.repository.failTask(
        task,
        taskKind === "live_finance" ? "live_finance_failed" : "fixture_finance_failed",
        true,
      );
    }
    throw error;
  }
}

function assertLiveCompanyFinancialProvenance(
  companyInn: string,
  evidence: readonly FinancialMetricEvidence[],
  outcomes: FinancialMetricOutcomes,
): void {
  for (const item of evidence) {
    if (item.metric !== "revenue") continue;
    if (item.rawSourceKind !== "fns-bfo-live"
      || !new RegExp(`^${companyInn}:2025:0710002:`).test(item.sourceRecordKey)) {
      throw new Error("live revenue evidence does not match owned company");
    }
  }
  const revenue = outcomes.revenue;
  if (revenue?.outcome === "no_data"
    && (revenue.sourceAttempt.rawSourceKind !== "fns-bfo-live"
      || !new RegExp(`^${companyInn}:2025:0710002:`).test(revenue.sourceAttempt.sourceRecordKey))) {
    throw new Error("live revenue source attempt does not match owned company");
  }
}
