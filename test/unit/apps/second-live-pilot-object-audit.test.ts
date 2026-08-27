import { describe, expect, it } from "vitest";

import {
  runSecondLivePilotObjectAudit,
  type SecondLivePilotAuditAdapters,
} from "../../../src/apps/audit/second-live-pilot-object-audit";

const runId = "8da208ea-2bff-44a6-a94f-431bbe5f97e7";
const manifestSha256 = "a2f8f6f63353649dfbd7c04a3442e6e7487a0fbb2a67f1351cfe095df20437b2";
const prefix = `raw/${runId}/list-org-live/${manifestSha256}`;
const manifestKey = `${prefix}/manifest.json`;
const projectionKey = `${prefix}/projection.html`;
const projectionSha256 = "145f7b32bce6cf52d28d9c95c71d9831d96f794f897bb1851d15ac9a67315796";
const sourceFetchId = "d5cc1e16-b95a-4707-b407-3b196fd0d85c";
const uploadIntentId = "aa2166a9-f035-421c-9fd4-b17b398a90ba";

const environment = {
  OKVED_AUDIT_DATABASE_URL: "postgresql://audit-user:audit-secret@127.0.0.1:5433/okved",
  OKVED_AUDIT_S3_ENDPOINT: "http://127.0.0.1:9000",
  OKVED_AUDIT_S3_BUCKET: "okved-raw",
  OKVED_AUDIT_S3_ACCESS_KEY_ID: "external-audit-access",
  OKVED_AUDIT_S3_SECRET_ACCESS_KEY: "external-audit-secret",
};

describe("second live-pilot immutable object audit", () => {
  it("accepts the exact committed projection identity and returns only safe audit fields", async () => {
    const adapters: SecondLivePilotAuditAdapters = {
      loadRows: async () => [auditRow()],
      verifyProjection: async (_config, object) => ({
        identity: {
          runId: object.runId,
          sourceKind: object.sourceKind,
          sourceRecordKey: object.sourceRecordKey,
          parserVersion: object.parserVersion,
          checksumSha256: object.checksumSha256,
          candidateEvidence: null,
        },
        projectionSha256,
      }),
    };

    await expect(runSecondLivePilotObjectAudit(environment, adapters)).resolves.toEqual({
      runId,
      sourceKind: "list-org-live",
      sourceRecordKey: "page:1",
      uploadIntentState: "committed",
      manifestKey,
      manifestSha256,
      projectionKey,
      projectionSha256,
      verifiedObjects: 1,
    });
  });

  it("rejects a non-loopback audit endpoint before loading database rows", async () => {
    const adapters: SecondLivePilotAuditAdapters = {
      loadRows: async () => {
        throw new Error("database must not be reached");
      },
      verifyProjection: async () => {
        throw new Error("S3 must not be reached");
      },
    };

    await expect(runSecondLivePilotObjectAudit({
      ...environment,
      OKVED_AUDIT_S3_ENDPOINT: "https://s3.example.test",
    }, adapters)).rejects.toThrow("exact preserved audit coordinates");
  });

  it("rejects S3 projection bytes that disagree with the committed upload intent", async () => {
    const row = auditRow();
    row.object_checksums_json = {
      ...row.object_checksums_json,
      [projectionKey]: "f".repeat(64),
    };
    const adapters: SecondLivePilotAuditAdapters = {
      loadRows: async () => [row],
      verifyProjection: async (_config, object) => ({
        identity: {
          runId: object.runId,
          sourceKind: object.sourceKind,
          sourceRecordKey: object.sourceRecordKey,
          parserVersion: object.parserVersion,
          checksumSha256: object.checksumSha256,
          candidateEvidence: null,
        },
        projectionSha256,
      }),
    };

    await expect(runSecondLivePilotObjectAudit(environment, adapters))
      .rejects.toThrow("verified projection identity mismatch");
  });
});

function auditRow() {
  return {
    source_fetch_id: sourceFetchId,
    run_id: runId,
    source_kind: "list-org-live",
    source_record_key: "page:1",
    parser_version: "list-org-live/1.0.0",
    object_key: manifestKey,
    checksum_sha256: manifestSha256,
    raw_upload_intent_id: uploadIntentId,
    intent_id: uploadIntentId,
    task_run_id: runId,
    intent_state: "committed",
    intent_source_kind: "list-org-live",
    intent_source_record_key: "page:1",
    intent_parser_version: "list-org-live/1.0.0",
    artifact_kind: "projection",
    manifest_key: manifestKey,
    manifest_checksum_sha256: manifestSha256,
    object_keys_json: [projectionKey, manifestKey],
    object_checksums_json: {
      [projectionKey]: projectionSha256,
      [manifestKey]: manifestSha256,
    },
    stored_identity_json: {
      kind: "projection",
      runId,
      sourceKind: "list-org-live",
      sourceRecordKey: "page:1",
      parserVersion: "list-org-live/1.0.0",
      checksumSha256: manifestSha256,
      prefix,
      manifestKey,
      projectionKey,
    },
    intent_source_fetch_id: sourceFetchId,
  };
}
