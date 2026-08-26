import type { QueryResultRow } from "pg";

import type {
  CapturedRawObject,
  CrawlStatus,
  FencedTask,
  PublicationCounts,
} from "../../application/ports/audience-repository";
import type { StoredBrowserRawObject } from "../../application/ports/raw-object-storage";
import type { DiscoveredCompany } from "../../domain/discovery";
import type { FinancialMetricEvidence } from "../../domain/financial";
import { parseLegalEntityInn } from "../../domain/inn";
import { parseOkvedCode } from "../../domain/okved";
import type { Database } from "../../../../shared/postgres/database";

interface TaskRow extends QueryResultRow {
  id: string;
  run_id: string;
  task_kind: string;
  fencing_token: string;
}

export function isDiscoveryTaskKind(value: string): value is "fixture_discovery" | "live_discovery" {
  return value === "fixture_discovery" || value === "live_discovery";
}

export interface RawFetchRow extends QueryResultRow {
  run_id: string;
  source_kind: string;
  source_record_key: string;
  parser_version: string;
  object_key: string;
  checksum_sha256: string;
}

export async function acquire(
  database: Database,
  taskId: string,
  leaseSeconds: number,
): Promise<FencedTask | null> {
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
    throw new Error("lease seconds must be a positive safe integer");
  }
  const result = await database.query<TaskRow>(
    `UPDATE audience.crawl_tasks
     SET status = 'running', attempts = attempts + 1, fencing_token = fencing_token + 1,
         lease_expires_at = now() + make_interval(secs => $2::integer), updated_at = now()
     WHERE id = $1
       AND (status = 'pending' OR (status = 'running' AND lease_expires_at <= now()))
     RETURNING id, run_id, task_kind, fencing_token::text`,
    [taskId, leaseSeconds],
  );
  const row = result.rows[0];
  return row === undefined ? null : {
    id: row.id,
    runId: row.run_id,
    taskKind: row.task_kind,
    fencingToken: Number(row.fencing_token),
  };
}

export async function insertRawFetch(
  database: Database,
  task: FencedTask,
  status: CrawlStatus,
  raw: CapturedRawObject,
): Promise<number> {
  if (raw.stored.runId !== task.runId
    || raw.stored.sourceKind !== raw.sourceKind
    || raw.stored.sourceRecordKey !== raw.sourceRecordKey
    || raw.stored.parserVersion !== raw.parserVersion
    || (raw.stored.kind === "file" && raw.stored.mimeType !== raw.mimeType)) {
    throw new Error("stored raw identity does not match source audit");
  }
  const result = await database.query(
    `WITH fence AS (
       SELECT 1 FROM audience.crawl_tasks
       WHERE id = $1 AND run_id = $2 AND fencing_token = $3
         AND status = $4::audience.crawl_status
     )
     INSERT INTO audience.source_fetches (
       id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
       mime_type, final_url, navigation_status, captured_at, parser_version
     )
     SELECT $5, $2, $6, $7, $8, $9, $10, $11, $12, $13, $14
     FROM fence
     ON CONFLICT (run_id, source_kind, source_record_key, checksum_sha256)
     DO UPDATE SET object_key = EXCLUDED.object_key`,
    [task.id, task.runId, task.fencingToken, status, raw.id, raw.sourceKind,
      raw.sourceRecordKey, raw.stored.manifestKey, raw.stored.checksumSha256,
      raw.mimeType, raw.finalUrl, raw.navigationStatus, raw.capturedAt, raw.parserVersion],
  );
  return result.rowCount ?? 0;
}

export function storedRawObject(row: RawFetchRow): StoredBrowserRawObject {
  const suffix = "/manifest.json";
  if (!row.object_key.endsWith(suffix)) throw new Error("stored raw manifest key is invalid");
  const prefix = row.object_key.slice(0, -suffix.length);
  return {
    kind: "browser",
    runId: row.run_id,
    sourceKind: row.source_kind,
    sourceRecordKey: row.source_record_key,
    parserVersion: row.parser_version,
    checksumSha256: row.checksum_sha256,
    prefix,
    manifestKey: row.object_key,
    domKey: `${prefix}/dom.html`,
    screenshotKey: `${prefix}/screenshot.png`,
  };
}

export function parseStagedCandidates(value: unknown): readonly DiscoveredCompany[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.candidates)) {
    throw new Error("run has no staged discovery candidates");
  }
  return value.candidates.map((candidate) => parseStagedCandidate(candidate));
}

export async function lockFence(database: Database, task: FencedTask): Promise<boolean> {
  const result = await database.query(
    `SELECT id FROM audience.crawl_tasks
     WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
     FOR UPDATE`,
    [task.id, task.runId, task.fencingToken],
  );
  return result.rowCount === 1;
}

