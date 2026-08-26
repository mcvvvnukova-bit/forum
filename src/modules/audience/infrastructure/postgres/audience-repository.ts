import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  AudienceRepository,
  CapturedRawObject,
  CompleteDiscoveryInput,
  CrawlStatus,
  DiscoveryTaskStart,
  DiscoveryRunInput,
  FencedTask,
  FinancialPublicationInput,
  FinancialMetricOutcome,
  FinancialMetricOutcomes,
  FinancialSourceAttempt,
  PreparedTask,
  PublicationCounts,
  ReconciliationReport,
  ReplayInput,
  TaskState,
} from "../../application/ports/audience-repository";
import type { BrowserActionEvent, DiscoveredCompany } from "../../domain/discovery";
import {
  createRawUploadPlan,
  type RawUploadFailurePhase,
  type RawUploadPlan,
  type VerifiedRawObject,
} from "../../application/ports/raw-object-storage";
import type { FinancialMetric } from "../../domain/financial";
import {
  isTerminalBlockReason,
  sanitizePolicyViolationIdentifier,
  type TerminalBlockReason,
} from "../../domain/terminal-block-reason";
import { parseLegalEntityInn } from "../../domain/inn";
import {
  expectedLiveFinancialRawSourceRecordKey,
  isExactLiveFinancialAttemptIdentity,
  isExactLiveFinancialEvidenceIdentity,
} from "../../domain/live-financial-provenance";
import type { Database } from "../../../../shared/postgres/database";
import {
  acquire,
  findFinancialSourceFetch,
  isDiscoveryTaskKind,
  insertRawFetch,
  lockFence,
  parseStagedCandidates,
  projectFinancialMetric,
  publicationCounts,
  storedRawObject,
  type RawFetchRow,
} from "./audience-repository-support";
import { publishOrganizationCandidates } from "./organization-publication";

interface RunRow extends QueryResultRow {
  status: CrawlStatus;
  terminal_reason: string | null;
}

interface ResultRow extends QueryResultRow {
  task_kind?: string;
  result_json: unknown;
}

interface RunScopeYearRow extends QueryResultRow {
  scope_year: unknown;
  required_financial_metrics?: unknown;
}

interface DiscoveryRunRow extends RunRow {
  scope_matches: boolean;
  fixture_version: string;
  parser_version: string;
}

interface TaskStateRow extends QueryResultRow {
  id: string;
  run_id: string;
  task_kind: string;
  status: CrawlStatus;
  result_json: unknown;
}

export class PostgresAudienceRepository implements AudienceRepository {
  constructor(
    private readonly database: Database,
    private readonly faults: {
      readonly beforeRawUploadCommit?: () => void | Promise<void>;
    } = {},
  ) {}

  async acquireLivePilotAttempt(input: {
    scopeKey: string;
    commandContract: Readonly<Record<string, unknown>>;
    policyChecksumSha256: string;
  }): Promise<boolean> {
    if (input.scopeKey.trim() === ""
      || !/^[0-9a-f]{64}$/u.test(input.policyChecksumSha256)
      || input.commandContract === null
      || Array.isArray(input.commandContract)) {
      throw new Error("live pilot attempt identity is invalid");
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.scopeKey],
      );
      const priorGuard = await transaction.query(
        "SELECT 1 FROM audience.live_pilot_attempts WHERE scope_key = $1",
        [input.scopeKey],
      );
      if (priorGuard.rowCount !== 0) return false;

