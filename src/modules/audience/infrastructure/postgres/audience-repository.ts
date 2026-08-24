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
        await transaction.query(
          `WITH fence AS (
             SELECT 1 FROM audience.crawl_tasks
             WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
           )
           INSERT INTO audience.organization_evidence (
             id, company_inn, source_fetch_id, source_record_key, field_name,
             value_json, parser_version
           )
           SELECT gen_random_uuid(), $4, $5, $6, 'organization',
                  jsonb_build_object(
                    'name', $7::text,
                    'website', $8::text,
                    'phone', $9::text,
                    'email', $10::text,
                    'okvedCode', $11::text,
                    'isPrimary', $12::boolean
                  ),
                  $13
           FROM fence
           WHERE NOT EXISTS (
             SELECT 1 FROM audience.organization_evidence evidence
             WHERE evidence.company_inn = $4
               AND evidence.source_fetch_id = $5
               AND evidence.source_record_key = $6
               AND evidence.field_name = 'organization'
               AND evidence.parser_version = $13
           )`,
          [task.id, task.runId, task.fencingToken, candidate.inn, sourceFetchId,
            candidate.sourceRecordKey, candidate.name, candidate.website, candidate.phone,
            candidate.email, candidate.okvedCode, candidate.isPrimary, candidate.parserVersion],
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
      revenue: string;
      income: string;
      expenses: string;
      organizations_without_evidence: string;
      metrics_without_evidence: string;
      evidence_without_run_raw_checksum: string;
      projections_behind_newest_evidence: string;
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
                  evidence.collected_at DESC,
                  evidence.observed_at DESC NULLS LAST,
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
       SELECT run.status, run.terminal_reason, run.published_at,
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
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'revenue')::text AS revenue,
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'income')::text AS income,
         (SELECT count(DISTINCT (company_inn, report_year, metric))
          FROM current_financial_evidence WHERE metric = 'expenses')::text AS expenses,
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
            AND NOT (
              raw.source_kind = 'list-org-browser'
              AND (
                raw.source_record_key ~ '^page:[1-9][0-9]*$'
                OR EXISTS (
                  SELECT 1
                  FROM latest_discovery discovery,
                       jsonb_array_elements(discovery.result_json->'candidates') candidate
                  WHERE candidate->>'sourceRecordKey' = raw.source_record_key
                )
              )
            ))::text AS unexplained_source_fetches
       FROM audience.crawl_runs run WHERE run.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("crawl run does not exist");
    const discovery = {
      occurrences: Number(row.occurrences),
      uniqueSourceRecords: Number(row.unique_source_records),
      acceptedCompanies: Number(row.accepted_companies),
      duplicates: Number(row.duplicates),
      rejected: Number(row.rejected),
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
      - discovery.acceptedCompanies - discovery.duplicates - discovery.rejected;
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
    if (unexplainedSourceFetches !== 0) {
      violations.push(`unexplained source fetches: ${unexplainedSourceFetches}`);
    }
    if (!publicationConsistent) violations.push("published organization counts differ from staging");
    if (violations.length > 0) {
      throw new Error(`reconciliation failed: ${violations.join("; ")}`);
    }
    return { ...report, consistent: true };
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