export async function publicationCounts(
  database: Database,
  runId: string,
): Promise<PublicationCounts> {
  const result = await database.query<{
    companies: string;
    company_okveds: string;
    run_company_matches: string;
  } & QueryResultRow>(
    `SELECT
       (SELECT count(DISTINCT company_inn) FROM audience.run_company_matches WHERE run_id = $1)::text AS companies,
       (SELECT count(*) FROM audience.run_company_matches match
         JOIN audience.company_okveds relation
           ON relation.company_inn = match.company_inn
              AND relation.okved_code = match.matched_okved_code
         WHERE match.run_id = $1)::text AS company_okveds,
       (SELECT count(*) FROM audience.run_company_matches WHERE run_id = $1)::text AS run_company_matches`,
    [runId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("publication counts query returned no row");
  return {
    companies: Number(row.companies),
    companyOkveds: Number(row.company_okveds),
    runCompanyMatches: Number(row.run_company_matches),
  };
}

export async function findFinancialSourceFetch(
  database: Database,
  runId: string,
  evidence: FinancialMetricEvidence,
  requireExactSourceRecordKey = false,
): Promise<string> {
  const mapping = {
    revenue: "fns_bfo",
    income: "fns_revexp",
    expenses: "fns_revexp",
  } as const;
  if (evidence.sourceKind !== mapping[evidence.metric]) {
    throw new Error("financial source mapping does not match metric");
  }
  const rawSourceMatchesMetric = evidence.metric === "revenue"
    ? evidence.rawSourceKind === "fns-bfo" || evidence.rawSourceKind === "fns-bfo-live"
    : evidence.rawSourceKind === "fns-revexp";
  if (!rawSourceMatchesMetric) {
    throw new Error("financial raw source mapping does not match metric");
  }
  const result = await database.query<{ id: string } & QueryResultRow>(
    `SELECT id FROM audience.source_fetches
     WHERE run_id = $1
       AND (object_key = $2 OR checksum_sha256 = $2)
       AND source_kind = $3
       AND parser_version = $4
       AND ($5::boolean = false OR source_record_key = $6)
     ORDER BY created_at DESC LIMIT 1`,
    [runId, evidence.rawFetchKey, evidence.rawSourceKind, evidence.parserVersion,
      requireExactSourceRecordKey, evidence.sourceRecordKey],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("financial raw evidence is missing");
  return id;
}

export async function projectFinancialMetric(
  database: Database,
  task: FencedTask,
  evidence: FinancialMetricEvidence,
  evidenceId: string,
): Promise<void> {
  const columns = {
    revenue: ["revenue", "revenue_evidence_id"],
    income: ["income", "income_evidence_id"],
    expenses: ["expenses", "expenses_evidence_id"],
  } as const;
  // The discriminated metric union selects identifiers from this closed map;
  // all external values remain parameterized below.
  const [valueColumn, evidenceColumn] = columns[evidence.metric];
  const result = await database.query<{ fenced: boolean } & QueryResultRow>(
    `WITH fence AS (
       SELECT 1 FROM audience.crawl_tasks
       WHERE id = $1 AND run_id = $2 AND fencing_token = $3 AND status = 'running'
     ), projection AS (
       INSERT INTO audience.financial_observations (
         company_inn, report_year, ${valueColumn}, ${evidenceColumn}
       )
       SELECT $4, $5, $6::numeric, $7 FROM fence
       ON CONFLICT (company_inn, report_year) DO UPDATE
       SET ${valueColumn} = EXCLUDED.${valueColumn},
           ${evidenceColumn} = EXCLUDED.${evidenceColumn},
           updated_at = now()
       WHERE audience.financial_observations.${evidenceColumn} IS NULL
          OR EXISTS (
            SELECT 1
            FROM audience.financial_evidence incoming
            JOIN audience.financial_evidence current
              ON current.id = audience.financial_observations.${evidenceColumn}
            WHERE incoming.id = $7
              AND (
                incoming.id = current.id
                OR ROW(incoming.observed_at, incoming.source_record_key, incoming.id)
                   > ROW(
                     COALESCE(current.observed_at, '-infinity'::timestamptz),
                     current.source_record_key,
                     current.id
                   )
              )
          )
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM fence) AS fenced,
            (SELECT count(*) FROM projection) AS projected`,
    [task.id, task.runId, task.fencingToken, evidence.inn, evidence.reportYear,
      evidence.value, evidenceId],
  );
  if (result.rows[0]?.fenced !== true) {
    throw new Error("stale task worker stopped during financial publication");
  }
}

function parseStagedCandidate(value: unknown): DiscoveredCompany {
  if (!isRecord(value)
    || typeof value.sourceRecordKey !== "string" || !/^[0-9]+$/.test(value.sourceRecordKey)
    || typeof value.inn !== "string"
    || typeof value.name !== "string" || value.name.trim() === ""
    || !nullableString(value.website) || !nullableString(value.phone) || !nullableString(value.email)
    || typeof value.okvedCode !== "string"
    || typeof value.isPrimary !== "boolean"
    || typeof value.rawFetchKey !== "string" || !/^[0-9a-f]{64}$/.test(value.rawFetchKey)
    || typeof value.parserVersion !== "string" || value.parserVersion.trim() === "") {
    throw new Error("staged discovery candidate is invalid");
  }
  try {
    return {
      sourceRecordKey: value.sourceRecordKey,
      inn: parseLegalEntityInn(value.inn),
      name: value.name,
      website: value.website,
      phone: value.phone,
      email: value.email,
      okvedCode: parseOkvedCode(value.okvedCode),
      isPrimary: value.isPrimary,
      rawFetchKey: value.rawFetchKey,
      parserVersion: value.parserVersion,
    };
  } catch {
    throw new Error("staged discovery candidate is invalid");
  }
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
