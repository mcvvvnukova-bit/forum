export interface AppEnv {
  appMode: "fixture" | "live";
  databaseUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  listOrgLiveEnabled: boolean;
}

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const appMode = parseAppMode(input.APP_MODE);
  const listOrgLiveEnabled = parseBoolean(input.LIST_ORG_LIVE_ENABLED, "LIST_ORG_LIVE_ENABLED");

  if (appMode === "fixture" && listOrgLiveEnabled) {
    throw new Error("live List-Org is forbidden in fixture mode");
  }

  return {
    appMode,
    databaseUrl: requireValue(input, "DATABASE_URL"),
    s3Endpoint: requireValue(input, "S3_ENDPOINT"),
    s3Bucket: requireValue(input, "S3_BUCKET"),
    s3AccessKeyId: requireValue(input, "S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireValue(input, "S3_SECRET_ACCESS_KEY"),
    listOrgLiveEnabled,
  };
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
