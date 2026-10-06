#!/usr/bin/env bash
set -euo pipefail
set +x

DB_NAME="${DB_NAME:-forum}"
APP_USER="${APP_USER:-forum_app}"
APP_ROLE="${APP_ROLE:-forum_app_role}"
APP_PASSFILE="${APP_PASSFILE:-forum_app.pgpass}"
SERVER_NAME="${SERVER_NAME:-AST Forum / Forum PostgreSQL}"
OUTLINE_COMPOSE="${OUTLINE_COMPOSE:-/opt/outline/docker-compose.yml}"
PGADMIN_COMPOSE="${PGADMIN_COMPOSE:-/opt/pgadmin/compose.yaml}"
PGADMIN_USERS="${PGADMIN_USERS:-admin@astforum.ru ceo@astforum.ru}"
PGADMIN_WAIT_SECONDS="${PGADMIN_WAIT_SECONDS:-120}"
PGADMIN_DIR="${PGADMIN_DIR:-/opt/pgadmin}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/forum-app-role}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_grants="${script_dir}/../forum-api/grant-runtime.sql"

# These identifiers are also inserted into pg_hba.conf and role DDL below.
for identifier in "$DB_NAME" "$APP_USER" "$APP_ROLE"; do
  if [[ ! "$identifier" =~ ^[a-z_][a-z0-9_]*$ ]] || [ "${#identifier}" -gt 63 ]; then
    printf '[forum-app] invalid PostgreSQL identifier: %s\n' "$identifier" >&2
    exit 1
  fi
done

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
  printf '[forum-app] %s\n' "$*"
}

require_file() {
  test -f "$1" || {
    printf '[forum-app] missing required file: %s\n' "$1" >&2
    exit 1
  }
}

require_file "$OUTLINE_COMPOSE"
require_file "$PGADMIN_COMPOSE"
require_file "$runtime_grants"

log "validating compose projects"
dc_outline config --quiet
dc_pgadmin config --quiet

postgres_id="$(dc_outline ps -q postgres)"
pgadmin_id="$(dc_pgadmin ps -q pgadmin)"
test -n "$postgres_id" || { printf '[forum-app] postgres container is not running\n' >&2; exit 1; }
test -n "$pgadmin_id" || { printf '[forum-app] pgAdmin container is not running\n' >&2; exit 1; }

# Fail before changing roles, files or registrations for an unknown/legacy schema.
dc_outline exec -T postgres psql -U outline -d "$DB_NAME" -v ON_ERROR_STOP=1 -X <<'SQL'
DO $$ BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Apply the public-schema migration before granting runtime access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema') THEN
    RAISE EXCEPTION 'Apply the public-schema migration before granting runtime access';
  END IF;
END $$;
SQL

backup_dir="${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup_dir"
install -m 0600 "$PGADMIN_COMPOSE" "$backup_dir/pgadmin-compose.yaml"
install -m 0600 "$PGADMIN_DIR/servers.json" "$backup_dir/servers.json"
install -m 0600 "$PGADMIN_DIR/secrets/outline_pgpass" "$backup_dir/outline_pgpass"
dc_pgadmin exec -T pgadmin /venv/bin/python3 - <<'PY'
import sqlite3

src = sqlite3.connect("/var/lib/pgadmin/pgadmin4.db")
dst = sqlite3.connect("/tmp/pgadmin4.db.forum-app-backup")
src.backup(dst)
dst.close()
src.close()
PY
docker cp "$pgadmin_id:/tmp/pgadmin4.db.forum-app-backup" "$backup_dir/pgadmin4.db"
dc_pgadmin exec -T pgadmin rm -f /tmp/pgadmin4.db.forum-app-backup
chmod 0600 "$backup_dir/pgadmin4.db"

