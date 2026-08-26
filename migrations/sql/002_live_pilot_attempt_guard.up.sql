CREATE TABLE audience.live_pilot_attempts (
  scope_key text PRIMARY KEY,
  command_contract jsonb NOT NULL,
  policy_checksum_sha256 text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(scope_key)) > 0),
  CHECK (jsonb_typeof(command_contract) = 'object'),
  CHECK (policy_checksum_sha256 ~ '^[0-9a-f]{64}$')
);
