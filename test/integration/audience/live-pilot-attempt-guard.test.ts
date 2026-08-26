import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";

import { LIVE_PILOT_POLICY } from "../../../src/modules/audience/domain/live-pilot-policy";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import { PostgresDatabase } from "../../../src/shared/postgres/database";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../support/postgres";

describe("durable live-pilot attempt guard", () => {
  let temporary: TemporaryDatabase;
  let firstDatabase: PostgresDatabase;
  let secondDatabase: PostgresDatabase;

  beforeAll(async () => {
    temporary = await createTemporaryDatabase();
    await runner({
      databaseUrl: temporary.connectionString,
      dir: "migrations",
      direction: "up",
      migrationsTable: "okved_migrations",
      migrationsSchema: "public",
    });
    firstDatabase = new PostgresDatabase(temporary.connectionString);
    secondDatabase = new PostgresDatabase(temporary.connectionString);
  });

  afterAll(async () => {
    await firstDatabase?.close();
    await secondDatabase?.close();
    await temporary?.drop();
  });

  it("allows at most one of two concurrent callers to consume the exact reviewed scope", async () => {
    const input = {
      scopeKey: LIVE_PILOT_POLICY.scopeKey,
      commandContract: LIVE_PILOT_POLICY.command,
      policyChecksumSha256: LIVE_PILOT_POLICY.checksumSha256,
    } as const;

    const results = await Promise.all([
      new PostgresAudienceRepository(firstDatabase).acquireLivePilotAttempt(input),
      new PostgresAudienceRepository(secondDatabase).acquireLivePilotAttempt(input),
    ]);

    expect(results.sort()).toEqual([false, true]);
    const persisted = await firstDatabase.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.live_pilot_attempts WHERE scope_key = $1",
      [LIVE_PILOT_POLICY.scopeKey],
    );
    expect(persisted.rows[0]?.count).toBe("1");
  });

  it("rejects a replacement when an older crawl run already consumed the exact scope", async () => {
    await firstDatabase.query("DELETE FROM audience.live_pilot_attempts");
    await firstDatabase.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status
       ) VALUES (
         '00000000-0000-4000-8000-000000000026',
         $1::jsonb, 'list-org-live/1.0.0', 'list-org-live/1.0.0', 'failed'
       )`,
      [JSON.stringify(LIVE_PILOT_POLICY.runScope)],
    );

    await expect(new PostgresAudienceRepository(firstDatabase).acquireLivePilotAttempt({
      scopeKey: LIVE_PILOT_POLICY.scopeKey,
      commandContract: LIVE_PILOT_POLICY.command,
      policyChecksumSha256: LIVE_PILOT_POLICY.checksumSha256,
    })).resolves.toBe(false);
  });
});
