import type { AudienceRepository, FencedTask } from "./ports/audience-repository";
import type { RawObjectStorage } from "./ports/raw-object-storage";
import { candidateMatchesEvidence } from "../domain/candidate-evidence";
import { StaleTaskError } from "./stale-task-error";
import { withRenewingTaskLease } from "./task-lease";

const REPLAY_LEASE_SECONDS = 300;
const RAW_VERIFICATION_BATCH_SIZE = 8;

export interface ReplayRunCommand {
  runId: string;
  dryRun: false;
  taskId?: string;
}

export interface ReplayRunDependencies {
  repository: AudienceRepository;
  rawStorage: RawObjectStorage;
  leaseSeconds?: number;
  leaseRenewalIntervalMs?: number;
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
  const leaseSeconds = dependencies.leaseSeconds ?? REPLAY_LEASE_SECONDS;
  let task: FencedTask;
  if (command.taskId === undefined) {
    task = await dependencies.repository.createTask(command.runId, "replay_write", leaseSeconds);
  } else {
    await dependencies.repository.prepareTask(command.taskId, command.runId, "replay_write");
    const existing = await dependencies.repository.taskState(command.taskId);
    if (existing?.status === "succeeded") {
      return completedReplaySummary(command.runId, existing.resultJson);
    }
    if (existing?.status === "failed" || existing?.status === "blocked") {
      throw new Error("replay business task is terminal and cannot be retried");
    }
    const acquired = await dependencies.repository.acquireTask(command.taskId, leaseSeconds);
    if (acquired === null) {
      const refreshed = await dependencies.repository.taskState(command.taskId);
      if (refreshed?.status === "succeeded") {
        return completedReplaySummary(command.runId, refreshed.resultJson);
      }
      throw new Error("replay business task lease has not expired");
    }
    task = acquired;
  }

  try {
    const input = await withRenewingTaskLease(
      dependencies.repository,
      task,
      {
        leaseSeconds,
        renewalIntervalMs: dependencies.leaseRenewalIntervalMs,
      },
      async (signal) => {
        const input = await dependencies.repository.loadReplayInput(command.runId);
        if (input.status === "blocked") {
          throw new Error(`blocked run cannot be resumed (${input.terminalReason ?? "blocked"}); create a new run`);
        }
        const verifiedByChecksum = new Map<string, Awaited<ReturnType<RawObjectStorage["verify"]>>>();
        for (let index = 0; index < input.rawObjects.length; index += RAW_VERIFICATION_BATCH_SIZE) {
          if (signal.aborted) throw new StaleTaskError(task.id);
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
        return input;
      },
    );
    const counts = await dependencies.repository.publishReplay(
      task,
      input.candidates,
      input.rawObjects.length,
    );
    if (counts === null) throw new StaleTaskError(task.id);
    return { runId: command.runId, ...counts, verifiedRawObjects: input.rawObjects.length };
  } catch (error) {
    if (!(error instanceof StaleTaskError)) {
      await dependencies.repository.failTask(task, "replay_write_failed", false);
    }
    throw error;
  }
}

function completedReplaySummary(runId: string, value: unknown): PublicationSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("completed replay task has no result");
  }
  const result = value as Record<string, unknown>;
  if (!Number.isSafeInteger(result.companies)
    || !Number.isSafeInteger(result.companyOkveds)
    || !Number.isSafeInteger(result.runCompanyMatches)
    || !Number.isSafeInteger(result.verifiedRawObjects)) {
    throw new Error("completed replay task result is invalid");
  }
  return {
    runId,
    companies: result.companies as number,
    companyOkveds: result.companyOkveds as number,
    runCompanyMatches: result.runCompanyMatches as number,
    verifiedRawObjects: result.verifiedRawObjects as number,
  };
}
