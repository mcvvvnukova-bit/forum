import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";

import { executeLivePilot, type LivePilotFactories } from "../../../src/apps/browser-runner/run-live-pilot";
import type { AudienceRepository } from "../../../src/modules/audience/application/ports/audience-repository";
import type { RawObjectStorage } from "../../../src/modules/audience/application/ports/raw-object-storage";
import { LIVE_PILOT_POLICY } from "../../../src/modules/audience/domain/live-pilot-policy";
import { PostgresAudienceRepository } from "../../../src/modules/audience/infrastructure/postgres/audience-repository";
import type { AppEnv } from "../../../src/shared/config/env";
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

  it("rejects the consumed production policy before the fresh guard or any client factory is touched", async () => {
    const repository = new PostgresAudienceRepository(firstDatabase);
    const factories = new Proxy({
      endpoints: {
        listOrgSearchUrl: "http://127.0.0.1:1/search",
        bfoSearchUrl: "http://127.0.0.1:1/",
        revexpMetadataUrl: "http://127.0.0.1:1/revexp/",
      },
    }, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        throw new Error(`client factory touched: ${String(property)}`);
      },
    }) as LivePilotFactories;
    const env: AppEnv = {
      appMode: "live",
      databaseUrl: "postgresql://okved:okved@127.0.0.1:5433/okved",
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: "okved-raw",
      s3AccessKeyId: "unused",
      s3SecretAccessKey: "unused",
      listOrgLiveEnabled: true,
      fnsLiveEnabled: true,
    };

    await expect(executeLivePilot({
      env,
      repository,
      discoveryRawStorage: {} as RawObjectStorage,
      factories,
    })).rejects.toThrow("LIVE_PILOT_AUTHORIZATION_CONSUMED");

    const persisted = await firstDatabase.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.live_pilot_attempts WHERE scope_key = $1",
      [LIVE_PILOT_POLICY.scopeKey],
    );
    expect(persisted.rows[0]?.count).toBe("0");
  });

  it("rejects a test-only active policy whose reviewed document checksum was changed", async () => {
    const policy = activeTestPolicy("tampered-checksum");
    const env: AppEnv = {
      appMode: "fixture",
      databaseUrl: temporary.connectionString,
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: "unused",
      s3AccessKeyId: "unused",
      s3SecretAccessKey: "unused",
      listOrgLiveEnabled: false,
      fnsLiveEnabled: false,
    };

    await expect(executeLivePilot({
      env,
      repository: new Proxy({}, {
        get: () => { throw new Error("repository touched"); },
      }) as AudienceRepository,
      discoveryRawStorage: {} as RawObjectStorage,
      factories: loopbackFactoryAccessTrap(),
      testOnlyActivePolicy: { ...policy, owner: "tampered after review" },
    })).rejects.toThrow("LIVE_PILOT_POLICY_CHECKSUM_MISMATCH");
  });

  it("allows at most one of two concurrent callers to consume the exact reviewed scope", async () => {
    const policy = activeTestPolicy("concurrent-one-shot");
    const input = {
      scopeKey: policy.scopeKey,
      commandContract: policy.command,
      policyChecksumSha256: policy.checksumSha256,
    } as const;

    const results = await Promise.all([
      new PostgresAudienceRepository(firstDatabase).acquireLivePilotAttempt(input),
      new PostgresAudienceRepository(secondDatabase).acquireLivePilotAttempt(input),
    ]);

    expect(results.sort()).toEqual([false, true]);
    const persisted = await firstDatabase.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.live_pilot_attempts WHERE scope_key = $1",
      [policy.scopeKey],
    );
    expect(persisted.rows[0]?.count).toBe("1");

    await expect(new PostgresAudienceRepository(firstDatabase).acquireLivePilotAttempt({
      scopeKey: policy.scopeKey,
      commandContract: policy.command,
      policyChecksumSha256: policy.checksumSha256,
    })).resolves.toBe(false);
  });

  it("allows a separately reviewed future policy exactly once despite a historical consumed run", async () => {
    await firstDatabase.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status
       ) VALUES (
         '00000000-0000-4000-8000-000000000027',
         $1::jsonb, 'list-org-live/1.0.0', 'list-org-live/1.0.0', 'failed'
       )`,
      [JSON.stringify(LIVE_PILOT_POLICY.runScope)],
    );
    const policy = activeTestPolicy("future-reviewed-policy");
    const repository = new PostgresAudienceRepository(firstDatabase);
    const input = {
      scopeKey: policy.scopeKey,
      commandContract: policy.command,
      policyChecksumSha256: policy.checksumSha256,
    } as const;

    await expect(repository.acquireLivePilotAttempt(input)).resolves.toBe(true);
    await expect(repository.acquireLivePilotAttempt(input)).resolves.toBe(false);
  });
});

function activeTestPolicy(label: string) {
  const { checksumSha256: _checksumSha256, ...reviewed } = LIVE_PILOT_POLICY;
  const policy = {
    ...reviewed,
    scopeKey: `test-only/live-pilot/${label}`,
    authorization: {
      reviewedAt: "2026-08-27",
      status: "active",
    },
  } as const;
  return {
    ...policy,
    checksumSha256: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
  } as const;
}

function loopbackFactoryAccessTrap(): LivePilotFactories {
  return new Proxy({
    endpoints: {
      listOrgSearchUrl: "http://127.0.0.1:1/search",
      bfoSearchUrl: "http://127.0.0.1:1/",
      revexpMetadataUrl: "http://127.0.0.1:1/revexp/",
    },
  }, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      throw new Error(`client factory touched: ${String(property)}`);
    },
  }) as LivePilotFactories;
}
