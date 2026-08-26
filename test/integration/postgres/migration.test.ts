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

    expect(await tableNames(client, "audience")).toEqual([
      "companies", "company_okveds", "crawl_runs", "crawl_tasks", "dataset_releases",
      "financial_evidence", "financial_observations", "live_pilot_attempts", "okveds",
      "organization_evidence", "raw_upload_intents", "run_company_matches", "source_fetches",
    ]);
    expect(await keyedConstraints(client, "p")).toEqual([
      "companies(inn)",
      "company_okveds(company_inn,okved_code)",
      "crawl_runs(id)",
      "crawl_tasks(id)",
      "dataset_releases(id)",
      "financial_evidence(id)",
      "financial_observations(company_inn,report_year)",
      "live_pilot_attempts(scope_key)",
      "okveds(code)",
      "organization_evidence(id)",
      "raw_upload_intents(id)",
      "run_company_matches(run_id,company_inn,matched_okved_code)",
      "source_fetches(id)",
    ]);
    expect(await keyedConstraints(client, "u")).toEqual([
      "dataset_releases(id,source_version)",
      "dataset_releases(source_kind,source_version)",
      "financial_evidence(company_inn,report_year,metric,source_fetch_id,source_record_key)",
      "financial_evidence(id,company_inn,report_year,metric,amount)",
      "raw_upload_intents(manifest_key)",
      "raw_upload_intents(run_id,source_kind,source_record_key,parser_version,plan_checksum_sha256)",
      "raw_upload_intents(source_fetch_id)",
      "source_fetches(raw_upload_intent_id)",
      "source_fetches(run_id,source_kind,source_record_key,checksum_sha256)",
    ]);
    expect(await foreignKeys(client)).toEqual([
      "companies(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "company_okveds(company_inn)->companies(inn):RESTRICT:false:false",
      "company_okveds(okved_code)->okveds(code):RESTRICT:false:false",
      "company_okveds(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "crawl_tasks(run_id)->crawl_runs(id):RESTRICT:false:false",
      "dataset_releases(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "financial_evidence(company_inn)->companies(inn):RESTRICT:false:false",
      "financial_evidence(dataset_release_id)->dataset_releases(id):RESTRICT:false:false",
      "financial_evidence(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "financial_observations(company_inn)->companies(inn):RESTRICT:false:false",
      "financial_observations(expenses_evidence_id,company_inn,report_year,expenses_metric,expenses)->financial_evidence(id,company_inn,report_year,metric,amount):RESTRICT:true:false",
      "financial_observations(income_evidence_id,company_inn,report_year,income_metric,income)->financial_evidence(id,company_inn,report_year,metric,amount):RESTRICT:true:false",
      "financial_observations(revenue_evidence_id,company_inn,report_year,revenue_metric,revenue)->financial_evidence(id,company_inn,report_year,metric,amount):RESTRICT:true:false",
      "okveds(dataset_release_id)->dataset_releases(id):RESTRICT:false:false",
      "okveds(dataset_release_id,source_version)->dataset_releases(id,source_version):RESTRICT:false:false",
      "organization_evidence(company_inn)->companies(inn):RESTRICT:false:false",
      "organization_evidence(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "raw_upload_intents(run_id)->crawl_runs(id):RESTRICT:false:false",
      "raw_upload_intents(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "raw_upload_intents(task_id)->crawl_tasks(id):RESTRICT:false:false",
      "run_company_matches(company_inn)->companies(inn):RESTRICT:false:false",
      "run_company_matches(matched_okved_code)->okveds(code):RESTRICT:false:false",
      "run_company_matches(run_id)->crawl_runs(id):RESTRICT:false:false",
      "run_company_matches(source_fetch_id)->source_fetches(id):RESTRICT:false:false",
      "source_fetches(raw_upload_intent_id)->raw_upload_intents(id):RESTRICT:false:false",
      "source_fetches(run_id)->crawl_runs(id):RESTRICT:false:false",
    ]);
    expect(await namedIndexColumns(client, [
      "crawl_tasks_run_id_status_idx",
      "financial_evidence_company_inn_report_year_idx",
      "raw_upload_intents_task_state_idx",
      "run_company_matches_run_id_idx",
      "source_fetches_run_id_idx",
    ])).toEqual([
      "crawl_tasks_run_id_status_idx(run_id,status)",
      "financial_evidence_company_inn_report_year_idx(company_inn,report_year)",
      "raw_upload_intents_task_state_idx(task_id,fencing_token,state)",
      "run_company_matches_run_id_idx(run_id)",
      "source_fetches_run_id_idx(run_id)",
    ]);
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
    await migrate("down");
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

