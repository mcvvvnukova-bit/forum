import type { AudienceRepository } from "./ports/audience-repository";
import type { RawObjectStorage } from "./ports/raw-object-storage";
import { StaleTaskError } from "./stale-task-error";

const REPLAY_LEASE_SECONDS = 300;
const RAW_VERIFICATION_BATCH_SIZE = 8;

export interface ReplayRunCommand {
  runId: string;
  dryRun: false;
}

export interface ReplayRunDependencies {
  repository: AudienceRepository;
  rawStorage: RawObjectStorage;
}

export interface PublicationSummary {
  runId: string;
  companies: number;
  companyOkveds: number;
  runCompanyMatches: number;
  verifiedRawObjects: number;
}

export async function replayRun(
  command: ReplayRunCommand,
  dependencies: ReplayRunDependencies,
): Promise<PublicationSummary> {
  if (command.dryRun !== false) throw new Error("replay-write requires dryRun=false");
  const input = await dependencies.repository.loadReplayInput(command.runId);
  if (input.status === "blocked") {
    throw new Error(`blocked run cannot be resumed (${input.terminalReason ?? "blocked"}); create a new run`);
  }

  const task = await dependencies.repository.createTask(command.runId, "replay_write", REPLAY_LEASE_SECONDS);
  try {
    for (let index = 0; index < input.rawObjects.length; index += RAW_VERIFICATION_BATCH_SIZE) {
      await Promise.all(input.rawObjects.slice(index, index + RAW_VERIFICATION_BATCH_SIZE)
        .map((object) => dependencies.rawStorage.verify(object)));
    }
    const counts = await dependencies.repository.publishReplay(task, input.candidates);
    if (counts === null) throw new StaleTaskError(task.id);
    return { runId: command.runId, ...counts, verifiedRawObjects: input.rawObjects.length };
  } catch (error) {
    if (!(error instanceof StaleTaskError)) {
      await dependencies.repository.failTask(task, "replay_write_failed", false);
    }
    throw error;
  }
}
