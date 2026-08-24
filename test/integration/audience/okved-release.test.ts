import { createHash, randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { releaseSelectedOkvedDataset } from "../../../src/modules/audience/application/release-selected-okveds";
import { PostgresOkvedReleaseRepository } from "../../../src/modules/audience/infrastructure/postgres/okved-release-repository";
import { S3ImmutableObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-immutable-object-storage";
import type { AppEnv } from "../../../src/shared/config/env";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("selected OKVED release", () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: PostgresDatabase;
  let env: AppEnv;
  let client: S3Client;

  beforeAll(async () => {
    temporaryDatabase = await createTemporaryDatabase();
    await runner({
      databaseUrl: temporaryDatabase.connectionString,
      dir: "migrations",
      direction: "up",
      migrationsTable: "okved_migrations",
      migrationsSchema: "public",
    });
    database = new PostgresDatabase(temporaryDatabase.connectionString);
    env = {
      appMode: "fixture",
      databaseUrl: temporaryDatabase.connectionString,
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: `okved-release-${randomUUID()}`,
      s3AccessKeyId: "okved-local",
      s3SecretAccessKey: "okved-local-secret",
      listOrgLiveEnabled: false,
    };
    client = s3Client(env);
    await client.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  });

  afterAll(async () => {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: env.s3Bucket }));
    const objects = (listed.Contents ?? []).flatMap((item) =>
      item.Key === undefined ? [] : [{ Key: item.Key }]
    );
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: env.s3Bucket, Delete: { Objects: objects } }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: env.s3Bucket }));
    client.destroy();
    await database.close();
    await temporaryDatabase.drop();
  });

  it("creates a checksum-addressed immutable release and exactly reuses it", async () => {
    const bytes = csvBytes("43.11", "Работы строительные подготовительные");
    const storage = new S3ImmutableObjectStorage(env);
    const repository = new PostgresOkvedReleaseRepository(database);
    try {
      const first = await releaseSelectedOkvedDataset(bytes, {
        sourceVersion: "test-okved-release/first",
      }, { storage, repository });
      const second = await releaseSelectedOkvedDataset(bytes, {
        sourceVersion: "test-okved-release/first",
      }, { storage, repository });

      expect(first).toMatchObject({
        reused: false,
        checksumSha256: sha256(bytes),
        objectKey: `raw/okved-csv/${sha256(bytes)}/selected-okveds.csv`,
      });
      expect(second).toEqual({ ...first, reused: true });
      const audit = await database.query<{ releases: string; fetches: string; runs: string }>(
        `SELECT
           (SELECT count(*) FROM audience.dataset_releases
            WHERE source_kind = 'okved-csv' AND source_version = $1)::text AS releases,
           (SELECT count(*) FROM audience.source_fetches
            WHERE source_kind = 'okved-csv' AND checksum_sha256 = $2)::text AS fetches,
           (SELECT count(*) FROM audience.crawl_runs
            WHERE terminal_reason = 'fixture_release' AND scope_json->>'sourceVersion' = $1)::text AS runs`,
        ["test-okved-release/first", sha256(bytes)],
      );
      expect(audit.rows[0]).toEqual({ releases: "1", fetches: "1", runs: "1" });
      const stored = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: first.objectKey }));
      expect(await stored.Body?.transformToByteArray()).toEqual(bytes);
    } finally {
      storage.close();
    }
  });

  it("rejects an immutable object collision before creating release provenance", async () => {
    const bytes = csvBytes("43.12", "Подготовка строительной площадки");
    const checksum = sha256(bytes);
    const objectKey = `raw/okved-csv/${checksum}/selected-okveds.csv`;
    await client.send(new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: objectKey,
      Body: "different existing bytes",
    }));
    const storage = new S3ImmutableObjectStorage(env);
    try {
      await expect(releaseSelectedOkvedDataset(bytes, {
        sourceVersion: "test-okved-release/collision",
      }, {
        storage,
        repository: new PostgresOkvedReleaseRepository(database),
      })).rejects.toThrow(`immutable object collision at ${objectKey}`);
      const release = await database.query(
        "SELECT id FROM audience.dataset_releases WHERE source_version = $1",
        ["test-okved-release/collision"],
      );
      expect(release.rowCount).toBe(0);
    } finally {
      storage.close();
    }
  });

  it("rejects an object key whose checksum segment does not match its bytes", async () => {
    const storage = new S3ImmutableObjectStorage(env);
    try {
      await expect(storage.putImmutable(
        `raw/okved-csv/${"a".repeat(64)}/selected-okveds.csv`,
        csvBytes("43.14", "Подготовительная fixture запись"),
        "text/csv; charset=utf-8",
      )).rejects.toThrow("selected OKVED object key checksum does not match bytes");
    } finally {
      storage.close();
    }
  });

  it("rejects reuse when the existing DB release points at a different checksum and object key", async () => {
    const sourceVersion = "test-okved-release/wrong-provenance";
    const runId = randomUUID();
    const fetchId = randomUUID();
    await database.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
       ) VALUES ($1, $2::jsonb, 'selected-okveds-fixture/1.0.0',
         'selected-okveds/1.0.0', 'succeeded', 'fixture_release', now())`,
      [runId, JSON.stringify({ sourceVersion })],
    );
    await database.query(
      `INSERT INTO audience.source_fetches (
         id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
         mime_type, final_url, navigation_status, captured_at, parser_version
       ) VALUES ($1, $2, 'okved-csv', 'selected-okveds', $3, $4,
         'text/csv', $5, 200, now(), 'selected-okveds/1.0.0')`,
      [fetchId, runId, "raw/okved-csv/wrong/selected-okveds.csv", "f".repeat(64),
        "s3://fixture/raw/okved-csv/wrong/selected-okveds.csv"],
    );
    await database.query(
      `INSERT INTO audience.dataset_releases (
         id, source_kind, source_version, source_fetch_id, published_at
       ) VALUES ($1, 'okved-csv', $2, $3, now())`,
      [randomUUID(), sourceVersion, fetchId],
    );

    const storage = new S3ImmutableObjectStorage(env);
    try {
      await expect(releaseSelectedOkvedDataset(
        csvBytes("43.13", "Разведочное бурение"),
        { sourceVersion },
        { storage, repository: new PostgresOkvedReleaseRepository(database) },
      )).rejects.toThrow("existing OKVED release provenance does not match upload");
    } finally {
      storage.close();
    }
  });
});

function csvBytes(code: string, name: string): Uint8Array {
  return new TextEncoder().encode(`code,name,source_version\n${code},${name},fixture\n`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function s3Client(env: AppEnv): S3Client {
  return new S3Client({
    endpoint: env.s3Endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
  });
}
