import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LivePilotPolicy } from "../../../src/modules/audience/domain/live-pilot-policy";

const harness = vi.hoisted(() => ({
  events: [] as string[],
  output: [] as string[],
  liveOperation: vi.fn<(...args: unknown[]) => Promise<object>>(),
  fixtureOperation: vi.fn<(...args: unknown[]) => Promise<object>>(),
  reconcileOperation: vi.fn<(...args: unknown[]) => Promise<object>>(),
  livePilotPolicy: undefined as unknown as LivePilotPolicy,
}));

vi.mock("../../../src/shared/postgres/database", () => ({
  PostgresDatabase: class {
    constructor() {
      harness.events.push("database:constructed");
    }

    close(): Promise<void> {
      harness.events.push("database:closed");
      return Promise.resolve();
    }
  },
}));

vi.mock("../../../src/modules/audience/infrastructure/postgres/audience-repository", () => ({
  PostgresAudienceRepository: class {
    constructor() {
      harness.events.push("repository:constructed");
    }
  },
}));

vi.mock("../../../src/modules/audience/infrastructure/postgres/okved-repository", () => ({
  PostgresOkvedRepository: class {
    find(): Promise<object> {
      return Promise.resolve({ code: "43.11", name: "fixture OKVED" });
    }
  },
}));

vi.mock("../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage", () => ({
  S3RawObjectStorage: class {
    constructor() {
      harness.events.push("raw-storage:constructed");
    }

    close(): void {
      harness.events.push("raw-storage:closed");
    }
  },
}));

vi.mock("../../../src/apps/browser-runner/run-live-pilot", () => ({
  executeLivePilot: (...args: unknown[]) => harness.liveOperation(...args),
}));

vi.mock("../../../src/modules/audience/domain/live-pilot-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/audience/domain/live-pilot-policy")>();
  return {
    ...actual,
    get LIVE_PILOT_POLICY() {
      return harness.livePilotPolicy;
    },
  };
});

vi.mock("../../../src/modules/audience/application/run-fixture-discovery", () => ({
  runFixtureDiscovery: (...args: unknown[]) => harness.fixtureOperation(...args),
}));

vi.mock("../../../src/apps/browser-runner/list-org-fixture-server", () => ({
  startListOrgFixtureServer: async () => ({
    origin: "http://127.0.0.1:4311",
    close: async () => {},
  }),
}));

vi.mock("../../../src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source", () => ({
  ListOrgBrowserSource: class {},
  PlaywrightBrowserSessionFactory: class {},
}));