async function keyedConstraints(databaseClient: Client, type: "p" | "u"): Promise<string[]> {
  const result = await databaseClient.query<{ description: string }>(
    `SELECT relation.relname || '(' ||
            string_agg(attribute.attname, ',' ORDER BY key_numbers.position) || ')' AS description
     FROM pg_constraint con
     JOIN pg_class relation ON relation.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN unnest(con.conkey) WITH ORDINALITY AS key_numbers(attnum, position) ON true
     JOIN pg_attribute attribute
       ON attribute.attrelid = relation.oid AND attribute.attnum = key_numbers.attnum
     WHERE namespace.nspname = 'audience' AND con.contype = $1
     GROUP BY con.oid, relation.relname
     ORDER BY description`,
    [type],
  );
  return result.rows.map((row) => row.description);
}

async function foreignKeys(databaseClient: Client): Promise<string[]> {
  const result = await databaseClient.query<{ description: string }>(
    `SELECT source.relname || '(' ||
            string_agg(source_column.attname, ',' ORDER BY source_key.position) || ')->' ||
            target.relname || '(' ||
            string_agg(target_column.attname, ',' ORDER BY source_key.position) || '):' ||
            CASE con.confdeltype
              WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
              WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION'
            END || ':' || con.condeferrable::text || ':' || con.condeferred::text AS description
     FROM pg_constraint con
     JOIN pg_class source ON source.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
     JOIN pg_class target ON target.oid = con.confrelid
     JOIN unnest(con.conkey) WITH ORDINALITY AS source_key(attnum, position) ON true
     JOIN unnest(con.confkey) WITH ORDINALITY AS target_key(attnum, position)
       ON target_key.position = source_key.position
     JOIN pg_attribute source_column
       ON source_column.attrelid = source.oid AND source_column.attnum = source_key.attnum
     JOIN pg_attribute target_column
       ON target_column.attrelid = target.oid AND target_column.attnum = target_key.attnum
     WHERE namespace.nspname = 'audience' AND con.contype = 'f'
     GROUP BY con.oid, source.relname, target.relname
     ORDER BY description`,
  );
  return result.rows.map((row) => row.description);
}

async function namedIndexColumns(databaseClient: Client, names: readonly string[]): Promise<string[]> {
  const result = await databaseClient.query<{ description: string }>(
    `SELECT index_relation.relname || '(' ||
            string_agg(attribute.attname, ',' ORDER BY key_numbers.position) || ')' AS description
     FROM pg_index index_definition
     JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid
     JOIN pg_class table_relation ON table_relation.oid = index_definition.indrelid
     JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
     JOIN unnest(index_definition.indkey) WITH ORDINALITY AS key_numbers(attnum, position) ON true
     JOIN pg_attribute attribute
       ON attribute.attrelid = table_relation.oid AND attribute.attnum = key_numbers.attnum
     WHERE namespace.nspname = 'audience' AND index_relation.relname = ANY($1::text[])
     GROUP BY index_relation.oid, index_relation.relname
     ORDER BY description`,
    [names],
  );
  return result.rows.map((row) => row.description);
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