hba_file="$(dc_outline exec -T postgres psql -U outline -d postgres -Atqc 'SHOW hba_file;')"
postgres_data_mount="$(docker inspect "$postgres_id" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Source}}{{end}}{{end}}')"
test -n "$postgres_data_mount" || { printf '[forum-app] cannot find PostgreSQL data mount\n' >&2; exit 1; }
hba_relative="${hba_file#/var/lib/postgresql/}"
hba_host_file="${postgres_data_mount}/${hba_relative}"
require_file "$hba_host_file"
install -m 0600 "$hba_host_file" "$backup_dir/pg_hba.conf"
log "backup created at $backup_dir"

password_file="${PGADMIN_DIR}/secrets/${APP_USER}_password"
umask 077
if [ ! -s "$password_file" ]; then
  openssl rand -base64 36 | tr -d '\n' > "$password_file"
fi
chown root:root "$password_file"
chmod 0400 "$password_file"
app_password="$(<"$password_file")"

log "creating PostgreSQL roles and grants"
dc_outline exec -T postgres psql -U outline -d postgres \
  -v ON_ERROR_STOP=1 -v app_password="$app_password" -X <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} LOGIN;
  END IF;
END
\$\$;

ALTER ROLE ${APP_ROLE}
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

ALTER ROLE ${APP_USER}
  LOGIN
  INHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  PASSWORD :'app_password';

GRANT ${APP_ROLE} TO ${APP_USER};
GRANT CONNECT, TEMPORARY ON DATABASE ${DB_NAME} TO ${APP_ROLE};
REVOKE CONNECT, TEMPORARY ON DATABASE ${DB_NAME} FROM PUBLIC;
SQL

dc_outline exec -T postgres psql -U outline -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v app_role="$APP_ROLE" -X < "$runtime_grants"

log "restricting ${APP_USER} to ${DB_NAME} in pg_hba.conf"
python3 - "$hba_host_file" "$DB_NAME" "$APP_USER" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
db_name = sys.argv[2]
app_user = sys.argv[3]
text = path.read_text()

start = "# forum_app isolation managed by Codex:start"
end = "# forum_app isolation managed by Codex:end"
block = f"""{start}
local   {db_name:<15} {app_user:<15}                         scram-sha-256
local   all             {app_user:<15}                         reject
host    {db_name:<15} {app_user:<15} all                     scram-sha-256
host    all             {app_user:<15} all                     reject
{end}
"""

if start in text and end in text:
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    text = before.rstrip() + "\n\n" + after.lstrip()

lines = text.splitlines(keepends=True)
insert_at = None
for idx, line in enumerate(lines):
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    insert_at = idx
    break

if insert_at is None:
    lines.append("\n")
    insert_at = len(lines)

lines[insert_at:insert_at] = [block, "\n"]
path.write_text("".join(lines))
PY

dc_outline exec -T postgres psql -U outline -d postgres -v ON_ERROR_STOP=1 -X <<'SQL'
SELECT pg_reload_conf();
SELECT line_number, error
FROM pg_hba_file_rules
WHERE error IS NOT NULL;
SQL

hba_errors="$(dc_outline exec -T postgres psql -U outline -d postgres -Atqc "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;")"
test "$hba_errors" = "0" || {
  printf '[forum-app] pg_hba.conf has %s error(s); backup is at %s\n' "$hba_errors" "$backup_dir" >&2
  exit 1
}

log "updating pgAdmin pgpass and server definitions"
pgpass_file="${PGADMIN_DIR}/secrets/outline_pgpass"
tmp_pgpass="$(mktemp "$PGADMIN_DIR/secrets/outline_pgpass.tmp.XXXXXX")"
awk -F: -v db="$DB_NAME" -v user="$APP_USER" '!(($3 == db || $3 == "*") && $4 == user)' "$pgpass_file" > "$tmp_pgpass"
first_line="$(grep -v '^[[:space:]]*#' "$pgpass_file" | head -n 1)"
old_ifs="$IFS"
IFS=:
read -r host port _database _username _password <<EOF
$first_line
EOF
IFS="$old_ifs"
printf '%s:%s:%s:%s:%s\n' "$host" "$port" "$DB_NAME" "$APP_USER" "$app_password" >> "$tmp_pgpass"
install -o "$(stat -c '%u' "$pgpass_file")" -g "$(stat -c '%g' "$pgpass_file")" -m "$(stat -c '%a' "$pgpass_file")" "$tmp_pgpass" "$pgpass_file"
rm -f "$tmp_pgpass"

