import { randomUUID } from "node:crypto";

import { PostgresAudienceRepository } from "../../modules/audience/infrastructure/postgres/audience-repository";
import type { Database } from "../../shared/postgres/database";

const REPLAY_QUEUE = "audience-replay-write";

export interface AtomicReplayQueue {
  ensureQueue(name: string): Promise<void>;
  publishInTransaction<T>(
    name: string,
    payload: T,
    options: { id: string; singletonKey: string },
    database: Database,
  ): Promise<string>;
}

export async function enqueueReplayWrite(
  runId: string,
  database: Database,
  queue: AtomicReplayQueue,
  taskId = randomUUID(),
): Promise<{ runId: string; taskId: string; jobId: string; queued: true }> {
  await queue.ensureQueue(REPLAY_QUEUE);
  return database.transaction(async (transaction) => {
    await new PostgresAudienceRepository(transaction)
      .prepareTask(taskId, runId, "replay_write");
    const jobId = await queue.publishInTransaction(
      REPLAY_QUEUE,
      { runId, taskId },
      { id: taskId, singletonKey: `audience:${runId}:replay_write` },
      transaction,
    );
    return { runId, taskId, jobId, queued: true };
  });
}
