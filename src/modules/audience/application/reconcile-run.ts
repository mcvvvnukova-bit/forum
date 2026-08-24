import type { AudienceRepository, ReconciliationReport } from "./ports/audience-repository";

export function reconcileRun(
  runId: string,
  repository: AudienceRepository,
): Promise<ReconciliationReport> {
  return repository.reconcile(runId);
}
