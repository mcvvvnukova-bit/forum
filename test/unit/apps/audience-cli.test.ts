import { describe, expect, it } from "vitest";

import { CliInputError, parseAudienceCli } from "../../../src/apps/browser-runner/cli";

describe("parseAudienceCli", () => {
  it("parses an explicitly bounded fixture discovery command", () => {
    expect(parseAudienceCli([
      "fixture-discover",
      "--okved", "43.11",
      "--year", "2025",
      "--max-pages", "2",
      "--max-companies", "50",
      "--dry-run",
    ])).toEqual({
      kind: "fixture-discover",
      okved: "43.11",
      year: 2025,
      maxPages: 2,
      maxCompanies: 50,
      dryRun: true,
    });
  });

  it.each([
    ["an unknown command", ["scrape", "--limit", "1"], "unknown audience command"],
    ["a live URL", ["fixture-discover", "--url", "https://example.test"], "live URL options are forbidden"],
    ["IP mode", ["fixture-discover", "--ip-mode", "rotate"], "IP and proxy modes are forbidden"],
    ["a proxy", ["fixture-discover", "--proxy", "http://127.0.0.1:8888"], "IP and proxy modes are forbidden"],
    ["missing page bounds", [
      "fixture-discover", "--okved", "43.11", "--year", "2025",
      "--max-companies", "50", "--dry-run",
    ], "--max-pages is required"],
    ["missing company bounds", [
      "fixture-discover", "--okved", "43.11", "--year", "2025",
      "--max-pages", "2", "--dry-run",
    ], "--max-companies is required"],
    ["an unbounded page count", [
      "fixture-discover", "--okved", "43.11", "--year", "2025",
      "--max-pages", "11", "--max-companies", "50", "--dry-run",
    ], "--max-pages must be between 1 and 10"],
    ["an unknown option", ["reconcile", "--run-id", randomRunId(), "--verbose"], "unknown option"],
  ])("rejects %s before execution", (_case, argv, message) => {
    expect(() => parseAudienceCli(argv)).toThrow(new CliInputError(message));
  });

  it.each([
    ["replay-write", ["replay-write", "--run-id", randomRunId()]],
    ["fixture-finance", ["fixture-finance", "--run-id", randomRunId(), "--year", "2025"]],
    ["reconcile", ["reconcile", "--run-id", randomRunId()]],
    ["resume", ["resume", "--run-id", randomRunId()]],
  ])("parses %s without accepting extra source controls", (kind, argv) => {
    expect(parseAudienceCli(argv)).toMatchObject({ kind });
  });
});

function randomRunId(): string {
  return "123e4567-e89b-42d3-a456-426614174000";
}
