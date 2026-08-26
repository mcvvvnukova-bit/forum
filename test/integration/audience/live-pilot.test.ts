import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runLivePilot } from "../../../src/modules/audience/application/run-live-pilot";

describe("bounded live pilot orchestration", () => {
  it("keeps fewer than ten accepted legal entities evidence-only and never replays", async () => {
    let replayed = false;

    const result = await runLivePilot({
      runId: randomUUID(),
      okved: "43.11",
      year: 2025,
      maxCompanies: 10,
    }, {
      discover: async () => ({
        status: "succeeded" as const,
        discoveredCompanies: 9,
        rawObjects: 9,
      }),
      replay: async () => { replayed = true; },
      finance: async () => { throw new Error("finance must not start"); },
      reconcile: async () => { throw new Error("reconciliation must not start"); },
    });

    expect(result).toMatchObject({
      publishedCompanies: 0,
      discoveredCompanies: 9,
      terminalCode: "LIVE_PILOT_DISCOVERY_INCOMPLETE",
    });
    expect(replayed).toBe(false);
  });
});
