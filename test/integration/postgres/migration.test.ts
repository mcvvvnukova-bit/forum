import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});

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
