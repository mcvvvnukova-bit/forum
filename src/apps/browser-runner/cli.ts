import { parseOkvedCode, type OkvedCode } from "../../modules/audience/domain/okved";

export type AudienceCliCommand =
  | {
      kind: "fixture-discover";
      okved: OkvedCode;
      year: number;
      maxPages: number;
      maxCompanies: number;
      dryRun: true;
    }
  | { kind: "replay-write"; runId: string }
  | { kind: "fixture-finance"; runId: string; year: number }
  | { kind: "reconcile"; runId: string }
  | { kind: "resume"; runId: string };

export class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliInputError";
  }
}

export function parseAudienceCli(argv: readonly string[]): AudienceCliCommand {
  const command = argv[0];
  if (!isCommand(command)) throw new CliInputError("unknown audience command");
  rejectSourceControls(argv.slice(1));
  rejectUnknownOptionNames(argv.slice(1));
  const options = parseOptions(argv.slice(1));

  switch (command) {
    case "fixture-discover": {
      assertOnly(options, ["--okved", "--year", "--max-pages", "--max-companies", "--dry-run"]);
      if (options.get("--dry-run") !== true) {
        throw new CliInputError("fixture-discover requires --dry-run");
      }
      let okved: OkvedCode;
      try {
        okved = parseOkvedCode(requiredString(options, "--okved"));
      } catch {
        throw new CliInputError("--okved must be a canonical OKVED code");
      }
      return {
        kind: command,
        okved,
        year: year(options),
        maxPages: boundedInteger(options, "--max-pages", 10),
        maxCompanies: boundedInteger(options, "--max-companies", 500),
        dryRun: true,
      };
    }
    case "replay-write":
    case "reconcile":
    case "resume":
      assertOnly(options, ["--run-id"]);
      return { kind: command, runId: runId(options) };
    case "fixture-finance":
      assertOnly(options, ["--run-id", "--year"]);
      return { kind: command, runId: runId(options), year: year(options) };
  }
}

function rejectUnknownOptionNames(argv: readonly string[]): void {
  const known = new Set([
    "--okved", "--year", "--max-pages", "--max-companies", "--dry-run", "--run-id",
  ]);
  for (const value of argv) {
    if (value.startsWith("--") && !known.has(value)) {
      throw new CliInputError(`unknown option ${value}`);
    }
  }
}

function isCommand(value: string | undefined): value is AudienceCliCommand["kind"] {
  return value === "fixture-discover"
    || value === "replay-write"
    || value === "fixture-finance"
    || value === "reconcile"
    || value === "resume";
}

function rejectSourceControls(argv: readonly string[]): void {
  if (argv.some((value) => /^--(?:ip(?:-|$)|proxy(?:-|$))/i.test(value))) {
    throw new CliInputError("IP and proxy modes are forbidden");
  }
  if (argv.some((value) => /^--(?:url|live-url|source-url)$/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(value))) {
    throw new CliInputError("live URL options are forbidden");
  }
}

function parseOptions(argv: readonly string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new CliInputError(`unexpected argument ${name}`);
    if (result.has(name)) throw new CliInputError(`duplicate option ${name}`);
    if (name === "--dry-run") {
      result.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliInputError(`${name} requires a value`);
    }
    result.set(name, value);
    index += 1;
  }
  return result;
}

function assertOnly(options: ReadonlyMap<string, string | true>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of options.keys()) {
    if (!allowedSet.has(name)) throw new CliInputError(`unknown option ${name}`);
  }
}

function requiredString(options: ReadonlyMap<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliInputError(`${name} is required`);
  }
  return value;
}

function boundedInteger(
  options: ReadonlyMap<string, string | true>,
  name: string,
  maximum: number,
): number {
  const value = requiredString(options, name);
  if (!/^[0-9]+$/.test(value)) {
    throw new CliInputError(`${name} must be between 1 and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new CliInputError(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function year(options: ReadonlyMap<string, string | true>): number {
  const value = requiredString(options, "--year");
  if (!/^[0-9]{4}$/.test(value)) throw new CliInputError("--year must be between 1900 and 9999");
  const parsed = Number(value);
  if (parsed < 1900 || parsed > 9999) throw new CliInputError("--year must be between 1900 and 9999");
  return parsed;
}

function runId(options: ReadonlyMap<string, string | true>): string {
  const value = requiredString(options, "--run-id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CliInputError("--run-id must be a UUID");
  }
  return value;
}
