import type { AudienceRepository, ReconciliationReport } from "./ports/audience-repository";

export function reconcileRun(
  runId: string,
  repository: AudienceRepository,
): Promise<ReconciliationReport> {
  return repository.reconcile(runId);
}

/** Names the bounded orchestration reconciliation boundary at its caller. */
export async function reconcileLivePilotRun(
  runId: string,
  repository: AudienceRepository,
): Promise<ReconciliationReport> {
  return reconcileRun(runId, repository);
}
