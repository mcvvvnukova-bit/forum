/** The immutable first-release command contract. */
export interface RunLivePilotCommand {
  runId: string;
  okved: "43.11";
  year: 2025;
  maxCompanies: 10;
}

export interface LivePilotDiscoverySummary {
  status: "succeeded" | "blocked";
  discoveredCompanies: number;
  rawObjects: number;
}

export interface LivePilotRunResult {
  runId: string;
  discoveredCompanies: number;
  publishedCompanies: number;
  rawObjects: number;
  terminalCode: "LIVE_PILOT_DISCOVERY_INCOMPLETE" | "LIVE_PILOT_RECONCILED";
}

/**
 * The orchestration boundary deliberately receives the four irreversible
 * phases as ports.  The browser runner binds those ports to audited source,
 * replay, publication, and reconciliation implementations; local tests bind
 * them to source-shaped local contracts.  This prevents discovery from ever
 * becoming publication merely because a caller chose a different limit.
 */
export interface RunLivePilotDependencies {
  discover(): Promise<LivePilotDiscoverySummary>;
  replay(): Promise<void>;
  finance(): Promise<void>;
  reconcile(): Promise<void>;
}

export async function runLivePilot(
  command: RunLivePilotCommand,
  dependencies: RunLivePilotDependencies,
): Promise<LivePilotRunResult> {
  assertFixedLivePilotCommand(command);
  const discovery = await dependencies.discover();
  if (discovery.status !== "succeeded" || discovery.discoveredCompanies !== 10) {
    return {
      runId: command.runId,
      discoveredCompanies: discovery.discoveredCompanies,
      publishedCompanies: 0,
      rawObjects: discovery.rawObjects,
      terminalCode: "LIVE_PILOT_DISCOVERY_INCOMPLETE",
    };
  }
  await dependencies.replay();
  await dependencies.finance();
  await dependencies.reconcile();
  return {
    runId: command.runId,
    discoveredCompanies: 10,
    publishedCompanies: 10,
    rawObjects: discovery.rawObjects,
    terminalCode: "LIVE_PILOT_RECONCILED",
  };
}

function assertFixedLivePilotCommand(command: RunLivePilotCommand): void {
  if (!isUuid(command.runId)) throw new Error("live pilot run ID must be a UUID");
  if (command.okved !== "43.11" || command.year !== 2025 || command.maxCompanies !== 10) {
    throw new Error("live pilot command must be exactly OKVED 43.11, year 2025, and 10 companies");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