      const inserted = await transaction.query(
        `INSERT INTO audience.live_pilot_attempts (
           scope_key, command_contract, policy_checksum_sha256
         ) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (scope_key) DO NOTHING`,
        [input.scopeKey, JSON.stringify(input.commandContract), input.policyChecksumSha256],
      );
      return inserted.rowCount === 1;
    });
  }

  async reserveRawUpload(task: FencedTask, plan: RawUploadPlan): Promise<string | null> {
    assertRawUploadPlan(task, plan);
    const intentId = randomUUID();
    const objectChecksums = Object.fromEntries(
      plan.objects.map((object) => [object.key, object.checksumSha256]),
    );
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return null;
      const inserted = await transaction.query<{ id: string } & QueryResultRow>(
        `INSERT INTO audience.raw_upload_intents (
           id, run_id, task_id, fencing_token, source_kind, source_record_key,
           parser_version, artifact_kind, manifest_key, manifest_checksum_sha256,
           plan_checksum_sha256, object_keys_json, object_checksums_json,
           stored_identity_json
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12::jsonb, $13::jsonb, $14::jsonb
         )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [intentId, task.runId, task.id, task.fencingToken,
          plan.stored.sourceKind, plan.stored.sourceRecordKey, plan.stored.parserVersion,
          plan.stored.kind, plan.stored.manifestKey, plan.stored.checksumSha256,
          plan.planChecksumSha256,
          JSON.stringify(plan.objects.map((object) => object.key)),
          JSON.stringify(objectChecksums), JSON.stringify(plan.stored)],
      );
      return inserted.rows[0]?.id ?? null;
    });
  }

  async markRawUploadVerified(
    task: FencedTask,
    intentId: string,
    plan: RawUploadPlan,
    verified: VerifiedRawObject,
  ): Promise<boolean> {
    assertRawUploadPlan(task, plan);
    if (verified.runId !== plan.stored.runId
      || verified.sourceKind !== plan.stored.sourceKind
      || verified.sourceRecordKey !== plan.stored.sourceRecordKey
      || verified.parserVersion !== plan.stored.parserVersion
      || verified.checksumSha256 !== plan.stored.checksumSha256) {
      throw new Error("raw upload verification identity mismatch");
    }
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return false;
      const updated = await transaction.query(
        `UPDATE audience.raw_upload_intents
         SET state = 'verified', verified_at = now()
         WHERE id = $1 AND run_id = $2 AND task_id = $3 AND fencing_token = $4
           AND state = 'reserved' AND plan_checksum_sha256 = $5
           AND stored_identity_json = $6::jsonb`,
        [intentId, task.runId, task.id, task.fencingToken,
          plan.planChecksumSha256, JSON.stringify(plan.stored)],
      );
      return updated.rowCount === 1;
    });
  }

  async failRawUploads(
    task: FencedTask,
    phase: RawUploadFailurePhase,
    errorCode: string,
    failRun: boolean,
  ): Promise<boolean> {
    if (!isRawUploadFailurePhase(phase) || !/^[a-z0-9_]{1,100}$/u.test(errorCode)) {
      throw new Error("raw upload failure identity is invalid");
    }
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return false;
      const failedIntents = await transaction.query(
        `UPDATE audience.raw_upload_intents
         SET state = 'failed', failure_phase = $4, failure_code = $5, failed_at = now()
         WHERE run_id = $2 AND task_id = $1 AND fencing_token = $3
           AND state IN ('reserved', 'verified')`,
        [task.id, task.runId, task.fencingToken, phase, errorCode],
      );
      if ((failedIntents.rowCount ?? 0) === 0) return false;
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'failed', error_json = $4::jsonb, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify({
          code: errorCode,
          rawUpload: { phase, intents: failedIntents.rowCount ?? 0 },
        })],
      );
      if (taskUpdate.rowCount !== 1) {
        throw new Error("stale task worker stopped during raw upload failure recording");
      }
      if (!failRun) return true;
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = 'failed', terminal_reason = $4, completed_at = now()
         WHERE id = $2
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'failed'
           )`,
        [task.id, task.runId, task.fencingToken, errorCode],
      );
      if (runUpdate.rowCount !== 1) {
        throw new Error("stale task worker stopped during raw upload run failure recording");
      }
      return true;
    });
  }

  async loadRunScopeYear(runId: string): Promise<number> {
    const result = await this.database.query<RunScopeYearRow>(
      "SELECT scope_json->'year' AS scope_year FROM audience.crawl_runs WHERE id = $1",
      [runId],
    );
    if (result.rows[0] === undefined) throw new Error("crawl run does not exist");
    return parseRunScopeYear(result.rows[0].scope_year);
  }

  async startDiscoveryRun(input: DiscoveryRunInput): Promise<DiscoveryTaskStart> {
    const taskKind = input.taskKind ?? "fixture_discovery";
    if (!isDiscoveryTaskKind(taskKind)) throw new Error("discovery task kind is invalid");
    const onlyActive = input.scope.onlyActive ?? taskKind === "fixture_discovery";
    if ((taskKind === "fixture_discovery" && onlyActive !== true)
      || (taskKind === "live_discovery" && onlyActive !== false)) {
      throw new Error("discovery task kind does not match immutable active-scope policy");
    }
    return this.database.transaction(async (transaction) => {
      const scopeJson = JSON.stringify({ ...input.scope, onlyActive });
      let run = await transaction.query<DiscoveryRunRow>(
        `SELECT status, terminal_reason, fixture_version, parser_version,
                scope_json = $2::jsonb AS scope_matches
         FROM audience.crawl_runs
         WHERE id = $1
         FOR UPDATE`,
        [input.runId, scopeJson],
      );
      if (run.rows[0] === undefined) {
        await transaction.query(
          `INSERT INTO audience.crawl_runs (
             id, scope_json, fixture_version, parser_version, status
           ) VALUES ($1, $2::jsonb, $3, $4, 'pending')`,
          [input.runId, scopeJson, input.fixtureVersion, input.parserVersion],
        );
        run = await transaction.query<DiscoveryRunRow>(
          `SELECT status, terminal_reason, fixture_version, parser_version,
                  true AS scope_matches
           FROM audience.crawl_runs WHERE id = $1 FOR UPDATE`,
          [input.runId],
        );
      }
      const runRow = run.rows[0]!;
      if (!runRow.scope_matches
        || runRow.fixture_version !== input.fixtureVersion
        || runRow.parser_version !== input.parserVersion) {
        throw new Error("discovery retry does not match immutable run scope");
      }

      const existingTasks = await transaction.query<TaskStateRow>(
        `SELECT id, run_id, task_kind, status, result_json
         FROM audience.crawl_tasks
         WHERE run_id = $1 AND task_kind IN ('fixture_discovery', 'live_discovery')
         ORDER BY created_at, id
         FOR UPDATE`,
        [input.runId],
      );
      if ((existingTasks.rowCount ?? 0) > 1) {
        throw new Error("discovery run has multiple business tasks");
      }
      let taskRow = existingTasks.rows[0];
      if (taskRow !== undefined && taskRow.task_kind !== taskKind) {
        throw new Error("discovery retry does not match immutable task kind");
      }
      if (taskRow === undefined) {
        const inserted = await transaction.query<TaskStateRow>(
          `INSERT INTO audience.crawl_tasks (id, run_id, task_kind, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id, run_id, task_kind, status, result_json`,
          [randomUUID(), input.runId, taskKind],
        );
        taskRow = inserted.rows[0]!;
      }
      if (taskRow.status === "succeeded" || taskRow.status === "blocked") {
        return { state: "completed", task: taskState(taskRow) };
      }
      if (taskRow.status === "failed") {
        throw new Error("failed discovery task is terminal; create a new run");
      }

      const task = await acquire(transaction, taskRow.id, input.leaseSeconds);
      if (task === null) return { state: "busy", taskId: taskRow.id };
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = 'running', started_at = COALESCE(started_at, now()),
             completed_at = NULL, terminal_reason = NULL
         WHERE id = $1 AND status IN ('pending', 'running')
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $2 AND fencing_token = $3 AND status = 'running'
           )`,
        [input.runId, task.id, task.fencingToken],
      );
      if (runUpdate.rowCount !== 1) throw new Error("discovery run could not start");
      return { state: "acquired", task };
    });
  }

  async createDiscoveryRun(input: DiscoveryRunInput): Promise<FencedTask> {
    const started = await this.startDiscoveryRun(input);
    if (started.state !== "acquired") {
      throw new Error(started.state === "busy"
        ? "discovery task lease has not expired"
        : "discovery task is already terminal");
    }
    return started.task;
  }

  async prepareTask(taskId: string, runId: string, taskKind: string): Promise<void> {
    if (taskKind.trim() === "") throw new Error("task kind is required");
    await this.database.transaction(async (transaction) => {
      const run = await transaction.query<RunRow>(
        "SELECT status, terminal_reason FROM audience.crawl_runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const row = run.rows[0];
      if (row === undefined) throw new Error("crawl run does not exist");
      if (row.status === "blocked") {
        throw new Error(`blocked run cannot be resumed (${row.terminal_reason ?? "blocked"}); create a new run`);
      }
      if (row.status !== "succeeded") {
        throw new Error(`cannot start ${taskKind} for a ${row.status} run`);
      }
      await transaction.query(
        `INSERT INTO audience.crawl_tasks (id, run_id, task_kind, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (id) DO NOTHING`,
        [taskId, runId, taskKind],
      );
      const task = await transaction.query<TaskStateRow>(
        `SELECT id, run_id, task_kind, status, result_json
         FROM audience.crawl_tasks WHERE id = $1`,
        [taskId],
      );
      const existing = task.rows[0];
      if (existing === undefined || existing.run_id !== runId || existing.task_kind !== taskKind) {
        throw new Error("business task identity conflicts with an existing task");
      }
    });
  }

  async createTask(runId: string, taskKind: string, leaseSeconds: number): Promise<FencedTask> {
    const taskId = randomUUID();
    await this.prepareTask(taskId, runId, taskKind);
    const task = await this.acquireTask(taskId, leaseSeconds);
    if (task === null) throw new Error("new task could not be acquired");
    return task;
  }

  async prepareLiveFinanceTask(runId: string, companyInn: string): Promise<PreparedTask> {
    parseLegalEntityInn(companyInn);
    const taskId = randomUUID();
    return this.database.transaction(async (transaction) => {
      const run = await transaction.query<RunRow>(
        "SELECT status, terminal_reason FROM audience.crawl_runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const row = run.rows[0];
      if (row === undefined) throw new Error("crawl run does not exist");
      if (row.status === "blocked") {
        throw new Error(`blocked run cannot be resumed (${row.terminal_reason ?? "blocked"}); create a new run`);
      }
      if (row.status !== "succeeded") {
        throw new Error(`cannot prepare live_finance for a ${row.status} run`);
      }
      await transaction.query(
        `INSERT INTO audience.crawl_tasks (
           id, run_id, task_kind, status, result_json
         ) VALUES ($1, $2, 'live_finance', 'pending', jsonb_build_object('companyInn', $3::text))`,
        [taskId, runId, companyInn],
      );
      return { id: taskId, runId, taskKind: "live_finance" };
    });
  }

  acquireTask(taskId: string, leaseSeconds: number): Promise<FencedTask | null> {
    return acquire(this.database, taskId, leaseSeconds);
  }

  async renewTaskLease(task: FencedTask, leaseSeconds: number): Promise<boolean> {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
      throw new Error("lease seconds must be a positive safe integer");
    }
    const result = await this.database.query(
      `UPDATE audience.crawl_tasks
       SET lease_expires_at = now() + make_interval(secs => $4::integer), updated_at = now()
       WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
      [task.id, task.runId, task.fencingToken, leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async taskState(taskId: string): Promise<TaskState | null> {
    const result = await this.database.query<TaskStateRow>(
      `SELECT id, run_id, task_kind, status, result_json
       FROM audience.crawl_tasks WHERE id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? null : taskState(row);
  }

  async recordBrowserAction(task: FencedTask, event: BrowserActionEvent): Promise<boolean> {
    const persisted = { ...event, fencingToken: task.fencingToken };
    const result = await this.database.query(
      `UPDATE audience.crawl_tasks
       SET result_json = jsonb_set(
             COALESCE(result_json, '{}'::jsonb),
             '{actionLedger}',
             COALESCE(result_json->'actionLedger', '[]'::jsonb) || $4::jsonb,
             true
           ),
           updated_at = now()
       WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
      [task.id, task.runId, task.fencingToken, JSON.stringify(persisted)],
    );
    return result.rowCount === 1;
  }

  async bindTaskCompany(task: FencedTask, companyInn: string): Promise<boolean> {
    if (task.taskKind !== "live_finance") throw new Error("only live finance tasks may bind a company");
    parseLegalEntityInn(companyInn);
    const result = await this.database.query(
      `UPDATE audience.crawl_tasks
       SET result_json = COALESCE(result_json, '{}'::jsonb) || jsonb_build_object('companyInn', $4),
           updated_at = now()
       WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
         AND (result_json IS NULL OR result_json->>'companyInn' IS NULL OR result_json->>'companyInn' = $4)`,
      [task.id, task.runId, task.fencingToken, companyInn],
    );
    return result.rowCount === 1;
  }

  async recordFinancialRaw(task: FencedTask, raw: CapturedRawObject): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return false;
      return (await this.#insertRawFetch(transaction, task, "running", raw)) === 1;
    });
  }

  async completeRawCapture(task: FencedTask, raw: CapturedRawObject): Promise<boolean> {
    if (task.taskKind !== "live_revexp_capture"
      || raw.sourceKind !== "fns-revexp"
      || raw.stored.kind !== "file") {
      throw new Error("revexp raw capture identity is invalid");
    }
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return false;
      if ((await this.#insertRawFetch(transaction, task, "running", raw)) !== 1) {
        throw new Error("stale task worker stopped during revexp raw registration");
      }
      await assertNoUncommittedRawUploads(transaction, task);
      const updated = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'succeeded', result_json = $4::jsonb,
             lease_expires_at = NULL, completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify({
          rawCapture: {
            sourceKind: raw.sourceKind,
            sourceRecordKey: raw.sourceRecordKey,
            checksumSha256: raw.stored.checksumSha256,
            parserVersion: raw.parserVersion,
          },
        })],
      );
      if (updated.rowCount !== 1) {
        throw new Error("stale task worker stopped during revexp raw registration");
      }
      return true;
    });
  }

  blockTask(
    task: FencedTask,
    reason: TerminalBlockReason,
    rawObjects: readonly CapturedRawObject[] = [],
    detail?: string,
  ): Promise<boolean> {
    return this.#block(task, reason, rawObjects, detail, false);
  }

  blockRun(
    task: FencedTask,
    reason: TerminalBlockReason,
    rawObjects: readonly CapturedRawObject[] = [],
    detail?: string,
  ): Promise<boolean> {
    return this.#block(task, reason, rawObjects, detail, true);
  }

  async #block(
    task: FencedTask,
    reason: TerminalBlockReason,
    rawObjects: readonly CapturedRawObject[],
    detail: string | undefined,
    blockRun: boolean,
  ): Promise<boolean> {
    if (!isTerminalBlockReason(reason)) throw new Error("terminal block reason is invalid");
    const safeDetail = detail === undefined
      ? undefined
      : sanitizePolicyViolationIdentifier(detail);
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return false;
      for (const raw of rawObjects) {
        if (await this.#insertRawFetch(transaction, task, "running", raw) !== 1) {
          throw new Error("stale task worker stopped during blocker raw audit");
        }
      }
      await assertNoUncommittedRawUploads(transaction, task);
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'blocked', error_json = $4::jsonb, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify({
          code: reason,
          ...(safeDetail === undefined ? {} : { detail: safeDetail }),
        })],
      );
      if (taskUpdate.rowCount !== 1) return false;
      if (!blockRun) return true;
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = 'blocked', terminal_reason = $4, completed_at = now()
         WHERE id = $2
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'blocked'
           )`,
        [task.id, task.runId, task.fencingToken, reason],
      );
      if (runUpdate.rowCount !== 1) {
        throw new Error("stale task worker stopped during run blocking");
      }
      return true;
    });
  }

  async completeDiscovery(input: CompleteDiscoveryInput): Promise<boolean> {
    if (input.status === "blocked" && !isTerminalBlockReason(input.reason)) {
      throw new Error("discovery block reason is not terminal");
    }
    if (input.status === "succeeded" && isTerminalBlockReason(input.reason)) {
      throw new Error("terminal block reason requires blocked status");
    }
    return this.database.transaction(async (transaction) => {
      const stagedResult = {
        version: 1,
        dryRun: input.dryRun,
        status: input.status,
        reason: input.reason,
        candidates: input.candidates,
        rejects: input.rejects ?? [],
        blockers: (input.blockers ?? []).map((blocker) => ({
          ...blocker,
          ...(blocker.detail === undefined ? {} : {
            detail: sanitizePolicyViolationIdentifier(blocker.detail),
          }),
        })),
        skips: input.skips ?? [],
        discovery: input.discovery,
        summary: {
          runId: input.task.runId,
          status: input.status,
          reason: input.reason,
          discoveredCompanies: input.candidates.length,
          publishedCompanies: 0,
          rawObjects: input.rawObjects.length,
        },
      };
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = $4::audience.crawl_status,
             result_json = COALESCE(result_json, '{}'::jsonb) || $5::jsonb,
             lease_expires_at = NULL,
             completed_at = now(),
             updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [input.task.id, input.task.runId, input.task.fencingToken, input.status, JSON.stringify(stagedResult)],
      );
      if (taskUpdate.rowCount !== 1) return false;

      for (const rawObject of input.rawObjects) {
        const insert = await this.#insertRawFetch(transaction, input.task, input.status, rawObject);
        if (insert === 0) throw new Error("stale task worker stopped during raw audit publication");
      }
      await assertNoUncommittedRawUploads(transaction, input.task);

      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = $4::audience.crawl_status,
             terminal_reason = $5,
             completed_at = now()
         WHERE id = $2
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3
               AND status = $4::audience.crawl_status
           )`,
        [input.task.id, input.task.runId, input.task.fencingToken, input.status, input.reason],
      );
      if (runUpdate.rowCount !== 1) {
        throw new Error("stale task worker stopped during run completion");
      }
      return true;
    });
  }

  async failTask(task: FencedTask, errorCode: string, failRun: boolean): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'failed', error_json = $4::jsonb, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify({ code: errorCode })],
      );
      if (taskUpdate.rowCount !== 1) return false;
      if (!failRun) return true;
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = 'failed', terminal_reason = $4, completed_at = now()
         WHERE id = $2
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'failed'
           )`,
        [task.id, task.runId, task.fencingToken, errorCode],
      );
      if (runUpdate.rowCount !== 1) throw new Error("stale task worker stopped during run failure");
      return true;
    });
  }

  async loadReplayInput(runId: string): Promise<ReplayInput> {
    const runResult = await this.database.query<RunRow>(
      "SELECT status, terminal_reason FROM audience.crawl_runs WHERE id = $1",
      [runId],
    );
    const run = runResult.rows[0];
    if (run === undefined) throw new Error("crawl run does not exist");

    const taskResult = await this.database.query<ResultRow>(
      `SELECT task_kind, result_json
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind IN ('fixture_discovery', 'live_discovery')
         AND status IN ('succeeded', 'blocked')
       ORDER BY created_at DESC
       LIMIT 1`,
      [runId],
    );
    const task = taskResult.rows[0];
    const staged = parseLiveDiscoveryAudit(task?.result_json);
    const candidates = staged.candidates;
    const sourceKind = task?.task_kind === "live_discovery" ? "list-org-live" : "list-org-browser";
    const rawResult = await this.database.query<RawFetchRow>(
      `SELECT run_id, source_kind, source_record_key, parser_version,
              object_key, checksum_sha256
       FROM audience.source_fetches
       WHERE run_id = $1 AND source_kind = $2
       ORDER BY created_at, id`,
      [runId, sourceKind],
    );

    return {
      runId,
      status: run.status,
      terminalReason: run.terminal_reason,
      discoveryAudit: staged.audit,
      candidates,
      rawObjects: rawResult.rows.map(storedRawObject),
    };
  }

  async publishReplay(
    task: FencedTask,
    candidates: readonly DiscoveredCompany[],
    verifiedRawObjects: number,
  ): Promise<PublicationCounts | null> {
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return null;

      await publishOrganizationCandidates(transaction, task, candidates);

      const counts = await publicationCounts(transaction, task.runId);
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'succeeded', result_json = $4::jsonb, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify({ ...counts, verifiedRawObjects })],
      );
      if (taskUpdate.rowCount !== 1) throw new Error("stale task worker stopped during replay task completion");
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET published_at = COALESCE(published_at, now())
         WHERE id = $2
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'succeeded'
           )`,
        [task.id, task.runId, task.fencingToken],
      );
      if (runUpdate.rowCount !== 1) throw new Error("stale task worker stopped during replay completion");
      return counts;
    });
  }

  async publishFinancial(input: FinancialPublicationInput): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const persistedTask = await lockFinancialTaskIdentity(transaction, input.task);
      if (persistedTask === undefined) return false;
      if (persistedTask.taskKind !== input.task.taskKind) {
        throw new Error("financial task identity does not match persisted task");
      }
      const contract = await lockRunFinancialContract(transaction, input.task.runId);
      if (input.reportYear !== contract.reportYear
        || input.evidence.some((evidence) => evidence.reportYear !== contract.reportYear)) {
        throw new Error("financial evidence report year does not match immutable run scope");
      }
      let liveTaskOwner: string | undefined;
      if (persistedTask.taskKind === "live_finance") {
        const persistedCompanyInn = persistedTask.companyInn;
        if (persistedCompanyInn === undefined) {
          throw new Error("live finance task is missing its persisted company owner");
        }
        if (input.companyInn === undefined) throw new Error("live finance task requires a company INN");
        parseLegalEntityInn(input.companyInn);
        if (persistedCompanyInn !== input.companyInn) {
          throw new Error("live finance publication does not match persisted task owner");
        }
        if (input.evidence.some((evidence) => evidence.inn !== input.companyInn)) {
          throw new Error("live finance evidence belongs to another company");
        }
        liveTaskOwner = persistedCompanyInn;
        for (const evidence of input.evidence) {
          if (!isExactLiveFinancialEvidenceIdentity(
            persistedCompanyInn,
            contract.reportYear,
            evidence.metric,
            evidence,
          )) {
            throw new Error(`live ${evidence.metric} evidence does not match persisted task owner`);
          }
        }
      } else if (input.companyInn !== undefined) {
        throw new Error("only live finance tasks may own a company INN");
      }
      assertFinancialMetricOutcomes(
        input.metricOutcomes,
        contract.requiredMetrics,
        input.evidence,
      );
      await transaction.query("SET CONSTRAINTS ALL DEFERRED");

      for (const rawObject of input.rawObjects ?? []) {
        const inserted = await this.#insertRawFetch(transaction, input.task, "running", rawObject);
        if (inserted === 0) throw new Error("stale task worker stopped during financial raw audit");
      }
      await assertNoUncommittedRawUploads(transaction, input.task);

      for (const metric of contract.requiredMetrics) {
        const outcome = input.metricOutcomes[metric]!;
        if (outcome.outcome === "no_data") {
          await assertFinancialSourceAttempt(
            transaction,
            input.task.runId,
            metric,
            outcome.sourceAttempt,
            liveTaskOwner === undefined
              ? undefined
              : { companyInn: liveTaskOwner, reportYear: contract.reportYear },
          );
        }
      }

      for (const evidence of input.evidence) {
        const sourceFetchId = await findFinancialSourceFetch(
          transaction,
          input.task.runId,
          evidence,
          liveTaskOwner !== undefined
            ? expectedLiveFinancialRawSourceRecordKey(
              contract.reportYear,
              evidence.metric,
              evidence.sourceRecordKey,
            )
            : undefined,
        );
        const inserted = await transaction.query<{ id: string } & QueryResultRow>(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.financial_evidence (
             id, company_inn, report_year, metric, amount, source_fetch_id,
             source_record_key, parser_version, observed_at
           )
           SELECT gen_random_uuid(), $4, $5, $6::audience.financial_metric,
                  $7::numeric, $8, $9, $10, $11::timestamptz
           FROM fence
           ON CONFLICT (company_inn, report_year, metric, source_fetch_id, source_record_key)
           DO UPDATE SET amount = EXCLUDED.amount, parser_version = EXCLUDED.parser_version,
                         observed_at = EXCLUDED.observed_at, collected_at = now()
           RETURNING id`,
          [input.task.id, input.task.runId, input.task.fencingToken, evidence.inn,
            evidence.reportYear, evidence.metric, evidence.value, sourceFetchId,
            evidence.sourceRecordKey, evidence.parserVersion, evidence.observedAt],
        );
        const evidenceId = inserted.rows[0]?.id;
        if (evidenceId === undefined) {
          throw new Error("stale task worker stopped during financial evidence publication");
        }
        await projectFinancialMetric(transaction, input.task, evidence, evidenceId);
      }

      const update = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'succeeded', lease_expires_at = NULL, completed_at = now(), updated_at = now(),
             result_json = COALESCE(result_json, '{}'::jsonb) || $4::jsonb
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [input.task.id, input.task.runId, input.task.fencingToken,
          JSON.stringify({
            evidence: input.evidence.length,
            metricOutcomes: input.metricOutcomes,
            ...(input.companyInn === undefined ? {} : { companyInn: input.companyInn }),
          })],
      );
      if (update.rowCount !== 1) {
        throw new Error("stale task worker stopped during financial task completion");
      }
      return true;
    });
  }

  async reconcile(runId: string): Promise<ReconciliationReport> {
    const liveDiscovery = await this.database.query<{ present: boolean } & QueryResultRow>(
      `SELECT EXISTS (
         SELECT 1 FROM audience.crawl_tasks
         WHERE run_id = $1 AND task_kind = 'live_discovery'
       ) AS present`,
      [runId],
    );
    if (liveDiscovery.rows[0]?.present === true) return this.reconcileLivePilot(runId);
    const result = await this.database.query<{
      status: CrawlStatus;
      terminal_reason: string | null;
      scope_year: unknown;
      required_financial_metrics: unknown;
      published_at: string | null;
      tasks: string;
      non_terminal_tasks: string;
      source_fetches: string;
      staged_companies: string;
      companies: string;
      company_okveds: string;
      run_company_matches: string;
      occurrences: string;
      unique_source_records: string;
      accepted_companies: string;
      duplicates: string;
      rejected: string;
      blocked_or_conflicted: string;
      revenue: string;
      income: string;
      expenses: string;
      required_finance_tasks: string;
      succeeded_finance_tasks: string;
      failed_finance_tasks: string;
      latest_financial_task_result: unknown;
      organizations_without_evidence: string;
      metrics_without_evidence: string;
      evidence_without_run_raw_checksum: string;
      projections_behind_newest_evidence: string;
      financial_evidence_outside_scope_year: string;
      unexplained_source_fetches: string;
    } & QueryResultRow>(
      `WITH latest_discovery AS (
         SELECT task.result_json
         FROM audience.crawl_tasks task
         WHERE task.run_id = $1 AND task.task_kind = 'fixture_discovery'
         ORDER BY task.created_at DESC, task.id DESC
         LIMIT 1
       ), run_matches AS (
         SELECT match.*
         FROM audience.run_company_matches match
         WHERE match.run_id = $1
       ), current_organization_evidence AS (
         SELECT evidence.*, raw.checksum_sha256
         FROM audience.organization_evidence evidence
         JOIN audience.source_fetches raw
           ON raw.id = evidence.source_fetch_id AND raw.run_id = $1
         JOIN run_matches match
           ON match.company_inn = evidence.company_inn
              AND match.source_fetch_id = evidence.source_fetch_id
              AND match.source_record_key = evidence.source_record_key
         WHERE evidence.field_name = 'organization'
       ), current_financial_evidence AS (
         SELECT evidence.*, raw.checksum_sha256
         FROM audience.financial_evidence evidence
         JOIN audience.source_fetches raw
           ON raw.id = evidence.source_fetch_id AND raw.run_id = $1
         JOIN (SELECT DISTINCT company_inn FROM run_matches) company
           ON company.company_inn = evidence.company_inn
       ), current_financial_metrics AS (
         SELECT DISTINCT company_inn, report_year, metric
         FROM current_financial_evidence
       ), globally_newest_financial_evidence AS (
         SELECT DISTINCT ON (evidence.company_inn, evidence.report_year, evidence.metric)
                evidence.company_inn, evidence.report_year, evidence.metric,
                evidence.id, evidence.amount, raw.run_id
         FROM audience.financial_evidence evidence
         JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
         JOIN current_financial_metrics metric
           ON metric.company_inn = evidence.company_inn
              AND metric.report_year = evidence.report_year
              AND metric.metric = evidence.metric
         ORDER BY evidence.company_inn, evidence.report_year, evidence.metric,
                  evidence.observed_at DESC NULLS LAST,
                  evidence.source_record_key DESC,
                  evidence.id DESC
       ), current_metric_projections AS (
         SELECT metric.company_inn, metric.report_year, metric.metric,
                newest.id AS newest_evidence_id,
                newest.amount AS newest_amount,
                newest.run_id AS newest_run_id,
                CASE metric.metric
                  WHEN 'revenue' THEN observation.revenue
                  WHEN 'income' THEN observation.income
                  WHEN 'expenses' THEN observation.expenses
                END AS projected_amount,
                CASE metric.metric
                  WHEN 'revenue' THEN observation.revenue_evidence_id
                  WHEN 'income' THEN observation.income_evidence_id
                  WHEN 'expenses' THEN observation.expenses_evidence_id
                END AS projected_evidence_id
         FROM current_financial_metrics metric
         JOIN globally_newest_financial_evidence newest
           ON newest.company_inn = metric.company_inn
              AND newest.report_year = metric.report_year
              AND newest.metric = metric.metric
         LEFT JOIN audience.financial_observations observation
           ON observation.company_inn = metric.company_inn
              AND observation.report_year = metric.report_year
       ), latest_financial_task AS (
         SELECT task.result_json
         FROM audience.crawl_tasks task
         WHERE task.run_id = $1 AND task.task_kind = 'fixture_finance'
           AND task.status = 'succeeded'
         ORDER BY task.created_at DESC, task.id DESC
         LIMIT 1
       )
       SELECT run.status, run.terminal_reason, run.scope_json->'year' AS scope_year,
         run.scope_json->'requiredFinancialMetrics' AS required_financial_metrics,
         run.published_at,
         (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = run.id)::text AS tasks,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = run.id AND status IN ('pending', 'running'))::text AS non_terminal_tasks,
         (SELECT count(*) FROM audience.source_fetches WHERE run_id = run.id)::text AS source_fetches,
         COALESCE((
           SELECT jsonb_array_length(task.result_json->'candidates')::text
           FROM audience.crawl_tasks task
           WHERE task.run_id = run.id AND task.task_kind = 'fixture_discovery'
           ORDER BY task.created_at DESC LIMIT 1
         ), '0') AS staged_companies,
         (SELECT count(DISTINCT company_inn) FROM audience.run_company_matches WHERE run_id = run.id)::text AS companies,
         (SELECT count(*) FROM audience.company_okveds relation
          JOIN run_matches match
            ON match.company_inn = relation.company_inn
               AND match.matched_okved_code = relation.okved_code)::text AS company_okveds,
         (SELECT count(*) FROM audience.run_company_matches WHERE run_id = run.id)::text AS run_company_matches,
         COALESCE((SELECT result_json->'discovery'->>'occurrences' FROM latest_discovery), '0') AS occurrences,
         COALESCE((SELECT result_json->'discovery'->>'uniqueSourceRecords' FROM latest_discovery), '0') AS unique_source_records,
         COALESCE((SELECT result_json->'discovery'->>'acceptedCompanies' FROM latest_discovery), '0') AS accepted_companies,
         COALESCE((SELECT result_json->'discovery'->>'duplicates' FROM latest_discovery), '0') AS duplicates,
         COALESCE((SELECT result_json->'discovery'->>'rejected' FROM latest_discovery), '0') AS rejected,
         COALESCE((SELECT result_json->'discovery'->>'blockedOrConflicted' FROM latest_discovery), '0') AS blocked_or_conflicted,
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'revenue')::text AS revenue,
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'income')::text AS income,
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'expenses')::text AS expenses,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = run.id AND task_kind = 'fixture_finance')::text AS required_finance_tasks,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = run.id AND task_kind = 'fixture_finance'
            AND status = 'succeeded')::text AS succeeded_finance_tasks,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = run.id AND task_kind = 'fixture_finance'
            AND status = 'failed')::text AS failed_finance_tasks,
         (SELECT result_json FROM latest_financial_task) AS latest_financial_task_result,
         (SELECT count(*) FROM run_matches match
          WHERE NOT EXISTS (
            SELECT 1
            FROM current_organization_evidence evidence
            WHERE evidence.company_inn = match.company_inn
              AND evidence.source_fetch_id = match.source_fetch_id
              AND evidence.source_record_key = match.source_record_key
              AND evidence.checksum_sha256 ~ '^[0-9a-f]{64}$'
          ))::text AS organizations_without_evidence,
         GREATEST(
           COALESCE((SELECT (result_json->>'evidence')::integer FROM latest_financial_task), 0)
             - (SELECT count(*) FROM current_financial_evidence),
           0
         )::text AS metrics_without_evidence,
         ((SELECT count(*) FROM current_organization_evidence
           WHERE checksum_sha256 !~ '^[0-9a-f]{64}$')
          + (SELECT count(*) FROM current_financial_evidence
             WHERE checksum_sha256 !~ '^[0-9a-f]{64}$'))::text
           AS evidence_without_run_raw_checksum,
         (SELECT count(*)
          FROM current_metric_projections projection
          WHERE projection.newest_run_id = run.id
            AND (
              projection.projected_evidence_id IS DISTINCT FROM projection.newest_evidence_id
              OR projection.projected_amount IS DISTINCT FROM projection.newest_amount
            )
         )::text AS projections_behind_newest_evidence,
         (SELECT count(*)
          FROM current_financial_evidence evidence
          WHERE to_jsonb(evidence.report_year) IS DISTINCT FROM run.scope_json->'year'
         )::text AS financial_evidence_outside_scope_year,
         (SELECT count(*)
          FROM audience.source_fetches raw
          WHERE raw.run_id = run.id
            AND NOT EXISTS (
              SELECT 1 FROM current_organization_evidence evidence
              WHERE evidence.source_fetch_id = raw.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM current_financial_evidence evidence
              WHERE evidence.source_fetch_id = raw.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM latest_financial_task finance,
                   jsonb_each(COALESCE(finance.result_json->'metricOutcomes', '{}'::jsonb)) outcome
              WHERE outcome.value->>'outcome' = 'no_data'
                AND outcome.value->'sourceAttempt'->>'sourceRecordKey' = raw.source_record_key
                AND outcome.value->'sourceAttempt'->>'parserVersion' = raw.parser_version
                AND (
                  outcome.value->'sourceAttempt'->>'rawFetchKey' = raw.object_key
                  OR outcome.value->'sourceAttempt'->>'rawFetchKey' = raw.checksum_sha256
                )
                AND outcome.value->'sourceAttempt'->>'rawSourceKind' = raw.source_kind
            )
            AND NOT (
              raw.source_kind = 'list-org-browser'
              AND (
                raw.source_record_key ~ '^page:[1-9][0-9]*$'
                OR EXISTS (
                  SELECT 1
                  FROM latest_discovery discovery,
                       jsonb_array_elements(
                         COALESCE(discovery.result_json->'candidates', '[]'::jsonb)
                         || COALESCE(discovery.result_json->'rejects', '[]'::jsonb)
                         || COALESCE(discovery.result_json->'blockers', '[]'::jsonb)
                       ) evidence_reference
                  WHERE evidence_reference->>'sourceRecordKey' = raw.source_record_key
                )
              )
            ))::text AS unexplained_source_fetches
       FROM audience.crawl_runs run WHERE run.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("crawl run does not exist");
    parseRunScopeYear(row.scope_year);
    const requiredFinancialMetrics = parseRequiredFinancialMetrics(row.required_financial_metrics);
    const discovery = {
      occurrences: Number(row.occurrences),
      uniqueSourceRecords: Number(row.unique_source_records),
      acceptedCompanies: Number(row.accepted_companies),
      duplicates: Number(row.duplicates),
      rejected: Number(row.rejected),
      blockedOrConflicted: Number(row.blocked_or_conflicted),
    };
    const tasks = {
      total: Number(row.tasks),
      nonTerminal: Number(row.non_terminal_tasks),
    };
    const financial = {
      revenue: Number(row.revenue),
      income: Number(row.income),
      expenses: Number(row.expenses),
    };
    const unexplainedSourceFetches = Number(row.unexplained_source_fetches);
    const report = {
      runId,
      status: row.status,
      terminalReason: row.terminal_reason,
      discovery,
      tasks,
      financial,
      unexplainedSourceFetches,
      sourceFetches: Number(row.source_fetches),
      stagedCompanies: Number(row.staged_companies),
      companies: Number(row.companies),
      companyOkveds: Number(row.company_okveds),
      runCompanyMatches: Number(row.run_company_matches),
      published: row.published_at !== null,
    };
    const publicationConsistent = !report.published
      || (report.companies === report.stagedCompanies
        && report.companyOkveds === report.stagedCompanies
        && report.runCompanyMatches === report.stagedCompanies);
    const violations: string[] = [];
    if (tasks.nonTerminal !== 0) violations.push(`non-terminal tasks: ${tasks.nonTerminal}`);
    const unaccountedOccurrences = discovery.occurrences
      - discovery.acceptedCompanies - discovery.duplicates - discovery.rejected
      - discovery.blockedOrConflicted;
    if (unaccountedOccurrences !== 0) {
      violations.push(`unaccounted discovery occurrences: ${unaccountedOccurrences}`);
    }
    if (report.stagedCompanies !== discovery.acceptedCompanies) {
      violations.push("accepted discovery companies differ from staged candidates");
    }
    const organizationsWithoutEvidence = Number(row.organizations_without_evidence);
    if (organizationsWithoutEvidence !== 0) {
      violations.push(`organizations without evidence: ${organizationsWithoutEvidence}`);
    }
    const metricsWithoutEvidence = Number(row.metrics_without_evidence);
    if (metricsWithoutEvidence !== 0) {
      violations.push(`published metrics without evidence: ${metricsWithoutEvidence}`);
    }
    const evidenceWithoutRaw = Number(row.evidence_without_run_raw_checksum);
    if (evidenceWithoutRaw !== 0) {
      violations.push(`evidence without run raw checksum: ${evidenceWithoutRaw}`);
    }
    if (row.status === "succeeded"
      && !new Set(["terminal_marker", "max_pages", "max_companies"]).has(row.terminal_reason ?? "")) {
      violations.push("invalid successful browser end reason");
    }
    const staleProjections = Number(row.projections_behind_newest_evidence);
    if (staleProjections !== 0) {
      violations.push(`financial projection differs from newest evidence: ${staleProjections}`);
    }
    const financialEvidenceOutsideScopeYear = Number(row.financial_evidence_outside_scope_year);
    if (financialEvidenceOutsideScopeYear !== 0) {
      violations.push(
        `financial evidence outside run scope year: ${financialEvidenceOutsideScopeYear}`,
      );
    }
    if (unexplainedSourceFetches !== 0) {
      violations.push(`unexplained source fetches: ${unexplainedSourceFetches}`);
    }
    if (requiredFinancialMetrics.length > 0 && row.status !== "blocked") {
      const totalFinanceTasks = Number(row.required_finance_tasks);
      const succeededFinanceTasks = Number(row.succeeded_finance_tasks);
      const failedFinanceTasks = Number(row.failed_finance_tasks);
      if (totalFinanceTasks === 0) {
        violations.push("required fixture_finance task is absent");
      }
      if (failedFinanceTasks > 0) {
        violations.push(`required fixture_finance task failed: ${failedFinanceTasks}`);
      }
      if (totalFinanceTasks > 0 && succeededFinanceTasks === 0 && failedFinanceTasks === 0) {
        violations.push("required fixture_finance task did not succeed");
      }
      if (succeededFinanceTasks > 0) {
        const outcomes = parseFinancialMetricOutcomes(row.latest_financial_task_result);
        for (const metric of requiredFinancialMetrics) {
          const outcome = outcomes[metric];
          if (outcome === undefined) {
            violations.push(`required financial metric outcome is absent: ${metric}`);
            continue;
          }
          if (outcome.outcome === "published") {
            if (outcome.evidence <= 0 || outcome.evidence !== financial[metric]) {
              violations.push(`required financial metric evidence differs from outcome: ${metric}`);
            }
          } else {
            if (financial[metric] !== 0) {
              violations.push(`required financial no-data outcome has evidence: ${metric}`);
            }
            if (!await financialSourceAttemptExists(
              this.database,
              runId,
              metric,
              outcome.sourceAttempt,
            )) {
              violations.push(`required financial no-data source attempt is missing: ${metric}`);
            }
          }
        }
      }
    }
    if (!publicationConsistent) violations.push("published organization counts differ from staging");
    if (violations.length > 0) {
      throw new Error(`reconciliation failed: ${violations.join("; ")}`);
    }
    return { ...report, consistent: true };
  }

  private async reconcileLivePilot(runId: string): Promise<ReconciliationReport> {
    const run = await this.database.query<{
      status: CrawlStatus;
      terminal_reason: string | null;
      published_at: string | null;
      scope_json: { year?: unknown; okved?: unknown };
      result_json: unknown;
      discovery_tasks: string;
    } & QueryResultRow>(
      `SELECT run.status, run.terminal_reason, run.published_at, run.scope_json,
              discovery.result_json,
              (SELECT count(*) FROM audience.crawl_tasks task
               WHERE task.run_id = run.id AND task.task_kind = 'live_discovery')::text
                AS discovery_tasks
       FROM audience.crawl_runs run
       LEFT JOIN LATERAL (
         SELECT task.result_json
         FROM audience.crawl_tasks task
         WHERE task.run_id = run.id AND task.task_kind = 'live_discovery'
         ORDER BY task.created_at, task.id
         LIMIT 1
       ) discovery ON true
       WHERE run.id = $1`,
      [runId],
    );
    const row = run.rows[0];
    if (row === undefined) throw new Error("crawl run does not exist");
    if (Number(row.discovery_tasks) !== 1) {
      throw new Error("reconciliation failed: live discovery task count is not 1");
    }
    const discovery = parseLiveDiscoveryAudit(row.result_json);
    const scopeYear = parseRunScopeYear(row.scope_json.year);
    if (scopeYear !== 2025 || row.scope_json.okved !== "43.11") {
      throw new Error("reconciliation failed: live pilot scope is invalid");
    }
    const counts = await this.database.query<{
      tasks: string; non_terminal: string; source_fetches: string; companies: string;
      relations: string; matches: string; out_of_scope_evidence: string;
      invalid_financial_provenance: string;
      revexp_capture_tasks: string; succeeded_revexp_capture_tasks: string;
      revexp_raw_fetches: string; linked_revexp_raw_fetches: string;
    } & QueryResultRow>(
      `SELECT
         (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = $1)::text AS tasks,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = $1 AND status IN ('pending', 'running'))::text AS non_terminal,
         (SELECT count(*) FROM audience.source_fetches WHERE run_id = $1)::text AS source_fetches,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = $1 AND task_kind = 'live_revexp_capture')::text AS revexp_capture_tasks,
         (SELECT count(*) FROM audience.crawl_tasks
          WHERE run_id = $1 AND task_kind = 'live_revexp_capture'
            AND status = 'succeeded')::text AS succeeded_revexp_capture_tasks,
         (SELECT count(*) FROM audience.source_fetches
          WHERE run_id = $1 AND source_kind = 'fns-revexp')::text AS revexp_raw_fetches,
         (SELECT count(*) FROM audience.source_fetches raw
          WHERE raw.run_id = $1 AND raw.source_kind = 'fns-revexp'
            AND EXISTS (
              SELECT 1 FROM audience.crawl_tasks task
              WHERE task.run_id = raw.run_id AND task.task_kind = 'live_revexp_capture'
                AND task.status = 'succeeded'
                AND task.result_json->'rawCapture'->>'sourceKind' = raw.source_kind
                AND task.result_json->'rawCapture'->>'sourceRecordKey' = raw.source_record_key
                AND task.result_json->'rawCapture'->>'checksumSha256' = raw.checksum_sha256
                AND task.result_json->'rawCapture'->>'parserVersion' = raw.parser_version
            ))::text AS linked_revexp_raw_fetches,
         (SELECT count(DISTINCT company_inn) FROM audience.run_company_matches
          WHERE run_id = $1)::text AS companies,
         (SELECT count(*) FROM audience.company_okveds relation
          JOIN audience.run_company_matches match
            ON match.run_id = $1 AND match.company_inn = relation.company_inn
               AND relation.okved_code = '43.11' AND match.matched_okved_code = '43.11')::text AS relations,
         (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS matches,
         (SELECT count(*) FROM audience.financial_evidence evidence
          JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
          WHERE raw.run_id = $1 AND evidence.report_year <> 2025)::text AS out_of_scope_evidence,
         (SELECT count(*) FROM audience.financial_evidence evidence
          JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
          WHERE raw.run_id = $1 AND evidence.report_year = 2025
            AND NOT (
              (evidence.metric = 'revenue'
                AND raw.source_kind = 'fns-bfo-live'
                AND evidence.source_record_key = raw.source_record_key
                AND raw.source_record_key ~ ('^' || evidence.company_inn || ':2025:0710002:[^:]+$')
                AND evidence.parser_version = raw.parser_version)
              OR
              (evidence.metric IN ('income', 'expenses')
                AND raw.source_kind = 'fns-revexp'
                AND raw.source_record_key = '7707329152-revexp:2025'
                AND evidence.source_record_key = evidence.company_inn || ':2025:revexp'
                AND evidence.parser_version = raw.parser_version)
            ))::text AS invalid_financial_provenance`,
      [runId],
    );
    const count = counts.rows[0]!;
    const financeTasks = await this.database.query<{
      status: CrawlStatus; result_json: unknown;
    } & QueryResultRow>(
      `SELECT status, result_json FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'live_finance' ORDER BY created_at, id`,
      [runId],
    );
    const evidence = await this.database.query<{
      company_inn: string; metric: FinancialMetric; count: string;
    } & QueryResultRow>(
      `SELECT evidence.company_inn, evidence.metric, count(*)::text AS count
       FROM audience.financial_evidence evidence
       JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
       WHERE raw.run_id = $1 AND evidence.report_year = 2025
       GROUP BY evidence.company_inn, evidence.metric`,
      [runId],
    );
    const evidenceCounts = new Map(evidence.rows.map((item) => [
      `${item.company_inn}:${item.metric}`, Number(item.count),
    ]));
    const companies = await this.database.query<{ company_inn: string } & QueryResultRow>(
      "SELECT company_inn FROM audience.run_company_matches WHERE run_id = $1",
      [runId],
    );
    const scopedInns = new Set(companies.rows.map((item) => item.company_inn));
    const discoveredInns = new Set(discovery.candidates.map((candidate) => candidate.inn));
    const violations: string[] = [];
    const outcomeCounts: Record<FinancialMetric, number> = { revenue: 0, income: 0, expenses: 0 };
    const ownedInns = new Set<string>();
    if (row.status !== "succeeded") violations.push("live discovery did not succeed");
    if (discovery.acceptedCompanies !== 10 || discovery.candidates.length !== 10) {
      violations.push("live discovery does not contain exactly 10 accepted companies");
    }
    if (new Set(discovery.candidates.map((candidate) => candidate.inn)).size !== 10) {
      violations.push("live discovery contains duplicate company INNs");
    }
    const acceptedKeys = discovery.audit.acceptedSourceRecordKeys ?? [];
    const pageIdentities = discovery.audit.pageIdentities ?? [];
    const occurrenceKeys = pageIdentities.flatMap((page) => page.orderedSourceRecordKeys);
    const skips = discovery.audit.skips ?? [];
    if (discovery.audit.occurrences !== 12
      || discovery.audit.uniqueSourceRecords !== 12
      || occurrenceKeys.length !== 12
      || new Set(occurrenceKeys).size !== 12
      || pageIdentities.length !== 2
      || pageIdentities[0]?.page !== 1
      || pageIdentities[1]?.page !== 2) {
      violations.push("live discovery occurrence/page identity contract is not exact");
    }
    if (discovery.audit.individualEntrepreneurs !== 1
      || discovery.audit.duplicateInns !== 1
      || skips.filter((skip) => skip.reason === "individual_entrepreneur").length !== 1
      || skips.filter((skip) => skip.reason === "duplicate_inn").length !== 1) {
      violations.push("live discovery skip accounting is not exact");
    }
    const skippedKeys = new Set(skips.map((skip) => skip.sourceRecordKey));
    const expectedAcceptedKeys = occurrenceKeys.filter((key) => !skippedKeys.has(key));
    if (acceptedKeys.length !== 10
      || new Set(acceptedKeys).size !== 10
      || expectedAcceptedKeys.some((key, index) => key !== acceptedKeys[index])
      || discovery.candidates.some((candidate, index) =>
        candidate.sourceRecordKey !== acceptedKeys[index])) {
      violations.push("live discovery accepted source order disagrees with page identity");
    }
    for (const skip of skips) {
      if (!await liveDiscoverySkipExists(this.database, runId, skip)) {
        violations.push(`live discovery skip evidence is missing: ${skip.reason}`);
      }
      if (skip.reason === "duplicate_inn"
        && (skip.duplicateOfSourceRecordKey === undefined
          || !acceptedKeys.includes(skip.duplicateOfSourceRecordKey)
          || occurrenceKeys.indexOf(skip.duplicateOfSourceRecordKey)
            >= occurrenceKeys.indexOf(skip.sourceRecordKey))) {
        violations.push("live discovery duplicate INN predecessor is invalid");
      }
    }
    if (Number(count.companies) !== 10 || Number(count.matches) !== 10 || Number(count.relations) !== 10) {
      violations.push("live publication does not contain exactly 10 scoped OKVED relations");
    }
    if (row.published_at === null) violations.push("live pilot was not published");
    if (discoveredInns.size !== scopedInns.size
      || [...discoveredInns].some((inn) => !scopedInns.has(inn))) {
      violations.push("published companies differ from discovery candidates");
    }
    if (Number(count.non_terminal) !== 0) violations.push(`non-terminal tasks: ${count.non_terminal}`);
    if (Number(count.out_of_scope_evidence) !== 0) violations.push("financial evidence outside run scope year");
    if (Number(count.invalid_financial_provenance) !== 0) {
      violations.push("published financial evidence provenance is invalid");
    }
    if (Number(count.revexp_capture_tasks) !== 1
      || Number(count.succeeded_revexp_capture_tasks) !== 1
      || Number(count.revexp_raw_fetches) !== 1
      || Number(count.linked_revexp_raw_fetches) !== 1) {
      violations.push("shared revexp capture is absent, duplicated, or unlinked");
    }
    if (financeTasks.rows.length !== 10) violations.push("live finance task count is not 10");
    for (const task of financeTasks.rows) {
      if (task.status !== "succeeded") {
        violations.push(`live finance task did not succeed: ${task.status}`);
        continue;
      }
      const financial = parseLiveFinancialTask(task.result_json);
      if (financial === undefined || !scopedInns.has(financial.companyInn) || ownedInns.has(financial.companyInn)) {
        violations.push("live finance task ownership is foreign or duplicate");
        continue;
      }
      ownedInns.add(financial.companyInn);
      for (const metric of ["revenue", "income", "expenses"] as const) {
        const outcome = financial.outcomes[metric];
        if (outcome === undefined) {
          violations.push(`required financial metric outcome is absent: ${metric}`);
          continue;
        }
        outcomeCounts[metric] += 1;
        const persisted = evidenceCounts.get(`${financial.companyInn}:${metric}`) ?? 0;
        if (outcome.outcome === "published") {
          if (persisted !== outcome.evidence) {
            violations.push(`required financial metric evidence differs from outcome: ${metric}`);
          }
        } else if (persisted !== 0) {
          violations.push(`required financial no-data outcome has evidence: ${metric}`);
        } else if (!isExactLiveFinancialAttemptIdentity(
          financial.companyInn,
          scopeYear,
          metric,
          outcome.sourceAttempt,
        )) {
          violations.push(`required financial no-data source attempt is invalid: ${metric}`);
        } else if (!await financialSourceAttemptExists(
          this.database,
          runId,
          metric,
          outcome.sourceAttempt,
        )) {
          violations.push(`required financial no-data source attempt is missing: ${metric}`);
        }
      }
    }
    if (ownedInns.size !== 10 || [...scopedInns].some((inn) => !ownedInns.has(inn))) {
      violations.push("live finance tasks do not cover every scoped company");
    }
    if (Object.values(outcomeCounts).some((value) => value !== 10)) {
      violations.push("live pilot does not contain 30 terminal company metric outcomes");
    }
    const unexplained = await unexplainedLiveRawFetches(
      this.database,
      runId,
      discovery.audit.pageIdentities?.flatMap((page) => page.orderedSourceRecordKeys)
        ?? discovery.candidates.map((candidate) => candidate.sourceRecordKey),
    );
    if (unexplained !== 0) violations.push(`unexplained source fetches: ${unexplained}`);
    if (violations.length > 0) throw new Error(`reconciliation failed: ${violations.join("; ")}`);
    return {
      runId,
      status: row.status,
      terminalReason: row.terminal_reason,
      discovery: discovery.audit,
      tasks: { total: Number(count.tasks), nonTerminal: Number(count.non_terminal) },
      financial: outcomeCounts,
      unexplainedSourceFetches: unexplained,
      sourceFetches: Number(count.source_fetches),
      stagedCompanies: discovery.candidates.length,
      companies: Number(count.companies),
      companyOkveds: Number(count.relations),
      runCompanyMatches: Number(count.matches),
      published: row.published_at !== null,
      consistent: true,
    };
  }

  async runStatus(runId: string): Promise<{ status: CrawlStatus; terminalReason: string | null } | null> {
    const result = await this.database.query<RunRow>(
      "SELECT status, terminal_reason FROM audience.crawl_runs WHERE id = $1",
      [runId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { status: row.status, terminalReason: row.terminal_reason };
  }

  async #insertRawFetch(
    database: Database,
    task: FencedTask,
    status: CrawlStatus,
    raw: CapturedRawObject,
  ): Promise<number> {
    const inserted = await insertRawFetch(database, task, status, raw);
    if (inserted === 1 && raw.uploadIntentId !== undefined) {
      await this.faults.beforeRawUploadCommit?.();
    }
    return inserted;
  }
}

