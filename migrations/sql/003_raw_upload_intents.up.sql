CREATE TYPE audience.raw_upload_state AS ENUM (
  'reserved',
  'verified',
  'committed',
  'failed'
);

CREATE TABLE audience.raw_upload_intents (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES audience.crawl_runs(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES audience.crawl_tasks(id) ON DELETE RESTRICT,
  fencing_token bigint NOT NULL,
  source_kind text NOT NULL,
  source_record_key text NOT NULL,
  parser_version text NOT NULL,
  artifact_kind text NOT NULL,
  manifest_key text NOT NULL UNIQUE,
  manifest_checksum_sha256 text NOT NULL,
  plan_checksum_sha256 text NOT NULL,
  object_keys_json jsonb NOT NULL,
  object_checksums_json jsonb NOT NULL,
  stored_identity_json jsonb NOT NULL,
  state audience.raw_upload_state NOT NULL DEFAULT 'reserved',
  failure_phase text,
  failure_code text,
  source_fetch_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  committed_at timestamptz,
  failed_at timestamptz,
  UNIQUE (run_id, source_kind, source_record_key, parser_version, plan_checksum_sha256),
  CHECK (fencing_token >= 0),
  CHECK (length(trim(source_kind)) > 0),
  CHECK (length(trim(source_record_key)) > 0),
  CHECK (length(trim(parser_version)) > 0),
  CHECK (artifact_kind IN ('browser', 'projection', 'file')),
  CHECK (length(trim(manifest_key)) > 0),
  CHECK (manifest_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (plan_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(object_keys_json) = 'array' AND jsonb_array_length(object_keys_json) > 0),
  CHECK (jsonb_typeof(object_checksums_json) = 'object'),
  CHECK (jsonb_typeof(stored_identity_json) = 'object'),
  CHECK ((state = 'reserved' AND verified_at IS NULL AND committed_at IS NULL AND failed_at IS NULL
          AND failure_phase IS NULL AND failure_code IS NULL AND source_fetch_id IS NULL)
      OR (state = 'verified' AND verified_at IS NOT NULL AND committed_at IS NULL AND failed_at IS NULL
          AND failure_phase IS NULL AND failure_code IS NULL AND source_fetch_id IS NULL)
      OR (state = 'committed' AND verified_at IS NOT NULL AND committed_at IS NOT NULL AND failed_at IS NULL
          AND failure_phase IS NULL AND failure_code IS NULL AND source_fetch_id IS NOT NULL)
      OR (state = 'failed' AND committed_at IS NULL AND failed_at IS NOT NULL
          AND length(trim(failure_phase)) > 0 AND length(trim(failure_code)) > 0
          AND source_fetch_id IS NULL))
);

ALTER TABLE audience.source_fetches
  ADD COLUMN raw_upload_intent_id uuid UNIQUE
    REFERENCES audience.raw_upload_intents(id) ON DELETE RESTRICT;

ALTER TABLE audience.raw_upload_intents
  ADD CONSTRAINT raw_upload_intents_source_fetch_fk
  FOREIGN KEY (source_fetch_id) REFERENCES audience.source_fetches(id) ON DELETE RESTRICT;

CREATE INDEX raw_upload_intents_task_state_idx
  ON audience.raw_upload_intents(task_id, fencing_token, state);
