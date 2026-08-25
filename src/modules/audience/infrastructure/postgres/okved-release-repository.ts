import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  OkvedReleaseRecord,
  OkvedReleaseRepository,
} from "../../application/release-selected-okveds";
import type { OkvedRecord } from "../../application/import-selected-okveds";
import type { Database } from "../../../../shared/postgres/database";
import { PostgresOkvedRepository } from "./okved-repository";

interface ExistingReleaseRow extends QueryResultRow {
  id: string;
  object_key: string;
  checksum_sha256: string;
}

export class PostgresOkvedReleaseRepository implements OkvedReleaseRepository {
  constructor(private readonly database: Database) {}

  publishRelease(input: {
    sourceVersion: string;
    objectKey: string;
    checksumSha256: string;
    capturedAt: string;
    rows: readonly Omit<OkvedRecord, "datasetReleaseId">[];
  }): Promise<OkvedReleaseRecord & { imported: number }> {
    return this.database.transaction(async (transaction) => {
      const release = await new PostgresOkvedReleaseRepository(transaction).ensureRelease(input);
      const imported = await new PostgresOkvedRepository(transaction).upsertMany(
        release.releaseId,
        input.rows,
      );
      return { ...release, imported };
    });
  }

  ensureRelease(input: {
    sourceVersion: string;
    objectKey: string;
    checksumSha256: string;
    capturedAt: string;
  }): Promise<OkvedReleaseRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`okved-csv:${input.sourceVersion}`],
      );
      const existing = await transaction.query<ExistingReleaseRow>(
        `SELECT release.id, raw.object_key, raw.checksum_sha256
         FROM audience.dataset_releases release
         JOIN audience.source_fetches raw ON raw.id = release.source_fetch_id
         WHERE release.source_kind = 'okved-csv' AND release.source_version = $1
         FOR UPDATE OF release, raw`,
        [input.sourceVersion],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (row.object_key !== input.objectKey || row.checksum_sha256 !== input.checksumSha256) {
          throw new Error("existing OKVED release provenance does not match upload");
        }
        return { releaseId: row.id, reused: true };
      }

      const runId = randomUUID();
      const sourceFetchId = randomUUID();
      const releaseId = randomUUID();
      await transaction.query(
        `INSERT INTO audience.crawl_runs (
           id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
         ) VALUES ($1, $2::jsonb, 'selected-okveds-fixture/1.0.0',
           'selected-okveds/1.0.0', 'succeeded', 'fixture_release', now())`,
        [runId, JSON.stringify({
          sourceVersion: input.sourceVersion,
          checksumSha256: input.checksumSha256,
          objectKey: input.objectKey,
        })],
      );
      await transaction.query(
        `INSERT INTO audience.source_fetches (
           id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
           mime_type, final_url, navigation_status, captured_at, parser_version
         ) VALUES ($1, $2, 'okved-csv', $3, $4, $5,
           'text/csv', $6, 200, $7, 'selected-okveds/1.0.0')`,
        [sourceFetchId, runId, `selected-okveds:${input.checksumSha256}`,
          input.objectKey, input.checksumSha256, `s3://${input.objectKey}`, input.capturedAt],
      );
      await transaction.query(
        `INSERT INTO audience.dataset_releases (
           id, source_kind, source_version, source_fetch_id, published_at,
           metadata_json
         ) VALUES ($1, 'okved-csv', $2, $3, now(), $4::jsonb)`,
        [releaseId, input.sourceVersion, sourceFetchId, JSON.stringify({
          checksumSha256: input.checksumSha256,
          objectKey: input.objectKey,
        })],
      );
      return { releaseId, reused: false };
    });
  }
}