vi.mock("../../../src/modules/audience/application/reconcile-run", () => ({
  reconcileRun: (...args: unknown[]) => harness.reconcileOperation(...args),
}));

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
const environmentNames = [
  "APP_MODE",
  "LIST_ORG_LIVE_ENABLED",
  "FNS_LIVE_ENABLED",
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const originalEnvironment = new Map(
  environmentNames.map((name) => [name, process.env[name]]),
);

const liveCommand = {
  label: "live-pilot",
  argv: ["live-pilot", "--okved", "43.11", "--year", "2025", "--max-companies", "10"],
  appMode: "live",
} as const;

interface CommandCase {
  label: string;
  argv: readonly string[];
  appMode: "fixture" | "live";
  install(operation: () => Promise<object>): void;
  success: object;
  failure: Error;
  publicError: string;
}

const commandCases: readonly CommandCase[] = [
  {
    label: "fixture-discover",
    argv: [
      "fixture-discover", "--okved", "43.11", "--year", "2025",
      "--max-pages", "1", "--max-companies", "1", "--dry-run",
    ],
    appMode: "fixture",
    install: (operation) => harness.fixtureOperation.mockImplementation(operation),
    success: { runId: "safe-fixture-run", status: "succeeded" },
    failure: new Error("private fixture detail"),
    publicError: "operation failed",
  },
  {
    label: "reconcile",
    argv: ["reconcile", "--run-id", "123e4567-e89b-42d3-a456-426614174000"],
    appMode: "fixture",
    install: (operation) => harness.reconcileOperation.mockImplementation(operation),
    success: { runId: "safe-reconcile-run", consistent: true },
    failure: new Error("reconciliation failed: private invariant detail"),
    publicError: "live pilot reconciliation failed",
  },
];

describe("audience CLI resource lifetime", () => {
  beforeEach(() => {
    vi.resetModules();
    harness.events.length = 0;
    harness.output.length = 0;
    harness.liveOperation.mockReset();
    harness.fixtureOperation.mockReset();
    harness.reconcileOperation.mockReset();
    harness.livePilotPolicy = undefined as unknown as LivePilotPolicy;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      harness.output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    process.exitCode = originalExitCode;
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("constructs public resources only after the active policy validates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-27T18:00:00+03:00"));
    harness.livePilotPolicy = await activeProductionPolicy();
    harness.liveOperation.mockResolvedValue({ runId: "authorized-live-run" });

    await startProductionMain(liveCommand);
    await waitForOutput();

    expect(harness.events).toEqual([
      "database:constructed",
      "repository:constructed",
      "raw-storage:constructed",
      "raw-storage:closed",
      "database:closed",
    ]);
    expect(harness.liveOperation).toHaveBeenCalledOnce();
    expect(JSON.parse(harness.output.join(""))).toEqual({
      ok: true,
      result: { runId: "authorized-live-run" },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    ["a consumed snapshot", () => policyWithAuthorization({
      reviewedAt: "2026-08-27T09:40:50+03:00",
      consumedAt: "2026-08-27T10:00:00+03:00",
      status: "consumed",
    })],
    ["an expired snapshot", () => policyWithAuthorization({
      reviewedAt: "2026-08-27T09:40:50+03:00",
      expiresAt: "2026-08-27T17:59:59+03:00",
      status: "active",
    })],
    ["a checksum-invalid snapshot", async () => ({
      ...(await activeProductionPolicy()),
      checksumSha256: "0".repeat(64),
    })],
  ] as const)("rejects %s before public DB or S3 construction", async (_label, createPolicy) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-27T18:00:00+03:00"));
    harness.livePilotPolicy = await createPolicy();

    await startProductionMain(liveCommand);
    await waitForOutput();

    expect(harness.events).toEqual([]);
    expect(harness.liveOperation).not.toHaveBeenCalled();
    expect(JSON.parse(harness.output.join(""))).toEqual({ ok: false, error: "operation failed" });
    expect(process.exitCode).toBe(1);
  });

  it.each(commandCases)("keeps resources open until $label succeeds", async (command) => {
    const completion = deferred<object>();
    command.install(async () => {
      harness.events.push("operation:started");
      try {
        return await completion.promise;
      } finally {
        harness.events.push("operation:settled");
      }
    });

    await startProductionMain(command);

    expect(harness.events).toEqual([
      "database:constructed",
      "repository:constructed",
      "raw-storage:constructed",
      "operation:started",
    ]);
    completion.resolve(command.success);
    await waitForOutput();

    expect(harness.events).toEqual([
      "database:constructed",
      "repository:constructed",
      "raw-storage:constructed",
      "operation:started",
      "operation:settled",
      "raw-storage:closed",
      "database:closed",
    ]);
    expect(closeCount("raw-storage:closed")).toBe(1);
    expect(closeCount("database:closed")).toBe(1);
    expect(JSON.parse(harness.output.join(""))).toEqual({ ok: true, result: command.success });
    expect(process.exitCode).toBeUndefined();
  });

  it.each(commandCases)("keeps resources open until $label fails safely", async (command) => {
    const completion = deferred<object>();
    command.install(async () => {
      harness.events.push("operation:started");
      try {
        return await completion.promise;
      } finally {
        harness.events.push("operation:settled");
      }
    });

    await startProductionMain(command);

    expect(harness.events).toEqual([
      "database:constructed",
      "repository:constructed",
      "raw-storage:constructed",
      "operation:started",
    ]);
    completion.reject(command.failure);
    await waitForOutput();

    expect(harness.events).toEqual([
      "database:constructed",
      "repository:constructed",
      "raw-storage:constructed",
      "operation:started",
      "operation:settled",
      "raw-storage:closed",
      "database:closed",
    ]);
    expect(closeCount("raw-storage:closed")).toBe(1);
    expect(closeCount("database:closed")).toBe(1);
    const output = harness.output.join("");
    expect(JSON.parse(output)).toEqual({ ok: false, error: command.publicError });
    expect(output).not.toContain(command.failure.message);
    expect(process.exitCode).toBe(1);
  });
});

async function startProductionMain(command: Pick<CommandCase, "argv" | "appMode">): Promise<void> {
  process.argv = [process.execPath, "src/apps/browser-runner/main.ts", ...command.argv];
  Object.assign(process.env, {
    APP_MODE: command.appMode,
    LIST_ORG_LIVE_ENABLED: command.appMode === "live" ? "true" : "false",
    FNS_LIVE_ENABLED: command.appMode === "live" ? "true" : "false",
    DATABASE_URL: command.appMode === "live"
      ? "postgresql://app:password@127.0.0.1:5433/okved"
      : "postgresql://fixture.invalid/okved",
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_BUCKET: command.appMode === "live" ? "okved-raw" : "okved-raw-test",
    S3_ACCESS_KEY_ID: "local-test-access-key",
    S3_SECRET_ACCESS_KEY: "local-test-secret-key",
  });
  await import("../../../src/apps/browser-runner/main");
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForOutput(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (harness.output.length > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("audience CLI did not write a terminal result");
}

function closeCount(event: string): number {
  return harness.events.filter((item) => item === event).length;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function activeProductionPolicy(): Promise<LivePilotPolicy> {
  const policy = await vi.importActual<typeof import("../../../src/modules/audience/domain/live-pilot-policy")>(
    "../../../src/modules/audience/domain/live-pilot-policy",
  );
  return policy.LIVE_PILOT_POLICY;
}

async function policyWithAuthorization(
  authorization: LivePilotPolicy["authorization"],
): Promise<LivePilotPolicy> {
  const policyModule = await vi.importActual<typeof import("../../../src/modules/audience/domain/live-pilot-policy")>(
    "../../../src/modules/audience/domain/live-pilot-policy",
  );
  const { checksumSha256: _checksumSha256, ...document } = policyModule.LIVE_PILOT_POLICY;
  const reviewed = { ...document, authorization };
  return {
    ...reviewed,
    checksumSha256: policyModule.checksumLivePilotPolicy(reviewed),
  };
}
