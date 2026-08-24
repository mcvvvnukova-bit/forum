import { PgBoss } from "pg-boss";
import type { Db as PgBossDatabase } from "pg-boss";

import type {
  JobQueue,
  QueuedJob,
} from "../../modules/audience/application/ports/job-queue";
import type { Database } from "../postgres/database";

export class PgBossJobQueue implements JobQueue {
  readonly #boss: PgBoss;
  readonly #queues = new Map<string, Promise<void>>();
  #started: Promise<void> | null = null;
  #closed = false;
  #backgroundError: Error | null = null;

  constructor(databaseUrl: string) {
    this.#boss = new PgBoss(databaseUrl);
    this.#boss.on("error", (error) => {
      this.#backgroundError = sanitizedError(error);
    });
  }

  async publish<T>(
    name: string,
    payload: T,
    options: { singletonKey: string },
  ): Promise<string> {
    validatePublish(name, payload, options.singletonKey);
    await this.ensureQueue(name);
    this.#assertAvailable();
    const id = await this.#boss.send(name, payload as object, { singletonKey: options.singletonKey });
    if (id === null) throw new Error("job singleton is already queued");
    return id;
  }

  async ensureQueue(name: string): Promise<void> {
    validateName(name);
    await this.#ensureQueue(name);
  }

  async publishInTransaction<T>(
    name: string,
    payload: T,
    options: { id: string; singletonKey: string },
    database: Database,
  ): Promise<string> {
    validatePublish(name, payload, options.singletonKey);
    await this.ensureQueue(name);
    this.#assertAvailable();
    const db: PgBossDatabase = {
      executeSql: async (text, values) => {
        const result = await database.query(text, values);
        return { rows: result.rows };
      },
    };
    const id = await this.#boss.send(name, payload as object, {
      id: options.id,
      singletonKey: options.singletonKey,
      db,
    });
    if (id === null) throw new Error("job identity is already queued");
    return id;
  }

  async work<T>(
    name: string,
    handler: (job: QueuedJob<T>) => Promise<void>,
  ): Promise<void> {
    validateName(name);
    await this.#ensureQueue(name);
    this.#assertAvailable();
    await this.#boss.work<T>(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        await handler({ id: job.id, name: job.name, data: job.data });
      }
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#started !== null) {
      let startRejected = false;
      try {
        await this.#started;
      } catch {
        startRejected = true;
      }
      try {
        await this.#boss.stop({ graceful: true, close: true, timeout: 5_000 });
      } catch (error) {
        if (!startRejected) throw error;
      }
    }
  }

  #ensureQueue(name: string): Promise<void> {
    const existing = this.#queues.get(name);
    if (existing !== undefined) return existing;
    const creating = this.#ensureStarted().then(async () => {
      await this.#boss.createQueue(name, {
        policy: "key_strict_fifo",
        retryLimit: 2,
        retryDelay: 1,
      });
    });
    this.#queues.set(name, creating);
    return creating;
  }

  #ensureStarted(): Promise<void> {
    this.#assertAvailable();
    this.#started ??= this.#boss.start().then(() => undefined);
    return this.#started;
  }

  #assertAvailable(): void {
    if (this.#closed) throw new Error("job queue is closed");
    if (this.#backgroundError !== null) throw this.#backgroundError;
  }
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw new Error("job name is invalid");
  }
}

function validatePublish<T>(name: string, payload: T, singletonKey: string): void {
  validateName(name);
  if (singletonKey.trim() === "") throw new Error("job singleton key is required");
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("job payload must be an object");
  }
}

function sanitizedError(error: unknown): Error {
  if (error instanceof Error) return new Error(`pg-boss background failure: ${error.name}`);
  return new Error("pg-boss background failure");
}
