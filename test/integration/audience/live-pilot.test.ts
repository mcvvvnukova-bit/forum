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
        acceptedCompanies: 9,
        acceptedSourceRecordKeys: [],
        candidates: [],
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

  it("fails closed before replay when ten discovery summary entries repeat one INN", async () => {
    let replayed = false;
    const result = await runLivePilot({
      runId: randomUUID(), okved: "43.11", year: 2025, maxCompanies: 10,
    }, {
      discover: async () => ({
        status: "succeeded" as const, discoveredCompanies: 10, acceptedCompanies: 10,
        acceptedSourceRecordKeys: Array.from({ length: 10 }, (_, index) => `record-${index + 1}`),
        candidates: Array.from({ length: 10 }, (_, index) => ({
          inn: "7700000016",
          sourceRecordKey: `record-${index + 1}`,
        })), rawObjects: 10,
      }),
      replay: async () => { replayed = true; },
      finance: async () => { throw new Error("finance must not start"); },
      reconcile: async () => { throw new Error("reconciliation must not start"); },
    });
    expect(result).toMatchObject({ publishedCompanies: 0, terminalCode: "LIVE_PILOT_DISCOVERY_INCOMPLETE" });
    expect(replayed).toBe(false);
  });

  it("fails closed before replay when the 12-occurrence skip accounting is incomplete", async () => {
    let replayed = false;
    const candidates = exactCandidates();
    const result = await runLivePilot({
      runId: randomUUID(), okved: "43.11", year: 2025, maxCompanies: 10,
    }, {
      discover: async () => ({
        status: "succeeded" as const,
        discoveredCompanies: 10,
        acceptedCompanies: 10,
        acceptedSourceRecordKeys: candidates.map((candidate) => candidate.sourceRecordKey),
        candidates,
        rawObjects: 14,
        occurrences: 11,
        uniqueSourceRecords: 12,
        skips: [
          { sourceRecordKey: "record-3", reason: "individual_entrepreneur" as const },
          { sourceRecordKey: "record-4", reason: "duplicate_inn" as const, duplicateOfSourceRecordKey: "record-1" },
        ],
        pageIdentities: [
          { page: 1, orderedSourceRecordKeys: ["record-1", "record-2", "record-3", "record-4", "record-5", "record-6"] },
          { page: 2, orderedSourceRecordKeys: ["record-7", "record-8", "record-9", "record-10", "record-11", "record-12"] },
        ],
      }),
      replay: async () => { replayed = true; },
      finance: async () => undefined,
      reconcile: async () => undefined,
    });

    expect(result.terminalCode).toBe("LIVE_PILOT_DISCOVERY_INCOMPLETE");
    expect(replayed).toBe(false);
  });

  it("surfaces blocked discovery as a stable terminal failure instead of success", async () => {
    await expect(runLivePilot({
      runId: randomUUID(), okved: "43.11", year: 2025, maxCompanies: 10,
    }, {
      discover: async () => ({
        status: "blocked" as const, discoveredCompanies: 0, acceptedCompanies: 0,
        acceptedSourceRecordKeys: [], candidates: [], rawObjects: 1,
      }),
      replay: async () => undefined,
      finance: async () => undefined,
      reconcile: async () => undefined,
    })).rejects.toThrow("live pilot discovery blocked");
  });

  it("runs the exact injected-local CLI flow sequentially and emits only sanitized report fields", async () => {
    const commands: string[] = [];
    const result = await executeInjectedLivePilot(
      ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10"],
      {
        discover: async () => ({
          status: "succeeded" as const, discoveredCompanies: 10, acceptedCompanies: 10,
          acceptedSourceRecordKeys: exactCandidates().map((candidate) => candidate.sourceRecordKey),
          candidates: exactCandidates(), rawObjects: 14,
          occurrences: 12, uniqueSourceRecords: 12,
          skips: [
            { sourceRecordKey: "record-3", reason: "individual_entrepreneur" as const },
            { sourceRecordKey: "record-4", reason: "duplicate_inn" as const, duplicateOfSourceRecordKey: "record-1" },
          ],
          pageIdentities: [
            { page: 1, orderedSourceRecordKeys: ["record-1", "record-2", "record-3", "record-4", "record-5", "record-6"] },
            { page: 2, orderedSourceRecordKeys: ["record-7", "record-8", "record-9", "record-10", "record-11", "record-12"] },
          ],
        }),
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

function exactCandidates() {
  const sourceKeys = [
    "record-1", "record-2", "record-5", "record-6", "record-7",
    "record-8", "record-9", "record-10", "record-11", "record-12",
  ];
  return [
    "7700000016", "7700000023", "7700000030", "7700000048", "7700000055",
    "7700000062", "7700000070", "7700000087", "7700000094", "7700000104",
  ].map((inn, index) => ({ inn, sourceRecordKey: sourceKeys[index]! }));
}