function assertRawUploadPlan(task: FencedTask, plan: RawUploadPlan): void {
  const recreated = createRawUploadPlan(plan.stored, plan.objects);
  if (task.runId !== plan.stored.runId
    || recreated.planChecksumSha256 !== plan.planChecksumSha256
    || JSON.stringify(recreated.stored) !== JSON.stringify(plan.stored)
    || JSON.stringify(recreated.objects) !== JSON.stringify(plan.objects)) {
    throw new Error("raw upload plan identity is invalid");
  }
}

function isRawUploadFailurePhase(value: string): value is RawUploadFailurePhase {
  return value === "storage_write"
    || value === "after_data_write"
    || value === "after_manifest_write"
    || value === "verify"
    || value === "verification_record"
    || value === "before_db_commit";
}

async function assertNoUncommittedRawUploads(database: Database, task: FencedTask): Promise<void> {
  const pending = await database.query(
    `SELECT 1 FROM audience.raw_upload_intents
     WHERE run_id = $1 AND task_id = $2 AND fencing_token = $3
       AND state IN ('reserved', 'verified')
     LIMIT 1`,
    [task.runId, task.id, task.fencingToken],
  );
  if (pending.rowCount !== 0) {
    throw new Error("terminal task has an uncommitted raw upload intent");
  }
}

