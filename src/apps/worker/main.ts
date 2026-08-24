import { replayRun } from "../../modules/audience/application/replay-run";
import { PostgresAudienceRepository } from "../../modules/audience/infrastructure/postgres/audience-repository";
import { S3RawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-raw-object-storage";
import { parseEnv } from "../../shared/config/env";
import { PgBossJobQueue } from "../../shared/jobs/pg-boss-job-queue";
import { PostgresDatabase } from "../../shared/postgres/database";

async function startWorker(): Promise<void> {
  const env = parseEnv(process.env);
  if (env.appMode !== "fixture" || env.listOrgLiveEnabled) {
    throw new Error("worker is fixture-only");
  }
  const database = new PostgresDatabase(env.databaseUrl);
  const repository = new PostgresAudienceRepository(database);
  const rawStorage = new S3RawObjectStorage(env, "list-org-browser");
  const queue = new PgBossJobQueue(env.databaseUrl);
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await queue.close();
    } finally {
      await database.close();
    }
  };
  const handleSignal = () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  try {
    await queue.work<{ runId: string }>("audience-replay-write", async (job) => {
      await replayRun({ runId: job.data.runId, dryRun: false }, { repository, rawStorage });
    });
  } catch (error) {
    await close();
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, status: "ready" })}\n`);
}

startWorker().catch(() => {
  process.exitCode = 1;
  process.stdout.write(`${JSON.stringify({ ok: false, error: "worker failed" })}\n`);
});