python3 - "$PGADMIN_DIR/servers.json" "$SERVER_NAME" "$DB_NAME" "$APP_USER" "$APP_PASSFILE" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
server_name, db_name, app_user, app_passfile = sys.argv[2:]
data = json.loads(path.read_text(encoding="utf-8"))
servers = data.setdefault("Servers", {})
target_key = None
for key, server in servers.items():
    if server.get("Name") == server_name:
        target_key = key
        break
if target_key is None:
    numeric = [int(k) for k in servers if str(k).isdigit()]
    target_key = str(max(numeric, default=0) + 1)

servers[target_key] = {
    "Name": server_name,
    "Group": "AST Forum",
    "Host": "postgres",
    "Port": 5432,
    "MaintenanceDB": db_name,
    "Username": app_user,
    "SSLMode": "prefer",
    "ConnectionParameters": {
        "sslmode": "prefer",
        "connect_timeout": 10,
        "passfile": app_passfile
    }
}

mode = path.stat().st_mode & 0o777
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
os.chmod(path, mode)
PY

python3 - "$PGADMIN_COMPOSE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
if "      PGPASSFILE: /run/secrets/outline_pgpass\n" not in text:
    needle = "      PGPASS_FILE: /run/secrets/outline_pgpass\n"
    if needle not in text:
        raise SystemExit("PGPASS_FILE line not found in pgAdmin compose")
    text = text.replace(needle, needle + "      PGPASSFILE: /run/secrets/outline_pgpass\n", 1)
    path.write_text(text)
PY

log "recreating pgAdmin with PGPASSFILE environment and refreshed servers.json"
dc_pgadmin up -d --force-recreate pgadmin >/dev/null
pgadmin_ready=0
for _ in $(seq 1 "$PGADMIN_WAIT_SECONDS"); do
  if dc_pgadmin exec -T pgadmin wget -qO- http://127.0.0.1:5050/misc/ping 2>/dev/null | grep -qx PING; then
    pgadmin_ready=1
    break
  fi
  sleep 1
done
test "$pgadmin_ready" = "1" || {
  printf '[forum-app] pgAdmin did not become ready within %s seconds\n' "$PGADMIN_WAIT_SECONDS" >&2
  exit 1
}

pgadmin_id="$(dc_pgadmin ps -q pgadmin)"
test -n "$pgadmin_id" || {
  printf '[forum-app] pgAdmin container is not running after recreate\n' >&2
  exit 1
}

install_pgadmin_forum_passfile() {
  user_email="$1"
  storage_user="$(python3 - "$user_email" <<'PY'
import sys

username = sys.argv[1]
if not username or username[0].isdigit():
    username = "pga_user_" + username
print(username.replace("@", "_").replace("/", "slash").replace("\\", "slash"))
PY
)"
  pgadmin_data_mount="$(docker inspect "$pgadmin_id" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/pgadmin"}}{{.Source}}{{end}}{{end}}')"
  test -n "$pgadmin_data_mount" || {
    printf '[forum-app] cannot find pgAdmin data mount\n' >&2
    exit 1
  }
  dir="${pgadmin_data_mount}/storage/${storage_user}"
  dst="${dir}/${APP_PASSFILE}"
  install -d -o 5050 -g 0 -m 0700 "$dir"
  tmp="${dir}/${APP_PASSFILE}.tmp.$$"
  awk -F: -v db="$DB_NAME" -v user="$APP_USER" '
    ($3 == db || $3 == "*") && $4 == user { print; found = 1; exit }
    END { if (!found) exit 1 }
  ' "$pgpass_file" > "$tmp" || {
    rm -f "$tmp"
    printf '[forum-app] pgpass entry for %s/%s not found\n' "$DB_NAME" "$APP_USER" >&2
    exit 1
  }
  install -o 5050 -g 0 -m 0600 "$tmp" "$dst"
  rm -f "$tmp"
}

