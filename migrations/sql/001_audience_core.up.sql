CREATE SCHEMA audience;

CREATE TYPE audience.crawl_status AS ENUM (
  'pending',
  'running',
  'succeeded',
  'failed',
  'blocked'
);

CREATE TYPE audience.financial_metric AS ENUM (
  'revenue',
  'income',
  'expenses'
);

CREATE TABLE audience.crawl_runs (
  id uuid PRIMARY KEY,
  scope_json jsonb NOT NULL,
  fixture_version text NOT NULL,
  parser_version text NOT NULL,
  status audience.crawl_status NOT NULL DEFAULT 'pending',
  terminal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  published_at timestamptz,
  CHECK (jsonb_typeof(scope_json) = 'object'),
  CHECK (length(trim(fixture_version)) > 0),
  CHECK (length(trim(parser_version)) > 0)
);

CREATE TABLE audience.crawl_tasks (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES audience.crawl_runs(id) ON DELETE RESTRICT,
  task_kind text NOT NULL,
  status audience.crawl_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  error_json jsonb,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (length(trim(task_kind)) > 0),
  CHECK (attempts >= 0),
  CHECK (fencing_token >= 0)
);

CREATE TABLE audience.source_fetches (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES audience.crawl_runs(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_record_key text NOT NULL,
  object_key text NOT NULL,
  checksum_sha256 text NOT NULL,
  mime_type text NOT NULL,
  final_url text NOT NULL,
  navigation_status integer,
  captured_at timestamptz NOT NULL,
  parser_version text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_kind, source_record_key, checksum_sha256),
  CHECK (length(trim(source_kind)) > 0),
  CHECK (length(trim(source_record_key)) > 0),
  CHECK (length(trim(object_key)) > 0),
  CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (length(trim(mime_type)) > 0),
  CHECK (length(trim(final_url)) > 0),
  CHECK (navigation_status IS NULL OR navigation_status BETWEEN 100 AND 599),
  CHECK (length(trim(parser_version)) > 0),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE audience.dataset_releases (
  id uuid PRIMARY KEY,
  source_kind text NOT NULL,
  source_version text NOT NULL,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  published_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_kind, source_version),
  CHECK (length(trim(source_kind)) > 0),
  CHECK (length(trim(source_version)) > 0),
  CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE audience.companies (
  inn text PRIMARY KEY,
  name text NOT NULL,
  website text,
  phone text,
  email text,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inn ~ '^[0-9]{10}$'),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(source_record_key)) > 0)
);

CREATE TABLE audience.okveds (
  code text PRIMARY KEY,
  name text NOT NULL,
  source_version text NOT NULL,
  dataset_release_id uuid NOT NULL REFERENCES audience.dataset_releases(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code ~ '^[0-9]{2}(?:\.[0-9]{1,2}){0,2}$'),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(source_version)) > 0)
);

CREATE TABLE audience.company_okveds (
  company_inn text NOT NULL REFERENCES audience.companies(inn) ON DELETE RESTRICT,
  okved_code text NOT NULL REFERENCES audience.okveds(code) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_inn, okved_code),
  CHECK (length(trim(source_record_key)) > 0)
);

CREATE TABLE audience.run_company_matches (
  run_id uuid NOT NULL REFERENCES audience.crawl_runs(id) ON DELETE RESTRICT,
  company_inn text NOT NULL REFERENCES audience.companies(inn) ON DELETE RESTRICT,
  matched_okved_code text NOT NULL REFERENCES audience.okveds(code) ON DELETE RESTRICT,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, company_inn, matched_okved_code),
  CHECK (length(trim(source_record_key)) > 0)
);

CREATE TABLE audience.organization_evidence (
  id uuid PRIMARY KEY,
  company_inn text NOT NULL REFERENCES audience.companies(inn) ON DELETE RESTRICT,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL,
  field_name text NOT NULL,
  value_json jsonb NOT NULL,
  parser_version text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(source_record_key)) > 0),
  CHECK (length(trim(field_name)) > 0),
  CHECK (length(trim(parser_version)) > 0)
);

