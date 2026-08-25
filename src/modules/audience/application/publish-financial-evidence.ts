import type { FinancialMetricEvidence } from "../domain/financial";
import type { AudienceRepository, CapturedRawObject } from "./ports/audience-repository";
import { StaleTaskError } from "./stale-task-error";

const FINANCIAL_LEASE_SECONDS = 300;

export interface PublishFinancialEvidenceCommand {
  runId: string;
  evidence: readonly FinancialMetricEvidence[];
  rawObjects?: readonly CapturedRawObject[];
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
  if (command.evidence.length === 0) throw new Error("financial evidence is required");
  const reportYear = command.evidence[0]!.reportYear;
  if (command.evidence.some((evidence) => evidence.reportYear !== reportYear)) {
    throw new Error("financial evidence report year does not match immutable run scope");
  }
  await assertFinancialRunScopeYear(command.runId, reportYear, dependencies.repository);
  const task = await dependencies.repository.createTask(
    command.runId,
    "fixture_finance",
    FINANCIAL_LEASE_SECONDS,
  );
  try {
    const published = await dependencies.repository.publishFinancial({
      task,
      evidence: command.evidence,
      rawObjects: command.rawObjects,
    });
    if (!published) throw new StaleTaskError(task.id);
  } catch (error) {
    if (!(error instanceof StaleTaskError)) {
      await dependencies.repository.failTask(task, "fixture_finance_failed", true);
    }
    throw error;
  }
}
