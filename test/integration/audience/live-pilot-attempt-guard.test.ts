import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";

import { executeLivePilot, type LivePilotFactories } from "../../../src/apps/browser-runner/run-live-pilot";
import type { AudienceRepository } from "../../../src/modules/audience/application/ports/audience-repository";
import type { RawObjectStorage } from "../../../src/modules/audience/application/ports/raw-object-storage";
import {
  LIVE_PILOT_POLICY,
  LIVE_PILOT_POLICY_V1,
  LIVE_PILOT_POLICY_V2_ACTIVE,
  type LivePilotActiveAuthorization,
  type LivePilotPolicy,
  type LivePilotPolicyDocument,
} from "../../../src/modules/audience/domain/live-pilot-policy";
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

  it("rejects an expired test-only policy before the fresh guard or any client factory is touched", async () => {
    const policy = activeTestPolicy("expired-before-construction", {
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
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
      repository: new Proxy({}, {
        get: () => { throw new Error("repository touched"); },
      }) as AudienceRepository,
      discoveryRawStorage: {} as RawObjectStorage,
      factories,
      testOnlyActivePolicy: policy,
    })).rejects.toThrow("LIVE_PILOT_AUTHORIZATION_EXPIRED");
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

  it("forbids selecting the historical active production snapshot through test-only injection", async () => {
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
      testOnlyActivePolicy: LIVE_PILOT_POLICY_V2_ACTIVE,
    })).rejects.toThrow("LIVE_PILOT_TEST_POLICY_FORBIDDEN");
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

  it("allows the preserved reviewed v2 scope exactly once after v1 history", async () => {
    await firstDatabase.query(
      `INSERT INTO audience.crawl_runs (
         id, scope_json, fixture_version, parser_version, status
       ) VALUES (
         '00000000-0000-4000-8000-000000000027',
         $1::jsonb, 'list-org-live/1.0.0', 'list-org-live/1.0.0', 'failed'
       )`,
      [JSON.stringify(LIVE_PILOT_POLICY_V1.runScope)],
    );
    const input = {
      scopeKey: LIVE_PILOT_POLICY_V2_ACTIVE.scopeKey,
      commandContract: LIVE_PILOT_POLICY_V2_ACTIVE.command,
      policyChecksumSha256: LIVE_PILOT_POLICY_V2_ACTIVE.checksumSha256,
    } as const;
    const results = await Promise.all([
      new PostgresAudienceRepository(firstDatabase).acquireLivePilotAttempt(input),
      new PostgresAudienceRepository(secondDatabase).acquireLivePilotAttempt(input),
    ]);

    expect(results.sort()).toEqual([false, true]);
    const v1AttemptRows = await attemptCount(LIVE_PILOT_POLICY_V1.scopeKey);
    const v2AttemptRows = await attemptCount(LIVE_PILOT_POLICY_V2_ACTIVE.scopeKey);
    const storedV2Checksum = await firstDatabase.query<{ policy_checksum_sha256: string }>(
      "SELECT policy_checksum_sha256 FROM audience.live_pilot_attempts WHERE scope_key = $1",
      [LIVE_PILOT_POLICY_V2_ACTIVE.scopeKey],
    );
    expect(v1AttemptRows).toBe("0");
    expect(v2AttemptRows).toBe("1");
    expect(storedV2Checksum.rows[0]?.policy_checksum_sha256).toBe(
      LIVE_PILOT_POLICY_V2_ACTIVE.checksumSha256,
    );
  });

  async function attemptCount(scopeKey: string): Promise<string | undefined> {
    const persisted = await firstDatabase.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audience.live_pilot_attempts WHERE scope_key = $1",
      [scopeKey],
    );
    return persisted.rows[0]?.count;
  }
});

function activeTestPolicy(
  label: string,
  authorizationPatch: Partial<Omit<LivePilotActiveAuthorization, "status">> = {},
): LivePilotPolicy {
  const { checksumSha256: _checksumSha256, ...reviewed } = LIVE_PILOT_POLICY_V2_ACTIVE;
  const authorization = {
    reviewedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-12-31T23:59:59.000Z",
    status: "active",
    ...authorizationPatch,
  } as const satisfies LivePilotActiveAuthorization;
  const policy: LivePilotPolicyDocument = {
    ...reviewed,
    scopeKey: `test-only/live-pilot/${label}`,
    authorization,
  } as const;
  return {
    ...policy,
    checksumSha256: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
  };
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
