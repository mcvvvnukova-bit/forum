#!/usr/bin/env bash
set -euo pipefail
set +x

DB_NAME="${DB_NAME:-forum}"
DB_OWNER="${DB_OWNER:-outline}"
SERVER_NAME="${SERVER_NAME:-AST Forum / Forum PostgreSQL}"
OUTLINE_COMPOSE="${OUTLINE_COMPOSE:-/opt/outline/docker-compose.yml}"
PGADMIN_COMPOSE="${PGADMIN_COMPOSE:-/opt/pgadmin/compose.yaml}"
PGADMIN_USERS="${PGADMIN_USERS:-admin@astforum.ru ceo@astforum.ru}"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E "$0" "$@"
fi

dc_outline() {
  docker compose -f "$OUTLINE_COMPOSE" "$@"
}

dc_pgadmin() {
  docker compose -f "$PGADMIN_COMPOSE" "$@"
}

log() {
  printf '[forum-db] %s\n' "$*"
}

require_file() {
  test -f "$1" || {
    printf '[forum-db] missing required file: %s\n' "$1" >&2
    exit 1
  }
}

require_file "$OUTLINE_COMPOSE"
require_file "$PGADMIN_COMPOSE"

log "validating compose projects"
dc_outline config --quiet
dc_pgadmin config --quiet

postgres_id="$(dc_outline ps -q postgres)"
pgadmin_id="$(dc_pgadmin ps -q pgadmin)"
test -n "$postgres_id" || { printf '[forum-db] postgres container is not running\n' >&2; exit 1; }
test -n "$pgadmin_id" || { printf '[forum-db] pgAdmin container is not running\n' >&2; exit 1; }

backup_dir="/opt/backups/forum-db/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup_dir"
install -m 0600 "$PGADMIN_COMPOSE" "$backup_dir/pgadmin-compose.yaml"
if [ -f /opt/pgadmin/servers.json ]; then
  install -m 0600 /opt/pgadmin/servers.json "$backup_dir/servers.json"
fi
dc_pgadmin exec -T pgadmin /venv/bin/python3 - <<'PY'
import sqlite3

src = sqlite3.connect("/var/lib/pgadmin/pgadmin4.db")
dst = sqlite3.connect("/tmp/pgadmin4.db.forum-backup")
src.backup(dst)
dst.close()
src.close()
PY
docker cp "$pgadmin_id:/tmp/pgadmin4.db.forum-backup" "$backup_dir/pgadmin4.db"
dc_pgadmin exec -T pgadmin rm -f /tmp/pgadmin4.db.forum-backup
chmod 0600 "$backup_dir/pgadmin4.db"
log "pgAdmin backup created at $backup_dir"

log "creating database $DB_NAME when absent"
if dc_outline exec -T postgres psql -U "$DB_OWNER" -d postgres -Atqc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -qx '1'; then
  log "database $DB_NAME already exists"
else
  dc_outline exec -T postgres createdb -U "$DB_OWNER" -O "$DB_OWNER" -E UTF8 "$DB_NAME"
  log "database $DB_NAME created"
fi

