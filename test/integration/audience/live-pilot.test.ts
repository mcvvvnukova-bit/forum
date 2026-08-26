import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runLivePilot } from "../../../src/modules/audience/application/run-live-pilot";
import { executeInjectedLivePilot } from "../../../src/apps/browser-runner/run-live-pilot";

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

  it("runs the exact injected-local CLI flow sequentially and emits only sanitized report fields", async () => {
    const commands: string[] = [];
    const result = await executeInjectedLivePilot(
      ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10"],
      {
        discover: async () => ({ status: "succeeded" as const, discoveredCompanies: 10, rawObjects: 12 }),
        replay: async () => { commands.push("replay-after-evidence"); },
        finance: async () => {
          for (let index = 0; index < 10; index += 1) commands.push(`finance:${index + 1}`);
        },
        reconcile: async () => { commands.push("reconcile-after-30-outcomes"); },
        report: (summary) => ({
          runId: summary.runId,
          inns: ["7700000016", "7700000023"],
          outcomes: 30,
          sourceAttempts: ["published", "no_data"],
          reconciliation: { companies: 10, relations: 10, outcomes: 30 },
        }),
      },
    );

    expect(commands).toEqual([
      "replay-after-evidence",
      "finance:1", "finance:2", "finance:3", "finance:4", "finance:5",
      "finance:6", "finance:7", "finance:8", "finance:9", "finance:10",
      "reconcile-after-30-outcomes",
    ]);
    expect(result).toMatchObject({
      inns: ["7700000016", "7700000023"],
      outcomes: 30,
      reconciliation: { companies: 10, relations: 10, outcomes: 30 },
    });
    expect(JSON.stringify(result)).not.toMatch(/cookie|session|captcha|https?:\/\//iu);
  });
});
