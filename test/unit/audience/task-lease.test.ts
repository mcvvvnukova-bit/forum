import { describe, expect, it, vi } from "vitest";

import { withRenewingTaskLease } from "../../../src/modules/audience/application/task-lease";

describe("withRenewingTaskLease", () => {
  it("aborts work and propagates a lease-renewal failure", async () => {
    vi.useFakeTimers();
    const renewalFailure = new Error("lease renewal transport failed");
    const repository = {
      renewTaskLease: vi.fn(async () => {
        throw renewalFailure;
      }),
    };
    const task = {
      id: "task-1",
      runId: "run-1",
      taskKind: "fixture_discovery",
      fencingToken: 1,
    };
    let signal: AbortSignal | undefined;

    const result = withRenewingTaskLease(
      repository,
      task,
      { leaseSeconds: 1, renewalIntervalMs: 100 },
      async (workSignal) => {
        signal = workSignal;
        await new Promise((resolve) => workSignal.addEventListener("abort", resolve, { once: true }));
        return "should-not-complete";
      },
    );
    const rejection = expect(result).rejects.toBe(renewalFailure);
    try {
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
