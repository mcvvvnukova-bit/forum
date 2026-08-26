import { describe, expect, it } from "vitest";
import { assertAudienceCommandActivation, parseEnv } from "../../../../src/shared/config/env";

const validEnvironment = {
  APP_MODE: "live",
  DATABASE_URL: "postgresql://app:password@127.0.0.1:5433/okved",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "okved-raw",
  S3_ACCESS_KEY_ID: "okved-local",
  S3_SECRET_ACCESS_KEY: "local-secret",
};

describe("parseEnv", () => {
  it("rejects a live source in the fixture runtime", () => {
    expect(() => parseEnv({ APP_MODE: "fixture", LIST_ORG_LIVE_ENABLED: "true" }))
      .toThrow("live List-Org is forbidden in fixture mode");
  });

  it("rejects either enabled live source in the fixture runtime", () => {
    expect(() => parseEnv({ APP_MODE: "fixture", FNS_LIVE_ENABLED: "true" }))
      .toThrow("live FNS is forbidden in fixture mode");
  });

  it("requires PostgreSQL and S3 coordinates", () => {
    expect(() => parseEnv({ APP_MODE: "fixture" })).toThrow("DATABASE_URL");
  });

  it.each([
    ["APP_MODE", { ...validEnvironment, APP_MODE: undefined }],
    ["S3_ENDPOINT", { ...validEnvironment, S3_ENDPOINT: undefined }],
    ["S3_BUCKET", { ...validEnvironment, S3_BUCKET: undefined }],
    ["S3_ACCESS_KEY_ID", { ...validEnvironment, S3_ACCESS_KEY_ID: undefined }],
    ["S3_SECRET_ACCESS_KEY", { ...validEnvironment, S3_SECRET_ACCESS_KEY: undefined }],
  ])("requires %s", (name, input) => {
    expect(() => parseEnv(input)).toThrow(name);
  });

  it("rejects an unsupported application mode", () => {
    expect(() => parseEnv({ ...validEnvironment, APP_MODE: "staging" }))
      .toThrow("APP_MODE must be fixture or live");
  });

  it("defaults the live source gate to disabled", () => {
    expect(parseEnv(validEnvironment)).toEqual({
      appMode: "live",
      databaseUrl: "postgresql://app:password@127.0.0.1:5433/okved",
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: "okved-raw",
      s3AccessKeyId: "okved-local",
      s3SecretAccessKey: "local-secret",
      listOrgLiveEnabled: false,
      fnsLiveEnabled: false,
    });
  });

  it.each([
    ["LIST_ORG_LIVE_ENABLED", { ...validEnvironment, LIST_ORG_LIVE_ENABLED: "yes" }],
    ["FNS_LIVE_ENABLED", { ...validEnvironment, FNS_LIVE_ENABLED: "1" }],
  ])("strictly parses %s", (name, input) => {
    expect(() => parseEnv(input)).toThrow(`${name} must be true or false`);
  });

  it.each([
    ["fixture mode", { ...validEnvironment, APP_MODE: "fixture" }],
    ["List-Org disabled", { ...validEnvironment, LIST_ORG_LIVE_ENABLED: "false", FNS_LIVE_ENABLED: "true" }],
    ["FNS disabled", { ...validEnvironment, LIST_ORG_LIVE_ENABLED: "true", FNS_LIVE_ENABLED: "false" }],
  ])("requires all three live activation gates when %s", (_case, input) => {
    expect(() => assertAudienceCommandActivation(
      { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
      parseEnv(input),
    )).toThrow("live pilot requires APP_MODE=live, LIST_ORG_LIVE_ENABLED=true, and FNS_LIVE_ENABLED=true");
  });

  it("permits the live pilot only when all three live activation gates are enabled", () => {
    expect(() => assertAudienceCommandActivation(
      { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
      parseEnv({ ...validEnvironment, LIST_ORG_LIVE_ENABLED: "true", FNS_LIVE_ENABLED: "true" }),
    )).not.toThrow();
  });

  it.each([
    ["PostgreSQL host", { DATABASE_URL: "postgresql://app:password@localhost:5433/okved" }],
    ["PostgreSQL port", { DATABASE_URL: "postgresql://app:password@127.0.0.1:5432/okved" }],
    ["PostgreSQL database", { DATABASE_URL: "postgresql://app:password@127.0.0.1:5433/other" }],
    ["PostgreSQL query", { DATABASE_URL: "postgresql://app:password@127.0.0.1:5433/okved?sslmode=disable" }],
    ["MinIO endpoint", { S3_ENDPOINT: "http://localhost:9000" }],
    ["MinIO bucket", { S3_BUCKET: "okved-raw-test" }],
  ])("rejects a live pilot with a non-owned exact %s", (_case, override) => {
    const env = parseEnv({
      ...validEnvironment,
      LIST_ORG_LIVE_ENABLED: "true",
      FNS_LIVE_ENABLED: "true",
      ...override,
    });

    expect(() => assertAudienceCommandActivation(
      { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
      env,
    )).toThrow("exact owned runtime coordinates");
  });
});