CREATE TABLE audience.financial_evidence (
  id uuid PRIMARY KEY,
  company_inn text NOT NULL REFERENCES audience.companies(inn) ON DELETE RESTRICT,
  report_year integer NOT NULL,
  metric audience.financial_metric NOT NULL,
  amount numeric(18,2) NOT NULL,
  source_fetch_id uuid NOT NULL REFERENCES audience.source_fetches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL,
  dataset_release_id uuid REFERENCES audience.dataset_releases(id) ON DELETE RESTRICT,
  parser_version text NOT NULL,
  observed_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_inn, report_year, metric, source_fetch_id, source_record_key),
  UNIQUE (id, company_inn, report_year, metric, amount),
  CHECK (report_year BETWEEN 1900 AND 9999),
  CHECK (amount >= 0),
  CHECK (length(trim(source_record_key)) > 0),
  CHECK (length(trim(parser_version)) > 0)
);

CREATE TABLE audience.financial_observations (
  company_inn text NOT NULL REFERENCES audience.companies(inn) ON DELETE RESTRICT,
  report_year integer NOT NULL,
  revenue numeric(18,2),
  income numeric(18,2),
  expenses numeric(18,2),
  revenue_evidence_id uuid,
  income_evidence_id uuid,
  expenses_evidence_id uuid,
  revenue_metric audience.financial_metric GENERATED ALWAYS AS ('revenue'::audience.financial_metric) STORED,
  income_metric audience.financial_metric GENERATED ALWAYS AS ('income'::audience.financial_metric) STORED,
  expenses_metric audience.financial_metric GENERATED ALWAYS AS ('expenses'::audience.financial_metric) STORED,
  as_of timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_inn, report_year),
  CHECK (report_year BETWEEN 1900 AND 9999),
  CHECK (revenue IS NULL OR revenue >= 0),
  CHECK (income IS NULL OR income >= 0),
  CHECK (expenses IS NULL OR expenses >= 0),
  CHECK ((revenue IS NULL) = (revenue_evidence_id IS NULL)),
  CHECK ((income IS NULL) = (income_evidence_id IS NULL)),
  CHECK ((expenses IS NULL) = (expenses_evidence_id IS NULL)),
  FOREIGN KEY (revenue_evidence_id, company_inn, report_year, revenue_metric, revenue)
    REFERENCES audience.financial_evidence (id, company_inn, report_year, metric, amount)
    DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (income_evidence_id, company_inn, report_year, income_metric, income)
    REFERENCES audience.financial_evidence (id, company_inn, report_year, metric, amount)
    DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (expenses_evidence_id, company_inn, report_year, expenses_metric, expenses)
    REFERENCES audience.financial_evidence (id, company_inn, report_year, metric, amount)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX crawl_tasks_run_id_status_idx ON audience.crawl_tasks (run_id, status);
CREATE INDEX source_fetches_run_id_idx ON audience.source_fetches (run_id);
CREATE INDEX dataset_releases_source_fetch_id_idx ON audience.dataset_releases (source_fetch_id);
CREATE INDEX companies_source_fetch_id_idx ON audience.companies (source_fetch_id);
CREATE INDEX okveds_dataset_release_id_idx ON audience.okveds (dataset_release_id);
CREATE INDEX company_okveds_okved_code_idx ON audience.company_okveds (okved_code);
CREATE INDEX company_okveds_source_fetch_id_idx ON audience.company_okveds (source_fetch_id);
CREATE INDEX run_company_matches_run_id_idx ON audience.run_company_matches (run_id);
CREATE INDEX run_company_matches_company_inn_idx ON audience.run_company_matches (company_inn);
CREATE INDEX run_company_matches_matched_okved_code_idx ON audience.run_company_matches (matched_okved_code);
CREATE INDEX run_company_matches_source_fetch_id_idx ON audience.run_company_matches (source_fetch_id);
CREATE INDEX organization_evidence_company_inn_idx ON audience.organization_evidence (company_inn);
CREATE INDEX organization_evidence_source_fetch_id_idx ON audience.organization_evidence (source_fetch_id);
CREATE INDEX financial_evidence_company_inn_report_year_idx ON audience.financial_evidence (company_inn, report_year);
CREATE INDEX financial_evidence_source_fetch_id_idx ON audience.financial_evidence (source_fetch_id);
CREATE INDEX financial_evidence_dataset_release_id_idx ON audience.financial_evidence (dataset_release_id);
CREATE INDEX financial_observations_revenue_evidence_id_idx ON audience.financial_observations (revenue_evidence_id);
CREATE INDEX financial_observations_income_evidence_id_idx ON audience.financial_observations (income_evidence_id);
CREATE INDEX financial_observations_expenses_evidence_id_idx ON audience.financial_observations (expenses_evidence_id);
