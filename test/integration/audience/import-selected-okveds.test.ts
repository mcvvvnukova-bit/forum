import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runner } from "node-pg-migrate";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { importSelectedOkveds } from "../../../src/modules/audience/application/import-selected-okveds";
import { parseOkvedCode } from "../../../src/modules/audience/domain/okved";
import { PostgresOkvedRepository } from "../../../src/modules/audience/infrastructure/postgres/okved-repository";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

const selectedCsvPath = new URL("../../../data/okved/selected-okveds.csv", import.meta.url);
const firstSourceVersion = "ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)";
const secondSourceVersion = "ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2) редакция 2";

let temporaryDatabase: TemporaryDatabase;
let database: PostgresDatabase;
let repository: PostgresOkvedRepository;
let firstDatasetReleaseId: string;
let secondDatasetReleaseId: string;

describe("importSelectedOkveds", () => {
  beforeAll(async () => {
    temporaryDatabase = await createTemporaryDatabase();
    await migrate(temporaryDatabase.connectionString);
    database = new PostgresDatabase(temporaryDatabase.connectionString);
    repository = new PostgresOkvedRepository(database);
    firstDatasetReleaseId = await insertDatasetRelease(database, firstSourceVersion);
    secondDatasetReleaseId = await insertDatasetRelease(database, secondSourceVersion);
  });

  afterAll(async () => {
    await database?.close();
    await temporaryDatabase?.drop();
  });

  it("inserts the selected code and later replaces its metadata without duplicating the code", async () => {
    const selectedCsv = await readFile(selectedCsvPath, "utf8");

    await expect(importSelectedOkveds(selectedCsv, repository, firstDatasetReleaseId)).resolves.toBe(1);
    expect(await repository.find(parseOkvedCode("43.11"))).toEqual({
      code: "43.11",
      name: "Разборка и снос зданий",
      sourceVersion: firstSourceVersion,
      datasetReleaseId: firstDatasetReleaseId,
    });

    const updatedCsv = [
      "code,name,source_version",
      `43.11,Обновлённое наименование,${secondSourceVersion}`,
      "",
    ].join("\n");

    await expect(importSelectedOkveds(updatedCsv, repository, secondDatasetReleaseId)).resolves.toBe(1);
    expect(await okvedCount(database)).toBe(1);
    expect(await repository.find(parseOkvedCode("43.11"))).toEqual({
      code: "43.11",
      name: "Обновлённое наименование",
      sourceVersion: secondSourceVersion,
      datasetReleaseId: secondDatasetReleaseId,
    });
  });

  it("leaves earlier rows unchanged when a later CSV row has noncanonical punctuation", async () => {
    const malformedCsv = [
      "code,name,source_version",
      `43.12,Подготовка строительной площадки,${secondSourceVersion}`,
      `4311,Неверный код,${secondSourceVersion}`,
      "",
    ].join("\n");

    await expect(importSelectedOkveds(malformedCsv, repository, secondDatasetReleaseId))
      .rejects.toThrow("canonical OKVED");
    expect(await okvedCount(database)).toBe(1);
    expect(await repository.find(parseOkvedCode("43.11"))).toEqual({
      code: "43.11",
      name: "Обновлённое наименование",
      sourceVersion: secondSourceVersion,
      datasetReleaseId: secondDatasetReleaseId,
    });
    expect(await repository.find(parseOkvedCode("43.12"))).toBeNull();
  });
});

async function insertDatasetRelease(database: PostgresDatabase, sourceVersion: string): Promise<string> {
  const runId = randomUUID();
  const sourceFetchId = randomUUID();
  const datasetReleaseId = randomUUID();

  await database.query(
    `INSERT INTO audience.crawl_runs (id, scope_json, fixture_version, parser_version)
     VALUES ($1, '{}'::jsonb, 'selected-okveds-fixture', 'test-parser')`,
    [runId],
  );
  await database.query(
    `INSERT INTO audience.source_fetches (
       id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
       mime_type, final_url, navigation_status, captured_at, parser_version
     ) VALUES ($1, $2, 'okved-csv', $3, $4, $5, 'text/csv', $6, 200, now(), 'test-parser')`,
    [sourceFetchId, runId, sourceVersion, `raw/okved/${sourceFetchId}.csv`, "a".repeat(64), "http://fixture.test/okved.csv"],
  );
  await database.query(
    `INSERT INTO audience.dataset_releases (id, source_kind, source_version, source_fetch_id)
     VALUES ($1, 'okved-csv', $2, $3)`,
    [datasetReleaseId, sourceVersion, sourceFetchId],
  );

  return datasetReleaseId;
}

async function okvedCount(database: PostgresDatabase): Promise<number> {
  const result = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audience.okveds",
  );
  return Number(result.rows[0]?.count);
}

async function migrate(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: "migrations",
    direction: "up",
    migrationsTable: "okved_migrations",
    migrationsSchema: "public",
  });
}
