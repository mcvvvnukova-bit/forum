import type { AudienceCliCommand } from "../../apps/browser-runner/cli";

export interface AppEnv {
  appMode: "fixture" | "live";
  databaseUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  listOrgLiveEnabled: boolean;
  fnsLiveEnabled: boolean;
}

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const appMode = parseAppMode(input.APP_MODE);
  const listOrgLiveEnabled = parseBoolean(input.LIST_ORG_LIVE_ENABLED, "LIST_ORG_LIVE_ENABLED");
  const fnsLiveEnabled = parseBoolean(input.FNS_LIVE_ENABLED, "FNS_LIVE_ENABLED");

  if (appMode === "fixture" && listOrgLiveEnabled) {
    throw new Error("live List-Org is forbidden in fixture mode");
  }
  if (appMode === "fixture" && fnsLiveEnabled) {
    throw new Error("live FNS is forbidden in fixture mode");
  }

  return {
    appMode,
    databaseUrl: requireValue(input, "DATABASE_URL"),
    s3Endpoint: requireValue(input, "S3_ENDPOINT"),
    s3Bucket: requireValue(input, "S3_BUCKET"),
    s3AccessKeyId: requireValue(input, "S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireValue(input, "S3_SECRET_ACCESS_KEY"),
    listOrgLiveEnabled,
    fnsLiveEnabled,
  };
}

export function assertAudienceCommandActivation(command: AudienceCliCommand, env: AppEnv): void {
  if (command.kind === "live-pilot") {
    if (env.appMode !== "live" || !env.listOrgLiveEnabled || !env.fnsLiveEnabled) {
      throw new Error("live pilot requires APP_MODE=live, LIST_ORG_LIVE_ENABLED=true, and FNS_LIVE_ENABLED=true");
    }
    assertExactLivePilotCoordinates(env);
    return;
  }

  if (env.appMode !== "fixture" || env.listOrgLiveEnabled || env.fnsLiveEnabled) {
    throw new Error("audience CLI is fixture-only");
  }
}

function assertExactLivePilotCoordinates(env: AppEnv): void {
  let database: URL;
  try {
    database = new URL(env.databaseUrl);
  } catch {
    throw new Error("live pilot requires exact owned runtime coordinates");
  }
  const databaseIsExact = (database.protocol === "postgres:" || database.protocol === "postgresql:")
    && database.hostname === "127.0.0.1"
    && database.port === "5433"
    && database.pathname === "/okved"
    && database.search === ""
    && database.hash === "";
  if (!databaseIsExact
    || env.s3Endpoint !== "http://127.0.0.1:9000"
    || env.s3Bucket !== "okved-raw") {
    throw new Error("live pilot requires exact owned runtime coordinates");
  }
}

function parseAppMode(value: string | undefined): AppEnv["appMode"] {
  const appMode = requireValue({ APP_MODE: value }, "APP_MODE");

  if (appMode !== "fixture" && appMode !== "live") {
    throw new Error("APP_MODE must be fixture or live");
  }

  return appMode;
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function requireValue(input: NodeJS.ProcessEnv, name: string): string {
  const value = input[name]?.trim();

  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}
