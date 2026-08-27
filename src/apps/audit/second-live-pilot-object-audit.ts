import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { QueryResultRow } from "pg";
import pg from "pg";

import type {
  StoredProjectionRawObject,
  VerifiedRawObject,
} from "../../modules/audience/application/ports/raw-object-storage";
import { S3RawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-raw-object-storage";

const EXPECTED_RUN_ID = "8da208ea-2bff-44a6-a94f-431bbe5f97e7";
const EXPECTED_SOURCE_KIND = "list-org-live";
const EXPECTED_SOURCE_RECORD_KEY = "page:1";
const EXPECTED_MANIFEST_SHA256 = "a2f8f6f63353649dfbd7c04a3442e6e7487a0fbb2a67f1351cfe095df20437b2";
const EXPECTED_PREFIX = [
  "raw", EXPECTED_RUN_ID, EXPECTED_SOURCE_KIND, EXPECTED_MANIFEST_SHA256,
].join("/");
const EXPECTED_MANIFEST_KEY = `${EXPECTED_PREFIX}/manifest.json`;
const EXPECTED_PROJECTION_KEY = `${EXPECTED_PREFIX}/projection.html`;

const LOAD_AUDIT_ROWS_SQL = `SELECT
  source_fetch.id::text AS source_fetch_id,
  source_fetch.run_id::text AS run_id,
  source_fetch.source_kind,
  source_fetch.source_record_key,
  source_fetch.parser_version,
  source_fetch.object_key,
  source_fetch.checksum_sha256,
  source_fetch.raw_upload_intent_id::text,
  intent.id::text AS intent_id,
  task.run_id::text AS task_run_id,
  intent.state::text AS intent_state,
  intent.source_kind AS intent_source_kind,
  intent.source_record_key AS intent_source_record_key,
  intent.parser_version AS intent_parser_version,
  intent.artifact_kind,
  intent.manifest_key,
  intent.manifest_checksum_sha256,
  intent.object_keys_json,
  intent.object_checksums_json,
  intent.stored_identity_json,
  intent.source_fetch_id::text AS intent_source_fetch_id
FROM audience.source_fetches AS source_fetch
JOIN audience.raw_upload_intents AS intent
  ON intent.id = source_fetch.raw_upload_intent_id
JOIN audience.crawl_tasks AS task
  ON task.id = intent.task_id
WHERE source_fetch.run_id = $1::uuid
ORDER BY source_fetch.id`;

export interface SecondLivePilotAuditConfig {
  databaseUrl: string;
  s3Endpoint: "http://127.0.0.1:9000";
  s3Bucket: "okved-raw";
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

interface VerifiedProjectionAudit {
  identity: VerifiedRawObject;
  projectionSha256: string;
}

export interface SecondLivePilotAuditAdapters {
  loadRows(config: SecondLivePilotAuditConfig): Promise<unknown[]>;
  verifyProjection(
    config: SecondLivePilotAuditConfig,
    object: StoredProjectionRawObject,
  ): Promise<VerifiedProjectionAudit>;
}

export interface SecondLivePilotObjectAuditSummary {
  runId: string;
  sourceKind: string;
  sourceRecordKey: string;
  uploadIntentState: "committed";
  manifestKey: string;
  manifestSha256: string;
  projectionKey: string;
  projectionSha256: string;
  verifiedObjects: 1;
}

export async function runSecondLivePilotObjectAudit(
  environment: NodeJS.ProcessEnv,
  adapters: SecondLivePilotAuditAdapters = defaultAdapters,
): Promise<SecondLivePilotObjectAuditSummary> {
  const config = parseAuditConfig(environment);
  const rows = await adapters.loadRows(config);
  const { object, projectionSha256 } = validateAuditRows(rows);
  const verification = await adapters.verifyProjection(config, object);
  const verified = verification.identity;

  if (verified.runId !== object.runId
    || verified.sourceKind !== object.sourceKind
    || verified.sourceRecordKey !== object.sourceRecordKey
    || verified.parserVersion !== object.parserVersion
    || verified.checksumSha256 !== object.checksumSha256
    || verification.projectionSha256 !== projectionSha256) {
    throw new Error("verified projection identity mismatch");
  }

  return {
    runId: object.runId,
    sourceKind: object.sourceKind,
    sourceRecordKey: object.sourceRecordKey,
    uploadIntentState: "committed",
    manifestKey: object.manifestKey,
    manifestSha256: object.checksumSha256,
    projectionKey: object.projectionKey,
    projectionSha256,
    verifiedObjects: 1,
  };
}

function parseAuditConfig(environment: NodeJS.ProcessEnv): SecondLivePilotAuditConfig {
  const databaseUrl = requireEnvironment(environment, "OKVED_AUDIT_DATABASE_URL");
  const s3Endpoint = requireEnvironment(environment, "OKVED_AUDIT_S3_ENDPOINT");
  const s3Bucket = requireEnvironment(environment, "OKVED_AUDIT_S3_BUCKET");
  const s3AccessKeyId = requireEnvironment(environment, "OKVED_AUDIT_S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = requireEnvironment(environment, "OKVED_AUDIT_S3_SECRET_ACCESS_KEY");
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error("audit requires exact preserved audit coordinates");
  }
  const exactDatabase = (database.protocol === "postgres:" || database.protocol === "postgresql:")
    && database.hostname === "127.0.0.1"
    && database.port === "5433"
    && database.pathname === "/okved"
    && database.username !== ""
    && database.password !== ""
    && database.search === ""
    && database.hash === "";
  if (!exactDatabase
    || s3Endpoint !== "http://127.0.0.1:9000"
    || s3Bucket !== "okved-raw") {
    throw new Error("audit requires exact preserved audit coordinates");
  }
  return {
    databaseUrl,
    s3Endpoint,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
  };
}

function validateAuditRows(rows: unknown[]): {
  object: StoredProjectionRawObject;
  projectionSha256: string;
} {
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new Error("expected exactly one preserved source-fetch object");
  }
  const row = rows[0];
  const objectKeys = row.object_keys_json;
  const objectChecksums = row.object_checksums_json;
  const identity = row.stored_identity_json;
  if (!Array.isArray(objectKeys)
    || objectKeys.length !== 2
    || objectKeys[0] !== EXPECTED_PROJECTION_KEY
    || objectKeys[1] !== EXPECTED_MANIFEST_KEY
    || !isRecord(objectChecksums)
    || !hasExactlyKeys(objectChecksums, [EXPECTED_PROJECTION_KEY, EXPECTED_MANIFEST_KEY])
    || !isSha256(objectChecksums[EXPECTED_PROJECTION_KEY])
    || objectChecksums[EXPECTED_MANIFEST_KEY] !== EXPECTED_MANIFEST_SHA256
    || !isRecord(identity)
    || !hasExactlyKeys(identity, [
      "kind", "runId", "sourceKind", "sourceRecordKey", "parserVersion",
      "checksumSha256", "prefix", "manifestKey", "projectionKey",
    ])
    || row.run_id !== EXPECTED_RUN_ID
    || row.task_run_id !== EXPECTED_RUN_ID
    || row.source_kind !== EXPECTED_SOURCE_KIND
    || row.intent_source_kind !== EXPECTED_SOURCE_KIND
    || row.source_record_key !== EXPECTED_SOURCE_RECORD_KEY
    || row.intent_source_record_key !== EXPECTED_SOURCE_RECORD_KEY
    || typeof row.parser_version !== "string"
    || row.parser_version.trim() === ""
    || row.intent_parser_version !== row.parser_version
    || row.object_key !== EXPECTED_MANIFEST_KEY
    || row.manifest_key !== EXPECTED_MANIFEST_KEY
    || row.checksum_sha256 !== EXPECTED_MANIFEST_SHA256
    || row.manifest_checksum_sha256 !== EXPECTED_MANIFEST_SHA256
    || row.raw_upload_intent_id !== row.intent_id
    || row.intent_source_fetch_id !== row.source_fetch_id
    || row.intent_state !== "committed"
    || row.artifact_kind !== "projection"
    || identity.kind !== "projection"
    || identity.runId !== EXPECTED_RUN_ID
    || identity.sourceKind !== EXPECTED_SOURCE_KIND
    || identity.sourceRecordKey !== EXPECTED_SOURCE_RECORD_KEY
    || identity.parserVersion !== row.parser_version
    || identity.checksumSha256 !== EXPECTED_MANIFEST_SHA256
    || identity.prefix !== EXPECTED_PREFIX
    || identity.manifestKey !== EXPECTED_MANIFEST_KEY
    || identity.projectionKey !== EXPECTED_PROJECTION_KEY) {
    throw new Error("committed projection identity mismatch");
  }
  return {
    object: {
      kind: "projection",
      runId: EXPECTED_RUN_ID,
      sourceKind: EXPECTED_SOURCE_KIND,
      sourceRecordKey: EXPECTED_SOURCE_RECORD_KEY,
      parserVersion: row.parser_version,
      checksumSha256: EXPECTED_MANIFEST_SHA256,
      prefix: EXPECTED_PREFIX,
      manifestKey: EXPECTED_MANIFEST_KEY,
      projectionKey: EXPECTED_PROJECTION_KEY,
    },
    projectionSha256: objectChecksums[EXPECTED_PROJECTION_KEY],
  };
}

const defaultAdapters: SecondLivePilotAuditAdapters = {
  loadRows: async (config) => {
    const database = new pg.Client({ connectionString: config.databaseUrl });
    await database.connect();
    try {
      await database.query("BEGIN TRANSACTION READ ONLY");
      const result = await database.query<QueryResultRow>(LOAD_AUDIT_ROWS_SQL, [EXPECTED_RUN_ID]);
      await database.query("COMMIT");
      return result.rows;
    } catch (error) {
      await database.query("ROLLBACK");
      throw error;
    } finally {
      await database.end();
    }
  },
  verifyProjection: async (config, object) => {
    const client = new S3Client({
      endpoint: config.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
    const storage = new S3RawObjectStorage({
      appMode: "fixture",
      databaseUrl: config.databaseUrl,
      s3Endpoint: config.s3Endpoint,
      s3Bucket: config.s3Bucket,
      s3AccessKeyId: config.s3AccessKeyId,
      s3SecretAccessKey: config.s3SecretAccessKey,
      listOrgLiveEnabled: false,
      fnsLiveEnabled: false,
    }, EXPECTED_SOURCE_KIND, client);
    try {
      const identity = await storage.verify(object);
      const response = await client.send(new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: object.projectionKey,
      }));
      if (response.Body === undefined) throw new Error("projection object body is absent");
      const projectionBytes = await response.Body.transformToByteArray();
      return {
        identity,
        projectionSha256: createHash("sha256").update(projectionBytes).digest("hex"),
      };
    } finally {
      storage.close();
      client.destroy();
    }
  },
};

function requireEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

async function main(): Promise<void> {
  try {
    const summary = await runSecondLivePilotObjectAudit(process.env);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    process.stderr.write("second live-pilot object audit failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