async function lockRunFinancialContract(
  database: Database,
  runId: string,
): Promise<{ reportYear: number; requiredMetrics: readonly FinancialMetric[] }> {
  const result = await database.query<RunScopeYearRow>(
    `SELECT scope_json->'year' AS scope_year,
            scope_json->'requiredFinancialMetrics' AS required_financial_metrics
     FROM audience.crawl_runs WHERE id = $1 FOR UPDATE`,
    [runId],
  );
  if (result.rows[0] === undefined) throw new Error("crawl run does not exist");
  return {
    reportYear: parseRunScopeYear(result.rows[0].scope_year),
    requiredMetrics: parseRequiredFinancialMetrics(
      result.rows[0].required_financial_metrics,
    ),
  };
}

async function lockFinancialTaskIdentity(
  database: Database,
  task: FencedTask,
): Promise<{ taskKind: string; companyInn?: string } | undefined> {
  const result = await database.query<{
    task_kind: string;
    company_inn: string | null;
  } & QueryResultRow>(
    `SELECT task_kind, result_json ->> 'companyInn' AS company_inn
     FROM audience.crawl_tasks
     WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
     FOR UPDATE`,
    [task.id, task.runId, task.fencingToken],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (row.task_kind !== "live_finance") return { taskKind: row.task_kind };
  if (row.company_inn === null) {
    throw new Error("live finance task is missing its persisted company owner");
  }
  parseLegalEntityInn(row.company_inn);
  return { taskKind: row.task_kind, companyInn: row.company_inn };
}

function parseRunScopeYear(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1900 || Number(value) > 9999) {
    throw new Error("crawl run scope year is invalid");
  }
  return Number(value);
}

