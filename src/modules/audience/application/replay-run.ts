import type { AudienceRepository } from "./ports/audience-repository";
import type { RawObjectStorage } from "./ports/raw-object-storage";
import { candidateMatchesEvidence } from "../domain/candidate-evidence";
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
    const verifiedByChecksum = new Map<string, Awaited<ReturnType<RawObjectStorage["verify"]>>>();
    for (let index = 0; index < input.rawObjects.length; index += RAW_VERIFICATION_BATCH_SIZE) {
      const verified = await Promise.all(input.rawObjects.slice(index, index + RAW_VERIFICATION_BATCH_SIZE)
        .map((object) => dependencies.rawStorage.verify(object)));
      for (const raw of verified) verifiedByChecksum.set(raw.checksumSha256, raw);
    }
    for (const candidate of input.candidates) {
      const raw = verifiedByChecksum.get(candidate.rawFetchKey);
      if (raw === undefined || raw.candidateEvidence === null
        || !candidateMatchesEvidence(candidate, raw.candidateEvidence, raw.parserVersion)) {
        throw new Error("staged candidate does not match verified raw evidence");
      }
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
