import { readFile } from "node:fs/promises";

import { importSelectedOkveds } from "../../modules/audience/application/import-selected-okveds";
import { releaseSelectedOkvedDataset } from "../../modules/audience/application/release-selected-okveds";
import { PostgresOkvedReleaseRepository } from "../../modules/audience/infrastructure/postgres/okved-release-repository";
import { PostgresOkvedRepository } from "../../modules/audience/infrastructure/postgres/okved-repository";
import { S3ImmutableObjectStorage } from "../../modules/audience/infrastructure/storage/s3-immutable-object-storage";
import { parseEnv } from "../../shared/config/env";
import { PostgresDatabase } from "../../shared/postgres/database";

const SOURCE_VERSION = "ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)";

const env = parseEnv(process.env);
if (env.appMode !== "fixture" || env.listOrgLiveEnabled) {
  throw new Error("selected OKVED fixture release requires fixture-only mode");
}
const path = process.argv[2] ?? "data/okved/selected-okveds.csv";
const bytes = await readFile(path);
const database = new PostgresDatabase(env.databaseUrl);
const storage = new S3ImmutableObjectStorage(env);

try {
  await storage.ensureBucket();
  const released = await releaseSelectedOkvedDataset(bytes, {
    sourceVersion: SOURCE_VERSION,
  }, {
    storage,
    repository: new PostgresOkvedReleaseRepository(database),
  });
  const imported = await importSelectedOkveds(
    bytes.toString("utf8"),
    new PostgresOkvedRepository(database),
    released.releaseId,
  );
  console.log(JSON.stringify({ ok: true, result: { ...released, imported } }));
} catch {
  console.error(JSON.stringify({ ok: false, error: "selected OKVED release failed" }));
  process.exitCode = 1;
} finally {
  try {
    storage.close();
  } finally {
    await database.close();
  }
}