function parseRequiredFinancialMetrics(value: unknown): readonly FinancialMetric[] {
  if (value === null || value === undefined) return [];
  const allowed = new Set<FinancialMetric>(["revenue", "income", "expenses"]);
  if (!Array.isArray(value)
    || value.some((metric) => typeof metric !== "string" || !allowed.has(metric as FinancialMetric))
    || new Set(value).size !== value.length) {
    throw new Error("crawl run required financial metrics are invalid");
  }
  return value as FinancialMetric[];
}

function assertFinancialMetricOutcomes(
  outcomes: FinancialMetricOutcomes,
  requiredMetrics: readonly FinancialMetric[],
  evidence: FinancialPublicationInput["evidence"],
): void {
  const outcomeKeys = Object.keys(outcomes).sort();
  const expectedKeys = [...requiredMetrics].sort();
  if (outcomeKeys.length !== expectedKeys.length
    || outcomeKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("financial metric outcomes do not match immutable run requirements");
  }
  if (evidence.some((item) => !requiredMetrics.includes(item.metric))) {
    throw new Error("financial metric outcome is absent for published evidence");
  }
  for (const metric of requiredMetrics) {
    const outcome = outcomes[metric];
    const evidenceCount = evidence.filter((item) => item.metric === metric).length;
    if (outcome === undefined) {
      throw new Error(`financial metric outcome is absent: ${metric}`);
    }
    if (outcome.outcome === "published") {
      if (!hasExactKeys(outcome, ["evidence", "outcome"])
        || !Number.isSafeInteger(outcome.evidence)
        || outcome.evidence <= 0
        || outcome.evidence !== evidenceCount) {
        throw new Error(`financial metric outcome evidence is invalid: ${metric}`);
      }
    } else if (outcome.outcome !== "no_data"
      || !hasExactKeys(outcome, ["evidence", "outcome", "sourceAttempt"])
      || outcome.evidence !== 0
      || evidenceCount !== 0) {
      throw new Error(`financial metric no-data outcome has evidence: ${metric}`);
    }
  }
}

