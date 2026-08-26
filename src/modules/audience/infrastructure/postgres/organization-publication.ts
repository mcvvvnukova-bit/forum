import type { QueryResultRow } from "pg";

import type { FencedTask } from "../../application/ports/audience-repository";
import type { DiscoveredCompany } from "../../domain/discovery";
import type { Database } from "../../../../shared/postgres/database";

export async function publishOrganizationCandidates(
  database: Database,
  task: FencedTask,
  candidates: readonly DiscoveredCompany[],
): Promise<void> {
  for (const candidate of candidates) {
    const fetchResult = await database.query<{ id: string } & QueryResultRow>(
      `SELECT id
       FROM audience.source_fetches
       WHERE run_id = $1
         AND source_kind = CASE WHEN EXISTS (
           SELECT 1 FROM audience.crawl_tasks
           WHERE run_id = $1 AND task_kind = 'live_discovery'
         ) THEN 'list-org-live' ELSE 'list-org-browser' END
         AND checksum_sha256 = $2 AND source_record_key = $3
       ORDER BY created_at
       LIMIT 1`,
      [task.runId, candidate.rawFetchKey, candidate.sourceRecordKey],
    );
    const sourceFetchId = fetchResult.rows[0]?.id;
    if (sourceFetchId === undefined) throw new Error("staged candidate raw evidence is missing");

    await database.query(
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
              EXCLUDED.source_fetch_id, EXCLUDED.source_record_key)
         AND EXISTS (
           SELECT 1
           FROM audience.source_fetches incoming
           JOIN audience.source_fetches current ON current.id = companies.source_fetch_id
           WHERE incoming.id = EXCLUDED.source_fetch_id
             AND (incoming.captured_at, incoming.created_at, incoming.id)
               > (current.captured_at, current.created_at, current.id)
         )`,
      [
        task.id, task.runId, task.fencingToken, candidate.inn, candidate.name,
        candidate.website, candidate.phone, candidate.email, sourceFetchId,
        candidate.sourceRecordKey,
      ],
    );
    await database.query(
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
             (EXCLUDED.is_primary, EXCLUDED.source_fetch_id, EXCLUDED.source_record_key)
         AND EXISTS (
           SELECT 1
           FROM audience.source_fetches incoming
           JOIN audience.source_fetches current ON current.id = company_okveds.source_fetch_id
           WHERE incoming.id = EXCLUDED.source_fetch_id
             AND (incoming.captured_at, incoming.created_at, incoming.id)
               > (current.captured_at, current.created_at, current.id)
         )`,
      [task.id, task.runId, task.fencingToken, candidate.inn, candidate.okvedCode,
        candidate.isPrimary, sourceFetchId, candidate.sourceRecordKey],
    );
    await database.query(
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
    await database.query(
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
}