for user_email in $PGADMIN_USERS; do
  if dc_pgadmin exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py get-users \
    --username "$user_email" --json | grep -q "$user_email"; then
    install_pgadmin_forum_passfile "$user_email"
    dc_pgadmin exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py \
      load-servers /pgadmin4/servers.json --user "$user_email" --replace >/dev/null
    log "pgAdmin server synced for $user_email"
  else
    log "pgAdmin user $user_email absent; skipped"
  fi
done

log "verifying ${APP_USER} connectivity and permissions"
dc_pgadmin exec -T pgadmin sh -s "$APP_USER" "$DB_NAME" <<'SH'
set -eu
app_user="$1"
db_name="$2"
psql_bin="$(command -v psql || printf '/usr/local/pgsql-18/psql')"
PGPASSFILE=/run/secrets/outline_pgpass "$psql_bin" -h postgres -U "$app_user" -d "$db_name" -v ON_ERROR_STOP=1 -X <<'SQL'
SELECT current_database() AS database, current_user AS user;
BEGIN;
INSERT INTO public.users(id, display_name) VALUES (gen_random_uuid(), 'Codex runtime check') RETURNING id AS check_user_id \gset
UPDATE public.users SET display_name = 'Codex checked user' WHERE id = :'check_user_id';
ROLLBACK;
SQL
if PGPASSFILE=/run/secrets/outline_pgpass "$psql_bin" -h postgres -U "$app_user" -d outline -Atqc 'SELECT 1' >/tmp/forum_app_outline_check.out 2>/tmp/forum_app_outline_check.err; then
  cat /tmp/forum_app_outline_check.out
  printf 'forum_app unexpectedly connected to outline\n' >&2
  exit 1
fi
if PGPASSFILE=/run/secrets/outline_pgpass "$psql_bin" -h postgres -U "$app_user" -d postgres -Atqc 'SELECT 1' >/tmp/forum_app_postgres_check.out 2>/tmp/forum_app_postgres_check.err; then
  cat /tmp/forum_app_postgres_check.out
  printf 'forum_app unexpectedly connected to postgres\n' >&2
  exit 1
fi
printf 'non-forum database connections rejected as expected\n'
SH

dc_outline exec -T postgres psql -U outline -d postgres -v ON_ERROR_STOP=1 -X <<SQL
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('${APP_USER}', '${APP_ROLE}')
ORDER BY rolname;
SELECT pg_has_role('${APP_USER}', '${APP_ROLE}', 'member') AS app_has_role;
SQL

for user_email in $PGADMIN_USERS; do
  export_file="/tmp/forum-app-${user_email%@*}.json"
  dc_pgadmin exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py \
    dump-servers "$export_file" --user "$user_email" >/dev/null
  dc_pgadmin exec -T pgadmin /venv/bin/python3 - "$export_file" "$SERVER_NAME" "$APP_USER" "$user_email" "$DB_NAME" "$APP_PASSFILE" <<'PY'
import json
import sys

path, server_name, app_user, user_email, db_name, app_passfile = sys.argv[1:]
data = json.load(open(path, encoding="utf-8"))
for server in data.get("Servers", {}).values():
    if server.get("Name") == server_name:
        assert server.get("Username") == app_user, server
        assert server.get("MaintenanceDB") == db_name, server
        assert server.get("ConnectionParameters", {}).get("passfile") == app_passfile, server
        print(f"{user_email}: {server_name}|{server.get('MaintenanceDB')}|{server.get('Username')}")
        break
else:
    raise SystemExit(f"{server_name} not found for {user_email}")
PY
  dc_pgadmin exec -T pgadmin rm -f "$export_file"
done

log "done"
log "user: $APP_USER"
log "role: $APP_ROLE"
log "database: $DB_NAME"