async function assertFinancialSourceAttempt(
  database: Database,
  runId: string,
  metric: FinancialMetric,
  attempt: FinancialSourceAttempt,
  live?: { companyInn: string; reportYear: number },
): Promise<void> {
  if (!isFinancialSourceAttemptValid(metric, attempt)) {
    throw new Error(`financial metric no-data source attempt is invalid: ${metric}`);
  }
  if (live !== undefined && !isExactLiveFinancialAttemptIdentity(
    live.companyInn,
    live.reportYear,
    metric,
    attempt,
  )) {
    throw new Error(`live ${metric} source attempt does not match persisted task owner`);
  }
  if (!await financialSourceAttemptExists(database, runId, metric, attempt)) {
    throw new Error(`financial metric no-data source attempt is missing: ${metric}`);
  }
}

function isFinancialSourceAttemptValid(
  metric: FinancialMetric,
  attempt: FinancialSourceAttempt,
): boolean {
  if (attempt === null || typeof attempt !== "object"
    || !hasExactKeys(attempt, [
      "capturedAt", "observedAt", "parserVersion", "rawFetchKey", "rawSourceKind",
      "sourceKind", "sourceRecordKey",
    ])) {
    return false;
  }
  const sourceMapping = {
    revenue: "fns_bfo",
    income: "fns_revexp",
    expenses: "fns_revexp",
  } as const;
  const rawSourceKindMatches = metric === "revenue"
    ? attempt.rawSourceKind === "fns-bfo" || attempt.rawSourceKind === "fns-bfo-live"
    : attempt.rawSourceKind === "fns-revexp";
  return !(attempt.sourceKind !== sourceMapping[metric]
    || !rawSourceKindMatches
    || attempt.sourceRecordKey.trim() === ""
    || attempt.rawFetchKey.trim() === ""
    || attempt.parserVersion.trim() === ""
    || !isCanonicalInstant(attempt.observedAt)
    || !isCanonicalInstant(attempt.capturedAt)
    || Date.parse(attempt.observedAt) > Date.parse(attempt.capturedAt));
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

async function financialSourceAttemptExists(
  database: Database,
  runId: string,
  metric: FinancialMetric,
  attempt: FinancialSourceAttempt,
): Promise<boolean> {
  if (!isFinancialSourceAttemptValid(metric, attempt)) return false;
  const result = await database.query(
    `SELECT 1 FROM audience.source_fetches
     WHERE run_id = $1
       AND source_kind = $2
       AND source_record_key = $3
       AND (object_key = $4 OR checksum_sha256 = $4)
       AND parser_version = $5
       AND captured_at = $6::timestamptz
     LIMIT 1`,
    [runId, attempt.rawSourceKind, attempt.sourceRecordKey, attempt.rawFetchKey,
      attempt.parserVersion, attempt.capturedAt],
  );
  return result.rowCount === 1;
}

function isCanonicalInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function parseFinancialMetricOutcomes(
  result: unknown,
): FinancialMetricOutcomes {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return {};
  const candidate = (result as Record<string, unknown>).metricOutcomes;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const outcomes: Partial<Record<FinancialMetric, FinancialMetricOutcome>> = {};
  for (const metric of ["revenue", "income", "expenses"] as const) {
    const value = (candidate as Record<string, unknown>)[metric];
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const outcome = (value as Record<string, unknown>).outcome;
    const evidence = (value as Record<string, unknown>).evidence;
    if (outcome === "published"
      && hasExactKeys(value, ["evidence", "outcome"])
      && Number.isSafeInteger(evidence)
      && Number(evidence) > 0) {
      outcomes[metric] = { outcome, evidence: Number(evidence) };
    } else if (outcome === "no_data"
      && hasExactKeys(value, ["evidence", "outcome", "sourceAttempt"])
      && evidence === 0) {
      const sourceAttempt = parseFinancialSourceAttempt(
        (value as Record<string, unknown>).sourceAttempt,
      );
      if (sourceAttempt !== undefined) {
        outcomes[metric] = { outcome, evidence: 0, sourceAttempt };
      }
    }
  }
  return outcomes;
}

function parseFinancialSourceAttempt(value: unknown): FinancialSourceAttempt | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, [
    "capturedAt", "observedAt", "parserVersion", "rawFetchKey", "rawSourceKind",
    "sourceKind", "sourceRecordKey",
  ])
    || (candidate.sourceKind !== "fns_bfo" && candidate.sourceKind !== "fns_revexp")
    || (candidate.rawSourceKind !== "fns-bfo"
      && candidate.rawSourceKind !== "fns-bfo-live"
      && candidate.rawSourceKind !== "fns-revexp")
    || typeof candidate.sourceRecordKey !== "string"
    || typeof candidate.observedAt !== "string"
    || typeof candidate.capturedAt !== "string"
    || typeof candidate.rawFetchKey !== "string"
    || typeof candidate.parserVersion !== "string") {
    return undefined;
  }
  return {
    sourceKind: candidate.sourceKind,
    rawSourceKind: candidate.rawSourceKind,
    sourceRecordKey: candidate.sourceRecordKey,
    observedAt: candidate.observedAt,
    capturedAt: candidate.capturedAt,
    rawFetchKey: candidate.rawFetchKey,
    parserVersion: candidate.parserVersion,
  };
}

