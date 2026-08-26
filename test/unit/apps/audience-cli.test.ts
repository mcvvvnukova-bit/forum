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

  it("parses the exact bounded live pilot command in any option order", () => {
    expect(parseAudienceCli([
      "live-pilot",
      "--max-companies", "10",
      "--year", "2025",
      "--okved", "43.11",
    ])).toEqual({
      kind: "live-pilot",
      okved: "43.11",
      year: 2025,
      maxCompanies: 10,
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
    ["an omitted live option", ["live-pilot", "--okved", "43.11", "--year", "2025"], "--max-companies is required"],
    ["a changed live OKVED", ["live-pilot", "--okved", "43.12", "--year", "2025", "--max-companies", "10"], "live-pilot requires --okved 43.11"],
    ["a changed live year", ["live-pilot", "--okved", "43.11", "--year", "2024", "--max-companies", "10"], "live-pilot requires --year 2025"],
    ["a changed live company limit", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "9"], "live-pilot requires --max-companies 10"],
    ["a duplicated live option", ["live-pilot", "--okved", "43.11", "--okved", "43.11", "--year", "2025", "--max-companies", "10"], "duplicate option --okved"],
    ["a live source control", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "--source-url", "https://example.test"], "live URL options are forbidden"],
    ["a live positional URL", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "https://example.test"], "live URL options are forbidden"],
    ["a cookie control", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "--cookie", "session=value"], "source controls are forbidden"],
    ["a concurrency control", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "--concurrency", "2"], "source controls are forbidden"],
    ["a download control", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "--download", "export"], "source controls are forbidden"],
    ["a browser-script control", ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10", "--browser-script", "script.js"], "source controls are forbidden"],
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
