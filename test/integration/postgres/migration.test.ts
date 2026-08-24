import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { runner } from "node-pg-migrate";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

let database: TemporaryDatabase;
let client: Client;
let postgres: PostgresDatabase;

describe("audience core migration", () => {
  beforeAll(async () => {
    database = await createTemporaryDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
    postgres = new PostgresDatabase(database.connectionString);
  });

  afterAll(async () => {
    await postgres?.close();
    await client?.end();
    await database?.drop();
  });

  it("creates the owned schema and reverses it without touching the database", async () => {
    await migrate("up");

    expect(await tableNames(client, "audience")).toEqual(expect.arrayContaining([
      "crawl_runs", "crawl_tasks", "source_fetches", "dataset_releases",
      "companies", "okveds", "company_okveds", "run_company_matches",
      "organization_evidence", "financial_evidence", "financial_observations",
    ]));
    expect(await primaryKey(client, "audience", "company_okveds"))
      .toEqual(["company_inn", "okved_code"]);
    expect(await hasCheckConstraint(client, "audience", "companies", "inn ~ '^[0-9]{10}$'"))
      .toBe(true);
    expect(await hasConstraint(client, "audience", "source_fetches", "u", "run_id,source_kind,source_record_key,checksum_sha256"))
      .toBe(true);
    expect(await hasConstraint(client, "audience", "financial_evidence", "u", "company_inn,report_year,metric,source_fetch_id,source_record_key"))
      .toBe(true);
    expect(await financialColumnTypes(client)).toEqual([
      ["expenses", 18, 2],
      ["income", 18, 2],
      ["revenue", 18, 2],
    ]);

    await migrate("down");
    expect(await tableNames(client, "audience")).toEqual([]);

    await migrate("up");
    expect(await tableNames(client, "audience")).toContain("crawl_runs");
  });

  it("rolls back all work when a transaction fails", async () => {
    await expect(postgres.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO audience.crawl_runs (id, scope_json, fixture_version, parser_version)
         VALUES ($1, $2::jsonb, $3, $4)`,
        ["00000000-0000-0000-0000-000000000001", "{}", "fixture-v1", "parser-v1"],
      );
      throw new Error("deliberate rollback");
    })).rejects.toThrow("deliberate rollback");

    const result = await postgres.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.crawl_runs WHERE id = $1",
      ["00000000-0000-0000-0000-000000000001"],
    );
    expect(result.rows[0]?.count).toBe("0");
  });

  it("requires dataset and exact evidence provenance for normalized values", async () => {
    const fixture = await insertProvenanceFixture();

    await expect(client.query(
      `INSERT INTO audience.okveds (code, name, source_version)
       VALUES ('43.11', 'Разборка и снос зданий', 'ОКВЭД-2')`,
    )).rejects.toMatchObject({ code: "23502" });
    await expect(client.query(
      `INSERT INTO audience.okveds (code, name, source_version, dataset_release_id)
       VALUES ('43.11', 'Разборка и снос зданий', 'ОКВЭД-2', $1)`,
      [fixture.datasetReleaseId],
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(client.query(
      `INSERT INTO audience.okveds (code, name, source_version, dataset_release_id)
       VALUES ('43.12', 'Подготовка строительной площадки', 'несовпадающая версия', $1)`,
      [fixture.datasetReleaseId],
    )).rejects.toMatchObject({ code: "23503" });

    await expect(client.query(
      `INSERT INTO audience.financial_observations (company_inn, report_year, revenue)
       VALUES ($1, 2025, 0.00)`,
      [fixture.companyInn],
    )).rejects.toMatchObject({ code: "23514" });

    await insertFinancialEvidence(fixture, fixture.revenueEvidenceId, "revenue", 2025, "0.00");
    await expect(client.query(
      `INSERT INTO audience.financial_observations (
         company_inn, report_year, revenue, revenue_evidence_id
       ) VALUES ($1, 2025, 0.00, $2)`,
      [fixture.companyInn, fixture.revenueEvidenceId],
    )).resolves.toMatchObject({ rowCount: 1 });

    await expect(client.query(
      "UPDATE audience.financial_observations SET revenue = 1.00 WHERE company_inn = $1 AND report_year = 2025",
      [fixture.companyInn],
    )).rejects.toMatchObject({ code: "23503" });

    await expect(client.query(
      `INSERT INTO audience.financial_observations (
         company_inn, report_year, revenue, revenue_evidence_id
       ) VALUES ($1, 2026, 0.00, $2)`,
      [fixture.companyInn, fixture.revenueEvidenceId],
    )).rejects.toMatchObject({ code: "23503" });

    await insertFinancialEvidence(fixture, fixture.incomeEvidenceId, "income", 2025, "0.00");
    await expect(client.query(
      "UPDATE audience.financial_observations SET revenue_evidence_id = $1 WHERE company_inn = $2 AND report_year = 2025",
      [fixture.incomeEvidenceId, fixture.companyInn],
    )).rejects.toMatchObject({ code: "23503" });
  });
});

interface ProvenanceFixture {
  companyInn: string;
  sourceFetchId: string;
  datasetReleaseId: string;
  revenueEvidenceId: string;
  incomeEvidenceId: string;
}

async function insertProvenanceFixture(): Promise<ProvenanceFixture> {
  const runId = randomUUID();
  const sourceFetchId = randomUUID();
  const datasetReleaseId = randomUUID();
  const companyInn = "7707083893";

  await client.query(
    `INSERT INTO audience.crawl_runs (id, scope_json, fixture_version, parser_version)
     VALUES ($1, '{}'::jsonb, 'fixture-v1', 'parser-v1')`,
    [runId],
  );
  await client.query(
    `INSERT INTO audience.source_fetches (
       id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
       mime_type, final_url, navigation_status, captured_at, parser_version
     ) VALUES ($1, $2, 'fixture', 'record-1', 'raw/record-1', $3,
       'text/html', 'http://fixture.test/record-1', 200, now(), 'parser-v1')`,
    [sourceFetchId, runId, "a".repeat(64)],
  );
  await client.query(
    `INSERT INTO audience.dataset_releases (id, source_kind, source_version, source_fetch_id)
     VALUES ($1, 'okved', 'ОКВЭД-2', $2)`,
    [datasetReleaseId, sourceFetchId],
  );
  await client.query(
    `INSERT INTO audience.companies (
       inn, name, source_fetch_id, source_record_key
     ) VALUES ($1, 'АО Тест', $2, 'record-1')`,
    [companyInn, sourceFetchId],
  );

  return {
    companyInn,
    sourceFetchId,
    datasetReleaseId,
    revenueEvidenceId: randomUUID(),
    incomeEvidenceId: randomUUID(),
  };
}

async function insertFinancialEvidence(
  fixture: ProvenanceFixture,
  id: string,
  metric: "revenue" | "income",
  reportYear: number,
  amount: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audience.financial_evidence (
       id, company_inn, report_year, metric, amount, source_fetch_id,
       source_record_key, parser_version
     ) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, 'parser-v1')`,
    [id, fixture.companyInn, reportYear, metric, amount, fixture.sourceFetchId, `${metric}-${reportYear}`],
  );
}

async function migrate(direction: "up" | "down"): Promise<void> {
  await runner({
    databaseUrl: database.connectionString,
    dir: "migrations",
    direction,
    migrationsTable: "okved_migrations",
    migrationsSchema: "public",
  });
}

async function tableNames(databaseClient: Client, schema: string): Promise<string[]> {
  const result = await databaseClient.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
    [schema],
  );

  return result.rows.map((row) => row.table_name);
}

async function primaryKey(databaseClient: Client, schema: string, table: string): Promise<string[]> {
  const result = await databaseClient.query<{ column_name: string }>(
    `SELECT key_columns.attname AS column_name
     FROM pg_constraint con
     JOIN pg_class relation ON relation.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN unnest(con.conkey) WITH ORDINALITY AS key_numbers(attnum, position) ON true
     JOIN pg_attribute key_columns ON key_columns.attrelid = relation.oid AND key_columns.attnum = key_numbers.attnum
     WHERE namespace.nspname = $1 AND relation.relname = $2 AND con.contype = 'p'
     ORDER BY key_numbers.position`,
    [schema, table],
  );

  return result.rows.map((row) => row.column_name);
}

async function hasConstraint(
  databaseClient: Client,
  schema: string,
  table: string,
  type: "c" | "u",
  columns: string,
): Promise<boolean> {
  const result = await databaseClient.query<{ column_names: string }>(
    `SELECT string_agg(attribute.attname, ',' ORDER BY key_numbers.position) AS column_names
     FROM pg_constraint con
     JOIN pg_class relation ON relation.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     LEFT JOIN unnest(con.conkey) WITH ORDINALITY AS key_numbers(attnum, position) ON true
     LEFT JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key_numbers.attnum
     WHERE namespace.nspname = $1 AND relation.relname = $2 AND con.contype = $3
     GROUP BY con.oid
     HAVING string_agg(attribute.attname, ',' ORDER BY key_numbers.position) = $4`,
    [schema, table, type, columns],
  );

  return result.rowCount === 1;
}

async function hasCheckConstraint(
  databaseClient: Client,
  schema: string,
  table: string,
  expectedDefinition: string,
): Promise<boolean> {
  const result = await databaseClient.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con
     JOIN pg_class relation ON relation.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1 AND relation.relname = $2 AND con.contype = 'c'`,
    [schema, table],
  );

  return result.rows.some((row) => row.definition.includes(expectedDefinition));
}

async function financialColumnTypes(databaseClient: Client): Promise<readonly [string, number, number][]> {
  const result = await databaseClient.query<{
    column_name: string;
    numeric_precision: number;
    numeric_scale: number;
  }>(
    `SELECT column_name, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = 'audience'
       AND table_name = 'financial_observations'
       AND column_name IN ('revenue', 'income', 'expenses')
     ORDER BY column_name`,
  );

  return result.rows.map((row) => [row.column_name, row.numeric_precision, row.numeric_scale]);
}
