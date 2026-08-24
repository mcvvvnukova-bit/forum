import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../../src/shared/config/env";

const validEnvironment = {
  APP_MODE: "live",
  DATABASE_URL: "postgresql://app:password@127.0.0.1:5432/okved",
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
      databaseUrl: "postgresql://app:password@127.0.0.1:5432/okved",
      s3Endpoint: "http://127.0.0.1:9000",
      s3Bucket: "okved-raw",
      s3AccessKeyId: "okved-local",
      s3SecretAccessKey: "local-secret",
      listOrgLiveEnabled: false,
    });
  });
});