function parseLiveDiscoveryAudit(value: unknown): {
  candidates: readonly DiscoveredCompany[];
  acceptedCompanies: number;
  audit: ReconciliationReport["discovery"];
} {
  const candidates = parseStagedCandidates(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("live discovery result is invalid");
  }
  const discovery = (value as Record<string, unknown>).discovery;
  if (discovery === null || typeof discovery !== "object" || Array.isArray(discovery)) {
    throw new Error("live discovery audit is invalid");
  }
  const record = discovery as Record<string, unknown>;
  const fields = ["occurrences", "uniqueSourceRecords", "acceptedCompanies", "duplicates", "rejected", "blockedOrConflicted"] as const;
  if (fields.some((field) => !Number.isSafeInteger(record[field]) || Number(record[field]) < 0)) {
    throw new Error("live discovery audit is invalid");
  }
  const pageIdentities = parseLiveDiscoveryPageIdentities(record.pageIdentities);
  const acceptedSourceRecordKeys = parseLiveAcceptedSourceRecordKeys(
    record.acceptedSourceRecordKeys,
  );
  const individualEntrepreneurs = optionalAuditCount(record.individualEntrepreneurs);
  const duplicateInns = optionalAuditCount(record.duplicateInns);
  const skips = parseLiveDiscoverySkips(record.skips);
  return {
    candidates,
    acceptedCompanies: Number(record.acceptedCompanies),
    audit: {
      occurrences: Number(record.occurrences),
      uniqueSourceRecords: Number(record.uniqueSourceRecords),
      acceptedCompanies: Number(record.acceptedCompanies),
      duplicates: Number(record.duplicates),
      rejected: Number(record.rejected),
      blockedOrConflicted: Number(record.blockedOrConflicted),
      individualEntrepreneurs,
      duplicateInns,
      skips,
      ...(acceptedSourceRecordKeys === undefined ? {} : { acceptedSourceRecordKeys }),
      ...(pageIdentities === undefined ? {} : { pageIdentities }),
    },
  };
}

