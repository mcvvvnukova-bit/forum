import type { Database } from "../../../../shared/postgres/database";
import { parseOkvedCode, type OkvedCode } from "../../domain/okved";
import type { OkvedRecord, OkvedRepository } from "../../application/import-selected-okveds";

interface OkvedRow {
  code: string;
  name: string;
  source_version: string;
  dataset_release_id: string;
}

export class PostgresOkvedRepository implements OkvedRepository {
  constructor(private readonly database: Database) {}

  async upsertMany(
    datasetReleaseId: string,
    rows: readonly Omit<OkvedRecord, "datasetReleaseId">[],
  ): Promise<number> {
    return this.database.transaction(async (transaction) => {
      let upserted = 0;

      for (const row of rows) {
        const result = await transaction.query(
          `INSERT INTO audience.okveds (code, name, source_version, dataset_release_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO UPDATE
             SET name = EXCLUDED.name,
                 source_version = EXCLUDED.source_version,
                 dataset_release_id = EXCLUDED.dataset_release_id,
                 updated_at = now()`,
          [row.code, row.name, row.sourceVersion, datasetReleaseId],
        );
        upserted += result.rowCount ?? 0;
      }

      return upserted;
    });
  }

  async find(code: OkvedCode): Promise<OkvedRecord | null> {
    const result = await this.database.query<OkvedRow>(
      `SELECT code, name, source_version, dataset_release_id
       FROM audience.okveds
       WHERE code = $1`,
      [code],
    );
    const row = result.rows[0];

    return row === undefined
      ? null
      : {
          code: parseOkvedCode(row.code),
          name: row.name,
          sourceVersion: row.source_version,
          datasetReleaseId: row.dataset_release_id,
        };
  }
}
