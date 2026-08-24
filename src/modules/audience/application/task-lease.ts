import type { AudienceRepository, FencedTask } from "./ports/audience-repository";
import { StaleTaskError } from "./stale-task-error";

export interface TaskLeaseOptions {
  leaseSeconds: number;
  renewalIntervalMs?: number;
}

export async function withRenewingTaskLease<T>(
  repository: Pick<AudienceRepository, "renewTaskLease">,
  task: FencedTask,
  options: TaskLeaseOptions,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const intervalMs = options.renewalIntervalMs
    ?? Math.max(100, Math.floor(options.leaseSeconds * 1_000 / 3));
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("lease renewal interval must be a positive safe integer");
  }

  const controller = new AbortController();
  let stopped = false;
  let renewal: Promise<void> | null = null;
  const leaseState: {
    lost: boolean;
    failure: { error: unknown } | null;
  } = { lost: false, failure: null };
  const timer = setInterval(() => {
    if (stopped || renewal !== null) return;
    renewal = repository.renewTaskLease(task, options.leaseSeconds)
      .then((renewed) => {
        if (!renewed) {
          leaseState.lost = true;
          controller.abort();
        }
      })
      .catch((error: unknown) => {
        leaseState.failure = { error };
        controller.abort();
      })
      .finally(() => {
        renewal = null;
      });
  }, intervalMs);

  try {
    let workOutcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      workOutcome = { ok: true, value: await work(controller.signal) };
    } catch (error) {
      workOutcome = { ok: false, error };
    }
    while (renewal !== null) await renewal;
    if (leaseState.failure !== null) throw leaseState.failure.error;
    if (leaseState.lost) throw new StaleTaskError(task.id);
    if (!workOutcome.ok) throw workOutcome.error;
    return workOutcome.value;
  } finally {
    stopped = true;
    clearInterval(timer);
    while (renewal !== null) await renewal;
  }
}