function optionalAuditCount(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("live discovery audit is invalid");
  }
  return Number(value);
}

function parseLiveDiscoverySkips(
  value: unknown,
): NonNullable<ReconciliationReport["discovery"]["skips"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("live discovery audit is invalid");
  return value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("live discovery audit is invalid");
    }
    const skip = item as Record<string, unknown>;
    const reason = skip.reason;
    const expectedKeys = reason === "duplicate_inn"
      ? ["duplicateOfSourceRecordKey", "rawFetchKey", "reason", "sourceRecordKey"]
      : ["rawFetchKey", "reason", "sourceRecordKey"];
    if ((reason !== "individual_entrepreneur" && reason !== "duplicate_inn")
      || !hasExactKeys(skip, expectedKeys)
      || typeof skip.sourceRecordKey !== "string" || skip.sourceRecordKey.trim() === ""
      || typeof skip.rawFetchKey !== "string" || !/^[0-9a-f]{64}$/u.test(skip.rawFetchKey)
      || (reason === "duplicate_inn"
        && (typeof skip.duplicateOfSourceRecordKey !== "string"
          || skip.duplicateOfSourceRecordKey.trim() === ""))) {
      throw new Error("live discovery audit is invalid");
    }
    return {
      sourceRecordKey: skip.sourceRecordKey,
      reason,
      rawFetchKey: skip.rawFetchKey,
      ...(reason === "duplicate_inn" ? {
        duplicateOfSourceRecordKey: skip.duplicateOfSourceRecordKey as string,
      } : {}),
    };
  });
}

async function liveDiscoverySkipExists(
  database: Database,
  runId: string,
  skip: NonNullable<ReconciliationReport["discovery"]["skips"]>[number],
): Promise<boolean> {
  const result = await database.query(
    `SELECT 1 FROM audience.source_fetches
     WHERE run_id = $1 AND source_kind = 'list-org-live'
       AND source_record_key = $2 AND checksum_sha256 = $3
     LIMIT 1`,
    [runId, skip.sourceRecordKey, skip.rawFetchKey],
  );
  return result.rowCount === 1;
}

function parseLiveAcceptedSourceRecordKeys(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)
    || value.some((key) => typeof key !== "string" || key.trim() === "")) {
    throw new Error("live discovery audit is invalid");
  }
  return value as string[];
}

function parseLiveDiscoveryPageIdentities(
  value: unknown,
): ReconciliationReport["discovery"]["pageIdentities"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("live discovery audit is invalid");
  return value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("live discovery audit is invalid");
    }
    const page = item as Record<string, unknown>;
    if (!hasExactKeys(page, ["orderedSourceRecordKeys", "page", "resultFingerprintSha256"])
      || !Number.isSafeInteger(page.page)
      || Number(page.page) <= 0
      || !Array.isArray(page.orderedSourceRecordKeys)
      || page.orderedSourceRecordKeys.some((key) => typeof key !== "string" || key.trim() === "")
      || typeof page.resultFingerprintSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(page.resultFingerprintSha256)) {
      throw new Error("live discovery audit is invalid");
    }
    return {
      page: Number(page.page),
      orderedSourceRecordKeys: page.orderedSourceRecordKeys as string[],
      resultFingerprintSha256: page.resultFingerprintSha256,
    };
  });
}

function parseLiveFinancialTask(value: unknown): {
  companyInn: string;
  outcomes: FinancialMetricOutcomes;
} | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const companyInn = (value as Record<string, unknown>).companyInn;
  if (typeof companyInn !== "string") return undefined;
  try { parseLegalEntityInn(companyInn); } catch { return undefined; }
  const outcomes = parseFinancialMetricOutcomes(value);
  return { companyInn, outcomes };
}

async function unexplainedLiveRawFetches(
  database: Database,
  runId: string,
  discoverySourceRecordKeys: readonly string[],
): Promise<number> {
  const raw = await database.query<{
    id: string; source_kind: string; source_record_key: string; object_key: string;
    checksum_sha256: string; parser_version: string;
  } & QueryResultRow>(
    `SELECT id, source_kind, source_record_key, object_key, checksum_sha256, parser_version
     FROM audience.source_fetches WHERE run_id = $1`,
    [runId],
  );
  const referenced = await database.query<{ source_fetch_id: string } & QueryResultRow>(
    `SELECT source_fetch_id FROM audience.organization_evidence
     WHERE source_fetch_id IN (SELECT id FROM audience.source_fetches WHERE run_id = $1)
     UNION
     SELECT source_fetch_id FROM audience.financial_evidence
     WHERE source_fetch_id IN (SELECT id FROM audience.source_fetches WHERE run_id = $1)`,
    [runId],
  );
  const references = new Set(referenced.rows.map((item) => item.source_fetch_id));
  const noData = await database.query<{ result_json: unknown } & QueryResultRow>(
    `SELECT result_json FROM audience.crawl_tasks
     WHERE run_id = $1 AND task_kind = 'live_finance' AND status = 'succeeded'`,
    [runId],
  );
  const attempts = new Set<string>();
  for (const task of noData.rows) {
    const parsed = parseLiveFinancialTask(task.result_json);
    if (parsed === undefined) continue;
    for (const outcome of Object.values(parsed.outcomes)) {
      if (outcome.outcome === "no_data") {
        attempts.add([
          outcome.sourceAttempt.rawSourceKind,
          outcome.sourceAttempt.sourceRecordKey,
          outcome.sourceAttempt.rawFetchKey,
          outcome.sourceAttempt.parserVersion,
        ].join("\u0000"));
      }
    }
  }
  const captures = await database.query<{ result_json: unknown } & QueryResultRow>(
    `SELECT result_json FROM audience.crawl_tasks
     WHERE run_id = $1 AND task_kind = 'live_revexp_capture' AND status = 'succeeded'`,
    [runId],
  );
  const registeredCaptures = new Set<string>();
  for (const task of captures.rows) {
    if (!isRecord(task.result_json)) continue;
    const capture = task.result_json.rawCapture;
    if (!isRecord(capture)
      || typeof capture.sourceKind !== "string"
      || typeof capture.sourceRecordKey !== "string"
      || typeof capture.checksumSha256 !== "string"
      || typeof capture.parserVersion !== "string") continue;
    registeredCaptures.add([
      capture.sourceKind,
      capture.sourceRecordKey,
      capture.checksumSha256,
      capture.parserVersion,
    ].join("\u0000"));
  }
  return raw.rows.filter((item) => {
    if (references.has(item.id)) return false;
    if (item.source_kind === "list-org-live"
      && (/^page:[1-9][0-9]*$/u.test(item.source_record_key)
        || discoverySourceRecordKeys.includes(item.source_record_key))) return false;
    if (registeredCaptures.has([
      item.source_kind, item.source_record_key, item.checksum_sha256, item.parser_version,
    ].join("\u0000"))) return false;
    return !attempts.has([
      item.source_kind, item.source_record_key, item.object_key, item.parser_version,
    ].join("\u0000"))
      && !attempts.has([
        item.source_kind, item.source_record_key, item.checksum_sha256, item.parser_version,
      ].join("\u0000"));
  }).length;
}

function taskState(row: TaskStateRow): TaskState {
  return {
    id: row.id,
    runId: row.run_id,
    taskKind: row.task_kind,
    status: row.status,
    resultJson: row.result_json,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
