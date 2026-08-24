import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  AudienceRepository,
  CompleteDiscoveryInput,
  CrawlStatus,
  DiscoveryRunInput,
  FencedTask,
  FinancialPublicationInput,
  PublicationCounts,
  ReconciliationReport,
  ReplayInput,
} from "../../application/ports/audience-repository";
import type { DiscoveredCompany } from "../../domain/discovery";
import type { Database } from "../../../../shared/postgres/database";
import {
  acquire,
  findFinancialSourceFetch,
  insertRawFetch,
  lockFence,
  parseStagedCandidates,
  projectFinancialMetric,
  publicationCounts,
  storedRawObject,
  type RawFetchRow,
} from "./audience-repository-support";

interface RunRow extends QueryResultRow {
  status: CrawlStatus;
  terminal_reason: string | null;
}

interface ResultRow extends QueryResultRow {
  result_json: unknown;
}

const BLOCK_REASONS = new Set([
  "captcha",
  "http_403",
  "soft_block",
  "policy_block",
  "contract_drift",
]);

export class PostgresAudienceRepository implements AudienceRepository {
  constructor(private readonly database: Database) {}

  async createDiscoveryRun(input: DiscoveryRunInput): Promise<FencedTask> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO audience.crawl_runs (
           id, scope_json, fixture_version, parser_version, status
         ) VALUES ($1, $2::jsonb, $3, $4, 'pending')`,
        [input.runId, JSON.stringify(input.scope), input.fixtureVersion, input.parserVersion],
      );
      const taskId = randomUUID();
      await transaction.query(
        `INSERT INTO audience.crawl_tasks (id, run_id, task_kind, status)
         VALUES ($1, $2, 'fixture_discovery', 'pending')`,
        [taskId, input.runId],
      );
      const task = await acquire(transaction, taskId, input.leaseSeconds);
      if (task === null) throw new Error("new fixture discovery task could not be acquired");
      const runUpdate = await transaction.query(
        `UPDATE audience.crawl_runs
         SET status = 'running', started_at = now()
         WHERE id = $1
           AND EXISTS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $2 AND fencing_token = $3 AND status = 'running'
           )`,
        [input.runId, task.id, task.fencingToken],
      );
      if (runUpdate.rowCount !== 1) throw new Error("new fixture discovery run could not start");
      return task;
    });
  }

  async createTask(runId: string, taskKind: string, leaseSeconds: number): Promise<FencedTask> {
    if (taskKind.trim() === "") throw new Error("task kind is required");
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
        throw new Error(`cannot start ${taskKind} for a ${row.status} run`);
      }
      const taskId = randomUUID();
      await transaction.query(
        `INSERT INTO audience.crawl_tasks (id, run_id, task_kind, status)
         VALUES ($1, $2, $3, 'pending')`,
        [taskId, runId, taskKind],
      );
      const task = await acquire(transaction, taskId, leaseSeconds);
      if (task === null) throw new Error("new task could not be acquired");
      return task;
    });
  }

  acquireTask(taskId: string, leaseSeconds: number): Promise<FencedTask | null> {
    return acquire(this.database, taskId, leaseSeconds);
  }

  async completeDiscovery(input: CompleteDiscoveryInput): Promise<boolean> {
    if (input.status === "blocked" && !BLOCK_REASONS.has(input.reason)) {
      throw new Error("discovery block reason is not terminal");
    }
    if (input.status === "succeeded" && BLOCK_REASONS.has(input.reason)) {
      throw new Error("terminal block reason requires blocked status");
    }
    return this.database.transaction(async (transaction) => {
      const stagedResult = {
        version: 1,
        dryRun: input.dryRun,
        status: input.status,
        reason: input.reason,
        candidates: input.candidates,
        discovery: input.discovery,
      };
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = $4::audience.crawl_status,
             result_json = $5::jsonb,
             lease_expires_at = NULL,
             completed_at = now(),
             updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [input.task.id, input.task.runId, input.task.fencingToken, input.status, JSON.stringify(stagedResult)],
      );
      if (taskUpdate.rowCount !== 1) return false;

      for (const rawObject of input.rawObjects) {
        const insert = await insertRawFetch(transaction, input.task, input.status, rawObject);
        if (insert === 0) throw new Error("stale task worker stopped during raw audit publication");
      }

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
      `SELECT result_json
       FROM audience.crawl_tasks
       WHERE run_id = $1 AND task_kind = 'fixture_discovery'
         AND status IN ('succeeded', 'blocked')
       ORDER BY created_at DESC
       LIMIT 1`,
      [runId],
    );
    const candidates = parseStagedCandidates(taskResult.rows[0]?.result_json);
    const rawResult = await this.database.query<RawFetchRow>(
      `SELECT object_key, checksum_sha256
       FROM audience.source_fetches
       WHERE run_id = $1 AND source_kind = 'list-org-browser'
       ORDER BY created_at, id`,
      [runId],
    );

    return {
      runId,
      status: run.status,
      terminalReason: run.terminal_reason,
      candidates,
      rawObjects: rawResult.rows.map(storedRawObject),
    };
  }

  async publishReplay(
    task: FencedTask,
    candidates: readonly DiscoveredCompany[],
  ): Promise<PublicationCounts | null> {
    return this.database.transaction(async (transaction) => {
      if (!await lockFence(transaction, task)) return null;

      for (const candidate of candidates) {
        const fetchResult = await transaction.query<{ id: string } & QueryResultRow>(
          `SELECT id
           FROM audience.source_fetches
           WHERE run_id = $1 AND source_kind = 'list-org-browser'
             AND checksum_sha256 = $2 AND source_record_key = $3
           ORDER BY created_at
           LIMIT 1`,
          [task.runId, candidate.rawFetchKey, candidate.sourceRecordKey],
        );
        const sourceFetchId = fetchResult.rows[0]?.id;
        if (sourceFetchId === undefined) throw new Error("staged candidate raw evidence is missing");

        await transaction.query(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.companies (
             inn, name, website, phone, email, source_fetch_id, source_record_key
           )
           SELECT $4, $5, $6, $7, $8, $9, $10 FROM fence
           ON CONFLICT (inn) DO UPDATE
           SET name = EXCLUDED.name,
               website = EXCLUDED.website,
               phone = EXCLUDED.phone,
               email = EXCLUDED.email,
               source_fetch_id = EXCLUDED.source_fetch_id,
               source_record_key = EXCLUDED.source_record_key,
               updated_at = now()
           WHERE (companies.name, companies.website, companies.phone, companies.email,
                  companies.source_fetch_id, companies.source_record_key)
             IS DISTINCT FROM
                 (EXCLUDED.name, EXCLUDED.website, EXCLUDED.phone, EXCLUDED.email,
                  EXCLUDED.source_fetch_id, EXCLUDED.source_record_key)`,
          [
            task.id, task.runId, task.fencingToken, candidate.inn, candidate.name,
            candidate.website, candidate.phone, candidate.email, sourceFetchId,
            candidate.sourceRecordKey,
          ],
        );
        await transaction.query(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.company_okveds (
             company_inn, okved_code, is_primary, source_fetch_id, source_record_key
           )
           SELECT $4, $5, $6, $7, $8 FROM fence
           ON CONFLICT (company_inn, okved_code) DO UPDATE
           SET is_primary = EXCLUDED.is_primary,
               source_fetch_id = EXCLUDED.source_fetch_id,
               source_record_key = EXCLUDED.source_record_key
           WHERE (company_okveds.is_primary, company_okveds.source_fetch_id,
                  company_okveds.source_record_key)
             IS DISTINCT FROM
                 (EXCLUDED.is_primary, EXCLUDED.source_fetch_id, EXCLUDED.source_record_key)`,
          [task.id, task.runId, task.fencingToken, candidate.inn, candidate.okvedCode,
            candidate.isPrimary, sourceFetchId, candidate.sourceRecordKey],
        );
        await transaction.query(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.run_company_matches (
             run_id, company_inn, matched_okved_code, source_fetch_id, source_record_key
           )
           SELECT $2, $4, $5, $6, $7 FROM fence
           ON CONFLICT (run_id, company_inn, matched_okved_code) DO UPDATE
           SET source_fetch_id = EXCLUDED.source_fetch_id,
               source_record_key = EXCLUDED.source_record_key
           WHERE (run_company_matches.source_fetch_id, run_company_matches.source_record_key)
             IS DISTINCT FROM (EXCLUDED.source_fetch_id, EXCLUDED.source_record_key)`,
          [task.id, task.runId, task.fencingToken, candidate.inn, candidate.okvedCode,
            sourceFetchId, candidate.sourceRecordKey],
        );
      }

      const counts = await publicationCounts(transaction, task.runId);
      const taskUpdate = await transaction.query(
        `UPDATE audience.crawl_tasks
         SET status = 'succeeded', result_json = $4::jsonb, lease_expires_at = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [task.id, task.runId, task.fencingToken, JSON.stringify(counts)],
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
      if (!await lockFence(transaction, input.task)) return false;
      await transaction.query("SET CONSTRAINTS ALL DEFERRED");

      for (const rawObject of input.rawObjects ?? []) {
        const inserted = await insertRawFetch(transaction, input.task, "running", rawObject);
        if (inserted === 0) throw new Error("stale task worker stopped during financial raw audit");
      }

      for (const evidence of input.evidence) {
        const sourceFetchId = await findFinancialSourceFetch(transaction, input.task.runId, evidence);
        const inserted = await transaction.query<{ id: string } & QueryResultRow>(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.financial_evidence (
             id, company_inn, report_year, metric, amount, source_fetch_id,
             source_record_key, parser_version
           )
           SELECT gen_random_uuid(), $4, $5, $6::audience.financial_metric,
                  $7::numeric, $8, $9, $10
           FROM fence
           ON CONFLICT (company_inn, report_year, metric, source_fetch_id, source_record_key)
           DO UPDATE SET amount = EXCLUDED.amount, parser_version = EXCLUDED.parser_version,
                         collected_at = now()
           RETURNING id`,
          [input.task.id, input.task.runId, input.task.fencingToken, evidence.inn,
            evidence.reportYear, evidence.metric, evidence.value, sourceFetchId,
            evidence.sourceRecordKey, evidence.parserVersion],
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
             result_json = $4::jsonb
         WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'`,
        [input.task.id, input.task.runId, input.task.fencingToken,
          JSON.stringify({ evidence: input.evidence.length })],
      );
      if (update.rowCount !== 1) {
        throw new Error("stale task worker stopped during financial task completion");
      }
      return true;
    });
  }

  async reconcile(runId: string): Promise<ReconciliationReport> {
    const result = await this.database.query<{
      status: CrawlStatus;
      terminal_reason: string | null;
      published_at: string | null;
      tasks: string;
      source_fetches: string;
      staged_companies: string;
      companies: string;
      company_okveds: string;
      run_company_matches: string;
    } & QueryResultRow>(
      `SELECT run.status, run.terminal_reason, run.published_at,
         (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = run.id)::text AS tasks,
         (SELECT count(*) FROM audience.source_fetches WHERE run_id = run.id)::text AS source_fetches,
         COALESCE((
           SELECT jsonb_array_length(task.result_json->'candidates')::text
           FROM audience.crawl_tasks task
           WHERE task.run_id = run.id AND task.task_kind = 'fixture_discovery'
           ORDER BY task.created_at DESC LIMIT 1
         ), '0') AS staged_companies,
         (SELECT count(DISTINCT company_inn) FROM audience.run_company_matches WHERE run_id = run.id)::text AS companies,
         (SELECT count(*) FROM audience.company_okveds relation
           WHERE EXISTS (SELECT 1 FROM audience.run_company_matches match
             WHERE match.run_id = run.id AND match.company_inn = relation.company_inn))::text AS company_okveds,
         (SELECT count(*) FROM audience.run_company_matches WHERE run_id = run.id)::text AS run_company_matches
       FROM audience.crawl_runs run WHERE run.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("crawl run does not exist");
    const report = {
      runId,
      status: row.status,
      terminalReason: row.terminal_reason,
      tasks: Number(row.tasks),
      sourceFetches: Number(row.source_fetches),
      stagedCompanies: Number(row.staged_companies),
      companies: Number(row.companies),
      companyOkveds: Number(row.company_okveds),
      runCompanyMatches: Number(row.run_company_matches),
      published: row.published_at !== null,
    };
    return {
      ...report,
      consistent: !report.published
        || (report.companies === report.stagedCompanies
          && report.companyOkveds === report.stagedCompanies
          && report.runCompanyMatches === report.stagedCompanies),
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
}
