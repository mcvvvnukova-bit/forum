import type { FinancialMetricEvidence } from "../domain/financial";
import type {
  AudienceRepository,
  CapturedRawObject,
  FencedTask,
  FinancialMetricOutcomes,
} from "./ports/audience-repository";
import { StaleTaskError } from "./stale-task-error";
import { parseLegalEntityInn } from "../domain/inn";
import {
  isExactLiveFinancialAttemptIdentity,
  isExactLiveFinancialEvidenceIdentity,
} from "../domain/live-financial-provenance";

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
    assertLiveCompanyFinancialProvenance(
      command.companyInn,
      command.reportYear,
      command.evidence,
      command.metricOutcomes,
    );
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
  const task = command.task ?? await createFinancialTask(
    dependencies.repository,
    command.runId,
    taskKind,
    command.companyInn,
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

async function createFinancialTask(
  repository: AudienceRepository,
  runId: string,
  taskKind: "fixture_finance" | "live_finance",
  companyInn: string | undefined,
): Promise<FencedTask> {
  if (taskKind === "fixture_finance") {
    return repository.createTask(runId, taskKind, FINANCIAL_LEASE_SECONDS);
  }
  if (companyInn === undefined) throw new Error("live finance task requires a company INN");
  const prepared = await repository.prepareLiveFinanceTask(runId, companyInn);
  const task = await repository.acquireTask(prepared.id, FINANCIAL_LEASE_SECONDS);
  if (task === null) throw new Error("prepared live finance task could not be acquired");
  return task;
}

function assertLiveCompanyFinancialProvenance(
  companyInn: string,
  reportYear: number,
  evidence: readonly FinancialMetricEvidence[],
  outcomes: FinancialMetricOutcomes,
): void {
  for (const item of evidence) {
    if (!isExactLiveFinancialEvidenceIdentity(companyInn, reportYear, item.metric, item)) {
      throw new Error(`live ${item.metric} evidence does not match owned company`);
    }
  }
  for (const metric of ["revenue", "income", "expenses"] as const) {
    const outcome = outcomes[metric];
    if (outcome?.outcome === "no_data"
      && !isExactLiveFinancialAttemptIdentity(
        companyInn,
        reportYear,
        metric,
        outcome.sourceAttempt,
      )) {
      throw new Error(`live ${metric} source attempt does not match owned company`);
    }
  }
}
