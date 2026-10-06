CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS party;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE iam.users (
  id uuid PRIMARY KEY,
  email text,
  email_confirmed_at timestamptz,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON iam.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE iam.external_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users(id),
  provider text NOT NULL CHECK (provider IN ('sber_id', 'kontur_diadoc')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 96),
  claims_snapshot jsonb NOT NULL,
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX external_identities_user ON iam.external_identities(user_id);

CREATE TABLE iam.authorization_attempts (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('register', 'login')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX authorization_attempts_expiry ON iam.authorization_attempts(expires_at);

CREATE TABLE iam.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_active_user ON iam.sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry ON iam.sessions(expires_at);

CREATE TABLE party.participants (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'individual'),
  role text NOT NULL CHECK (role = 'provider'),
  legal_status text NOT NULL CHECK (legal_status = 'individual_person'),
  individual_user_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.role_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.users(id),
  scope_type text NOT NULL CHECK (scope_type = 'participant'),
  scope_id uuid NOT NULL,
  role text NOT NULL CHECK (role = 'provider'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, scope_id, role)
);
CREATE INDEX role_assignments_scope ON iam.role_assignments(scope_id);

CREATE TABLE integration.outbox_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text
);
CREATE INDEX outbox_pending ON integration.outbox_events(available_at, sequence) WHERE published_at IS NULL;
CREATE INDEX outbox_aggregate ON integration.outbox_events(aggregate_id);

CREATE TABLE audit.audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL
);
CREATE INDEX audit_actor ON audit.audit_events(actor_user_id, occurred_at);
