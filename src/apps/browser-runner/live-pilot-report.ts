import type { LivePilotRunResult } from "../../modules/audience/application/run-live-pilot";

/** Safe-by-construction terminal projection: operational identities only. */
export function buildLivePilotReport(input: {
  summary: LivePilotRunResult;
  inns: readonly string[];
  outcomes: number;
  sourceAttempts: readonly ("published" | "no_data")[];
  reconciliation: { companies: number; relations: number; outcomes: number };
  companyMetrics?: readonly ({
    inn: string;
    metric: "revenue" | "income" | "expenses";
    value: string;
    sourceAttemptStatus: "published";
  } | {
    inn: string;
    metric: "revenue" | "income" | "expenses";
    outcome: "no_data";
    sourceAttemptStatus: "no_data";
  })[];
}) {
  return {
    runId: input.summary.runId,
    inns: [...input.inns],
    outcomes: input.outcomes,
    sourceAttempts: [...input.sourceAttempts],
    reconciliation: { ...input.reconciliation },
    companyMetrics: input.companyMetrics === undefined ? [] : input.companyMetrics.map((metric) => ({ ...metric })),
  };
}