log "applying Forum ERD schema"
dc_outline exec -T postgres psql -U "$DB_OWNER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS public.company_statuses (
  code text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.regions (
  code smallint PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.business_segments (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commercial_roles (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.offer_types (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies (
  inn char(10) PRIMARY KEY,
  legal_name text NOT NULL,
  status text NOT NULL REFERENCES public.company_statuses(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  legal_address text,
  actual_address text,
  region_code smallint REFERENCES public.regions(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  list_org_url text,
  website text[] NOT NULL DEFAULT '{}'::text[],
  phone text[] NOT NULL DEFAULT '{}'::text[],
  email text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_inn_format_chk CHECK (inn ~ '^[0-9]{10}$')
);

CREATE TABLE IF NOT EXISTS public.okveds (
  okved varchar(8) PRIMARY KEY,
  parent_code varchar(8) REFERENCES public.okveds(okved)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  level smallint NOT NULL,
  section char(1) NOT NULL,
  name text NOT NULL,
  business_segment_code text REFERENCES public.business_segments(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  commercial_role_code text REFERENCES public.commercial_roles(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  offer_type_code text REFERENCES public.offer_types(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT okveds_okved_not_blank_chk CHECK (length(btrim(okved)) > 0),
  CONSTRAINT okveds_level_positive_chk CHECK (level > 0)
);

CREATE TABLE IF NOT EXISTS public.company_okveds (
  company_inn char(10) NOT NULL REFERENCES public.companies(inn)
    ON UPDATE CASCADE ON DELETE CASCADE,
  okved varchar(8) NOT NULL REFERENCES public.okveds(okved)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_inn, okved)
);

CREATE TABLE IF NOT EXISTS public.financial_observations (
  company_inn char(10) NOT NULL REFERENCES public.companies(inn)
    ON UPDATE CASCADE ON DELETE CASCADE,
  report_year smallint NOT NULL,
  revenue numeric(18,2),
  expenses numeric(18,2),
  income numeric(18,2),
  source_fetch_id bigint,
  dataset_fns text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_inn, report_year),
  CONSTRAINT financial_observations_report_year_chk
    CHECK (report_year BETWEEN 1900 AND 2100)
);

COMMENT ON COLUMN public.financial_observations.source_fetch_id IS
  'Marked as FK in the FigJam ERD; the referenced source_fetches table is not present in the current board.';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.business_segments;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.business_segments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.commercial_roles;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.commercial_roles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.offer_types;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.offer_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.companies;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.okveds;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.okveds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.company_okveds;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.company_okveds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.financial_observations;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.financial_observations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_companies_status
  ON public.companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_region_code
  ON public.companies(region_code);
CREATE INDEX IF NOT EXISTS idx_company_okveds_okved
  ON public.company_okveds(okved);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_okveds_one_primary
  ON public.company_okveds(company_inn)
  WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_okveds_parent_code
  ON public.okveds(parent_code)
  WHERE parent_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_okveds_business_segment_code
  ON public.okveds(business_segment_code)
  WHERE business_segment_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_okveds_commercial_role_code
  ON public.okveds(commercial_role_code)
  WHERE commercial_role_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_okveds_offer_type_code
  ON public.okveds(offer_type_code)
  WHERE offer_type_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_observations_report_year
  ON public.financial_observations(report_year);
CREATE INDEX IF NOT EXISTS idx_financial_observations_source_fetch_id
  ON public.financial_observations(source_fetch_id)
  WHERE source_fetch_id IS NOT NULL;

COMMIT;
SQL

log "verifying Forum schema"
dc_outline exec -T postgres psql -U "$DB_OWNER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X <<'SQL'
WITH expected(table_name, column_count) AS (
  VALUES
    ('business_segments', 5),
    ('commercial_roles', 5),
    ('companies', 12),
    ('company_okveds', 5),
    ('company_statuses', 2),
    ('financial_observations', 9),
    ('offer_types', 5),
    ('okveds', 10),
    ('regions', 2)
),
actual AS (
  SELECT table_name, count(*)::int AS column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (SELECT table_name FROM expected)
  GROUP BY table_name
)
SELECT e.table_name, a.column_count
FROM expected e
LEFT JOIN actual a USING (table_name)
WHERE a.column_count IS DISTINCT FROM e.column_count;
SQL

schema_mismatches="$(dc_outline exec -T postgres psql -U "$DB_OWNER" -d "$DB_NAME" -Atqc "
WITH expected(table_name, column_count) AS (
  VALUES
    ('business_segments', 5),
    ('commercial_roles', 5),
    ('companies', 12),
    ('company_okveds', 5),
    ('company_statuses', 2),
    ('financial_observations', 9),
    ('offer_types', 5),
    ('okveds', 10),
    ('regions', 2)
),
actual AS (
  SELECT table_name, count(*)::int AS column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (SELECT table_name FROM expected)
  GROUP BY table_name
)
SELECT count(*)
FROM expected e
LEFT JOIN actual a USING (table_name)
WHERE a.column_count IS DISTINCT FROM e.column_count;
")"
test "$schema_mismatches" = "0" || {
  printf '[forum-db] schema verification failed: %s mismatches\n' "$schema_mismatches" >&2
  exit 1
}

ensure_user_pgpass() {
  user_email="$1"
  storage_user="$(printf '%s' "$user_email" | tr '[:upper:]' '[:lower:]' | sed 's/@/_/g')"
  src="/opt/pgadmin/secrets/outline_pgpass"
  pgadmin_data_mount="$(docker inspect "$pgadmin_id" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/pgadmin"}}{{.Source}}{{end}}{{end}}')"
  test -n "$pgadmin_data_mount" || {
    printf '[forum-db] cannot find pgAdmin data mount\n' >&2
    exit 1
  }
  dir="${pgadmin_data_mount}/storage/${storage_user}"
  dst="${dir}/.pgpass"
  install -d -o 5050 -g 0 -m 0700 "$dir"
  tmp="${dir}/.pgpass.tmp.$$"
  cp "$src" "$tmp"
  if ! awk -F: -v db="$DB_NAME" '($3 == db || $3 == "*") { found = 1 } END { exit found ? 0 : 1 }' "$tmp"; then
    first_line="$(grep -v '^[[:space:]]*#' "$src" | head -n 1)"
    if [ -z "$first_line" ]; then
      printf '[forum-db] pgpass secret is empty\n' >&2
      exit 1
    fi
    old_ifs="$IFS"
    IFS=:
    read -r host port _database username password <<EOF
$first_line
EOF
    IFS="$old_ifs"
    printf '%s:%s:%s:%s:%s\n' "$host" "$port" "$DB_NAME" "$username" "$password" >> "$tmp"
  fi
  install -o 5050 -g 0 -m 0400 "$tmp" "$dst"
  rm -f "$tmp"
}

merge_pgadmin_server() {
  user_email="$1"
  storage_user="$(printf '%s' "$user_email" | tr '[:upper:]' '[:lower:]' | sed 's/@/_/g')"
  safe_user="$(printf '%s' "$storage_user" | tr -c 'a-z0-9_.-' '_')"
  export_file="/tmp/forum-servers-${safe_user}.json"
  merged_file="/tmp/forum-servers-${safe_user}-merged.json"

  if ! dc_pgadmin exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py get-users \
    --username "$user_email" --json | grep -q "$user_email"; then
    log "pgAdmin user $user_email is absent; skipping server registration"
    return 0
  fi

  ensure_user_pgpass "$user_email"

  dc_pgadmin exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py \
    dump-servers "$export_file" --user "$user_email" >/dev/null

  dc_pgadmin exec -T pgadmin /venv/bin/python3 - \
    "$export_file" "$merged_file" "$SERVER_NAME" "$DB_NAME" "$storage_user" <<'PY'
import json
import os
import sys

src, dst, server_name, db_name, storage_user = sys.argv[1:]
with open(src, encoding="utf-8") as fh:
    data = json.load(fh)

servers = data.setdefault("Servers", {})
base = None
for server in servers.values():
    if server.get("Host") == "postgres" and server.get("Username") == "outline":
        base = server
        break
if base is None and servers:
    base = next(iter(servers.values()))
if base is None:
    base = {}

target_key = None
for key, server in servers.items():
    if server.get("Name") == server_name:
        target_key = key
        break
if target_key is None:
    numeric_keys = [int(key) for key in servers if str(key).isdigit()]
    target_key = str(max(numeric_keys, default=0) + 1)
    server = dict(base)
else:
    server = dict(servers[target_key])

port = server.get("Port", base.get("Port", 5432))
try:
    port = int(port)
except (TypeError, ValueError):
    port = 5432

server.update({
    "Name": server_name,
    "Group": server.get("Group") or base.get("Group") or "Servers",
    "Host": server.get("Host") or base.get("Host") or "postgres",
    "Port": port,
    "MaintenanceDB": db_name,
    "Username": server.get("Username") or base.get("Username") or "outline",
    "SSLMode": server.get("SSLMode") or base.get("SSLMode") or "prefer",
})
connection_params = server.get("ConnectionParameters") or {}
connection_params.setdefault("sslmode", server.get("SSLMode") or base.get("SSLMode") or "prefer")
connection_params.setdefault("connect_timeout", 10)
connection_params["passfile"] = ".pgpass"
server["ConnectionParameters"] = connection_params
server.pop("PassFile", None)
servers[target_key] = server

with open(dst, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
os.chmod(dst, 0o644)
PY

  dc_pgadmin exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py \
    load-servers "$merged_file" --user "$user_email" --replace >/dev/null

  dc_pgadmin exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py \
    dump-servers "$export_file" --user "$user_email" >/dev/null
  dc_pgadmin exec -T pgadmin /venv/bin/python3 - "$export_file" "$SERVER_NAME" "$DB_NAME" <<'PY'
import json
import sys

path, server_name, db_name = sys.argv[1:]
with open(path, encoding="utf-8") as fh:
    data = json.load(fh)
servers = data.get("Servers", {})
assert any(
    server.get("Name") == server_name
    and server.get("Host") == "postgres"
    and str(server.get("Port")) == "5432"
    and server.get("MaintenanceDB") == db_name
    and server.get("Username") == "outline"
    for server in servers.values()
), f"{server_name} registration not found"
PY
  dc_pgadmin exec -T pgadmin rm -f "$export_file" "$merged_file"
  log "pgAdmin server registered for $user_email"
}

ensure_shared_pgpass_database() {
  src="/opt/pgadmin/secrets/outline_pgpass"
  test -s "$src" || {
    printf '[forum-db] missing pgAdmin PostgreSQL pgpass secret: %s\n' "$src" >&2
    exit 1
  }
  if awk -F: -v db="$DB_NAME" '($3 == db || $3 == "*") { found = 1 } END { exit found ? 0 : 1 }' "$src"; then
    return 0
  fi

  tmp="$(mktemp /opt/pgadmin/secrets/outline_pgpass.tmp.XXXXXX)"
  cp "$src" "$tmp"
  first_line="$(grep -v '^[[:space:]]*#' "$src" | head -n 1)"
  if [ -z "$first_line" ]; then
    printf '[forum-db] pgpass secret is empty\n' >&2
    rm -f "$tmp"
    exit 1
  fi
  old_ifs="$IFS"
  IFS=:
  read -r host port _database username password <<EOF
$first_line
EOF
  IFS="$old_ifs"
  printf '%s:%s:%s:%s:%s\n' "$host" "$port" "$DB_NAME" "$username" "$password" >> "$tmp"

  owner_uid="$(stat -c '%u' "$src")"
  owner_gid="$(stat -c '%g' "$src")"
  mode="$(stat -c '%a' "$src")"
  install -o "$owner_uid" -g "$owner_gid" -m "$mode" "$tmp" "$src"
  rm -f "$tmp"
  log "shared pgpass updated for $DB_NAME"
}

ensure_canonical_servers_json() {
  servers_file="/opt/pgadmin/servers.json"
  test -f "$servers_file" || {
    printf '[forum-db] missing pgAdmin servers.json: %s\n' "$servers_file" >&2
    exit 1
  }
  python3 - "$servers_file" "$SERVER_NAME" "$DB_NAME" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
server_name = sys.argv[2]
db_name = sys.argv[3]

with path.open(encoding="utf-8") as fh:
    data = json.load(fh)

servers = data.setdefault("Servers", {})
target_key = None
for key, server in servers.items():
    if server.get("Name") == server_name:
        target_key = key
        break
if target_key is None:
    numeric_keys = [int(key) for key in servers if str(key).isdigit()]
    target_key = str(max(numeric_keys, default=0) + 1)

servers[target_key] = {
    "Name": server_name,
    "Group": "AST Forum",
    "Host": "postgres",
    "Port": 5432,
    "MaintenanceDB": db_name,
    "Username": "outline",
    "SSLMode": "prefer",
    "ConnectionParameters": {
        "sslmode": "prefer",
        "connect_timeout": 10,
        "passfile": ".pgpass"
    }
}

mode = path.stat().st_mode & 0o777
with path.open("w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
os.chmod(path, mode)
PY
  log "canonical servers.json includes $SERVER_NAME"
}

ensure_shared_pgpass_database
ensure_canonical_servers_json

for user_email in $PGADMIN_USERS; do
  merge_pgadmin_server "$user_email"
done

log "verifying pgAdmin passfiles can open $DB_NAME"
for user_email in $PGADMIN_USERS; do
  storage_user="$(printf '%s' "$user_email" | tr '[:upper:]' '[:lower:]' | sed 's/@/_/g')"
  if dc_pgadmin exec -T pgadmin test -d "/var/lib/pgadmin/storage/${storage_user}"; then
    dc_pgadmin exec -T --user 5050 pgadmin sh -s "$storage_user" "$DB_NAME" <<'SH'
set -eu
storage_user="$1"
db_name="$2"
if command -v psql >/dev/null 2>&1; then
  psql_bin="$(command -v psql)"
else
  psql_bin="/usr/local/pgsql-18/psql"
fi
PGPASSFILE="/var/lib/pgadmin/storage/${storage_user}/.pgpass" \
  "$psql_bin" -h postgres -U outline -d "$db_name" -v ON_ERROR_STOP=1 -X \
  -Atqc "SELECT current_database() || '|' || current_user"
SH
  fi
done

log "done"
log "database: $DB_NAME"
log "pgAdmin server: $SERVER_NAME"
