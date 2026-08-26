import type { LivePilotRunResult } from "../../modules/audience/application/run-live-pilot";

/** Safe-by-construction terminal projection: operational identities only. */
export function buildLivePilotReport(input: {
  summary: LivePilotRunResult;
  inns: readonly string[];
  outcomes: number;
  sourceAttempts: readonly ("published" | "no_data")[];
  reconciliation: { companies: number; relations: number; outcomes: number };
}) {
  return {
    runId: input.summary.runId,
    inns: [...input.inns],
    outcomes: input.outcomes,
    sourceAttempts: [...input.sourceAttempts],
    reconciliation: { ...input.reconciliation },
  };
}
