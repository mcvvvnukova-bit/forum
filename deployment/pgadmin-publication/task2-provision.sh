#!/usr/bin/env bash
# Task 2: provision the second pgAdmin Administrator and its server registration.
# Run only through the reviewed root staging command in task-2-report.md.

set -Eeuo pipefail
set +x
umask 077

readonly PGADMIN_COMPOSE=/opt/pgadmin/compose.yaml
readonly PGADMIN_SERVERS=/opt/pgadmin/servers.json
readonly PGADMIN_SECRETS=/opt/pgadmin/secrets
readonly ADMIN_SECRET="${PGADMIN_SECRETS}/admin_password"
readonly CEO_SECRET="${PGADMIN_SECRETS}/ceo_password"
readonly OUTLINE_PGPASS_SECRET="${PGADMIN_SECRETS}/outline_pgpass"
readonly BACKUP_MARKER=/root/.pgadmin-publication-last-backup
readonly ROOT_SCRIPT_PATH=/root/pgadmin-publication/task2-provision.sh
readonly CEO_EMAIL=ceo@astforum.ru
readonly ADMIN_EMAIL=admin@astforum.ru
readonly STORAGE_ROOT=/var/lib/pgadmin/storage

temp_secret=""
export_files=()

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
quietly() { "$@" >/dev/null 2>&1; }

require_quiet() {
  local description="$1"
  shift
  quietly "$@" || fail "$description"
  pass "$description"
}

require_file() {
  [[ -f "$1" && -s "$1" ]] || fail "required non-empty file is unavailable: $1"
}

require_root_owned_mode() {
  local mode owner
  mode="$(stat -c '%a' "$1" 2>/dev/null)" || fail "cannot inspect mode for $1"
  owner="$(stat -c '%u' "$1" 2>/dev/null)" || fail "cannot inspect owner for $1"
  [[ "$mode" == "$2" && "$owner" == 0 ]] || fail "restricted mode or root ownership check failed for $1"
}

require_mode_owner_group() {
  local expected_mode="$2"
  local expected_owner="$3"
  local expected_group="$4"
  local actual

  actual="$(stat -c '%a:%u:%g' "$1" 2>/dev/null)" || fail "cannot inspect mode or ownership for $1"
  [[ "$actual" == "$expected_mode:$expected_owner:$expected_group" ]] || \
    fail "mode or ownership check failed for $1"
}

assert_distinct_password_values() {
  [[ -n "$1" && -n "$2" && "$1" != "$2" ]]
}

user_json_has_email() {
  python3 -c '
import json, sys
email = sys.argv[1].casefold()
def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)
document = json.load(sys.stdin)
sys.exit(0 if any(str(item.get("email", "")).casefold() == email for item in walk(document)) else 1)
' "$1"
}

user_json_has_active_administrator() {
  python3 -c '
import json, sys
email = sys.argv[1].casefold()
def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)
for item in walk(json.load(sys.stdin)):
    if str(item.get("email", "")).casefold() != email: continue
    active = item.get("active") is True or item.get("is_active") is True
    administrator = item.get("is_admin") is True or item.get("is_administrator") is True or str(item.get("role", "")).casefold() == "administrator"
    if active and administrator: sys.exit(0)
sys.exit(1)
' "$1"
}

server_json_has_canonical_registration() {
  python3 -c '
import json, sys
document = json.load(sys.stdin)
servers = document.get("Servers", {})
values = servers.values() if isinstance(servers, dict) else servers if isinstance(servers, list) else ()
sys.exit(0 if any(isinstance(server, dict) and server.get("Name") == "AST Forum / Outline PostgreSQL" and server.get("Host") == "postgres" and server.get("Username") == "outline" for server in values) else 1)
'
}

require_outline_pgpass_secret() {
  local secret_path="${1:-$OUTLINE_PGPASS_SECRET}"

  require_file "$secret_path"
  require_mode_owner_group "$secret_path" 400 5050 5050
}

cleanup() {
  local export_file
  [[ -z "$temp_secret" ]] || rm -f -- "$temp_secret" || true
  for export_file in "${export_files[@]}"; do
    quietly docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin rm -f "$export_file" || true
  done
}

verify_root_staging() {
  local script_path
  [[ ${EUID} -eq 0 ]] || fail 'this script must run as root'
  script_path="$(readlink -f "$0" 2>/dev/null)" || fail 'cannot resolve script path'
  [[ "$script_path" == "$ROOT_SCRIPT_PATH" ]] || fail 'refusing to execute outside the root-owned staging path'
  require_root_owned_mode "$ROOT_SCRIPT_PATH" 700
  pass 'root-only staging path verified'
}

verify_task1_snapshot() {
  local marker_path="${1:-$BACKUP_MARKER}"
  local snapshot_parent="${2:-/opt/backups/pgadmin-publication}"
  local snapshot_path snapshot_artifact
  local snapshot_artifacts=(
    outline-docker-compose.yml
    Caddyfile
    pgadmin-compose.yaml
    servers.json
    pgadmin4.db
  )

  require_file "$marker_path"
  require_root_owned_mode "$marker_path" 600
  snapshot_path="$(<"$marker_path")"
  [[ "$snapshot_path" == "$snapshot_parent"/* && -d "$snapshot_path" ]] || fail 'Task 1 rollback snapshot marker is invalid'
  require_root_owned_mode "$snapshot_path" 700
  for snapshot_artifact in "${snapshot_artifacts[@]}"; do
    require_file "$snapshot_path/$snapshot_artifact"
    require_root_owned_mode "$snapshot_path/$snapshot_artifact" 600
  done
  pass 'Task 1 restricted rollback snapshot is available'
}

verify_baseline() {
  local pgadmin_id pgadmin_image ping_body

  verify_task1_snapshot

  require_file "$PGADMIN_COMPOSE"
  require_file "$PGADMIN_SERVERS"
  require_file "$ADMIN_SECRET"
  require_root_owned_mode "$ADMIN_SECRET" 400
  require_outline_pgpass_secret
  require_quiet 'pgAdmin Compose configuration is valid' docker compose -f "$PGADMIN_COMPOSE" config --quiet
  pgadmin_id="$(docker compose -f "$PGADMIN_COMPOSE" ps -q pgadmin 2>/dev/null)" || fail 'cannot determine the pgAdmin Compose container ID'
  [[ -n "$pgadmin_id" ]] || fail 'pgAdmin Compose container is not running'
  pgadmin_image="$(docker inspect --format '{{.Config.Image}}' "$pgadmin_id" 2>/dev/null)" || fail 'cannot inspect the pgAdmin image'
  [[ "$pgadmin_image" == 'dpage/pgadmin4:9.17' ]] || fail 'pgAdmin image is not dpage/pgadmin4:9.17'
  pass 'pgAdmin image is dpage/pgadmin4:9.17'
  ping_body="$(curl -fsS http://127.0.0.1:5050/misc/ping 2>/dev/null)" || fail 'pgAdmin ping request failed'
  [[ "$ping_body" == PING ]] || fail 'pgAdmin ping did not return PING'
  pass 'pgAdmin ping returned PING'
}

create_or_verify_ceo_secret() {
  local admin_password ceo_password
  if [[ ! -s "$CEO_SECRET" ]]; then
    temp_secret="$(mktemp "$PGADMIN_SECRETS/.ceo_password.XXXXXX")" || fail 'cannot create a temporary CEO password file'
    openssl rand -base64 36 | tr -d '\n' > "$temp_secret" || fail 'cannot generate the CEO password'
    admin_password="$(<"$ADMIN_SECRET")"
    ceo_password="$(<"$temp_secret")"
    assert_distinct_password_values "$ceo_password" "$admin_password" || fail 'generated CEO password matches the existing administrator password'
    unset admin_password ceo_password
    install -o root -g root -m 0400 "$temp_secret" "$CEO_SECRET" || fail 'cannot install the CEO password file'
    rm -f -- "$temp_secret"
    temp_secret=""
  fi
  chown root:root "$CEO_SECRET" || fail 'cannot set CEO password ownership'
  chmod 0400 "$CEO_SECRET" || fail 'cannot set CEO password mode'
  require_file "$CEO_SECRET"
  require_root_owned_mode "$CEO_SECRET" 400
  admin_password="$(<"$ADMIN_SECRET")"
  ceo_password="$(<"$CEO_SECRET")"
  assert_distinct_password_values "$ceo_password" "$admin_password" || fail 'CEO password matches the existing administrator password'
  unset admin_password ceo_password
  pass 'CEO password exists once with restricted ownership and a distinct value'
}

synchronize_ceo_administrator() {
  local ceo_password existing_user_json
  ceo_password="$(<"$CEO_SECRET")"
  existing_user_json="$(docker compose -f "$PGADMIN_COMPOSE" exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py get-users --username "$CEO_EMAIL" --json 2>/dev/null)" || fail 'cannot query the CEO pgAdmin account'
  if printf '%s' "$existing_user_json" | user_json_has_email "$CEO_EMAIL" >/dev/null 2>&1; then
    quietly docker compose -f "$PGADMIN_COMPOSE" exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py update-user "$CEO_EMAIL" --password "$ceo_password" --admin --active || fail 'cannot synchronize the CEO pgAdmin account'
  else
    quietly docker compose -f "$PGADMIN_COMPOSE" exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py add-user "$CEO_EMAIL" "$ceo_password" --admin --active || fail 'cannot create the CEO pgAdmin account'
  fi
  unset ceo_password existing_user_json
  pass 'CEO pgAdmin account is synchronized without disclosing its password'
}

install_ceo_storage_pgpass() {
  docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin sh -lc \
    'install -d -m 0700 /var/lib/pgadmin/storage/ceo_astforum.ru && install -m 0400 /run/secrets/outline_pgpass /var/lib/pgadmin/storage/ceo_astforum.ru/.pgpass'
}

import_ceo_registration() {
  require_quiet 'canonical pgAdmin server definition imported for CEO' docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py load-servers /pgadmin4/servers.json --user "$CEO_EMAIL" --replace
  require_quiet 'CEO pgAdmin storage password file is installed with restricted mode' install_ceo_storage_pgpass
}

verify_active_administrator() {
  local email="$1" user_json
  user_json="$(docker compose -f "$PGADMIN_COMPOSE" exec -T pgadmin /venv/bin/python3 /pgadmin4/setup.py get-users --username "$email" --json 2>/dev/null)" || fail "cannot query the pgAdmin account for $email"
  printf '%s' "$user_json" | user_json_has_active_administrator "$email" >/dev/null 2>&1 || fail "pgAdmin account is not an active Administrator: $email"
  unset user_json
  pass "pgAdmin account is an active Administrator: $email"
}

verify_server_registration() {
  local email="$1"
  local export_file="/tmp/pgadmin-task2-servers-${email%@*}.json"
  export_files+=("$export_file")
  require_quiet "server registration exported for $email" docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin /venv/bin/python3 /pgadmin4/setup.py dump-servers "$export_file" --user "$email"
  if ! docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin cat "$export_file" 2>/dev/null | \
    server_json_has_canonical_registration >/dev/null 2>&1; then
    fail "canonical server registration verification failed for $email"
  fi
  pass "canonical server registration verified for $email"
  require_quiet "server registration export removed for $email" docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin rm -f "$export_file"
}

verify_storage_pgpass() {
  local storage_user="$1"
  require_quiet "restricted storage password file verified for $storage_user" docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin sh -lc "test \"\$(stat -c '%a:%u:%g' '$STORAGE_ROOT/$storage_user/.pgpass')\" = '400:5050:5050'"
}

verify_rollback_only_privileges() {
  local storage_user="$1"
  if ! docker compose -f "$PGADMIN_COMPOSE" exec -T --user 5050 pgadmin sh -lc "PGPASSFILE=$STORAGE_ROOT/$storage_user/.pgpass /usr/local/pgsql-18/psql -h postgres -U outline -d outline -v ON_ERROR_STOP=1 -X" >/dev/null 2>&1 <<'SQL'
BEGIN;
CREATE TABLE public.codex_pgadmin_privilege_check (id integer PRIMARY KEY);
INSERT INTO public.codex_pgadmin_privilege_check VALUES (1);
UPDATE public.codex_pgadmin_privilege_check SET id = 2 WHERE id = 1;
DELETE FROM public.codex_pgadmin_privilege_check WHERE id = 2;
ROLLBACK;
DO $$
BEGIN
  IF current_database() <> 'outline' OR current_user <> 'outline' OR to_regclass('public.codex_pgadmin_privilege_check') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback-only privilege check failed';
  END IF;
END
$$;
SQL
  then
    fail "rollback-only full database privilege check failed for $storage_user"
  fi
  pass "rollback-only full database privilege check passed for $storage_user"
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

trap 'status=$?; printf "FAIL: Task 2 provisioning stopped (exit %d)\n" "$status" >&2' ERR
trap cleanup EXIT

verify_root_staging
verify_baseline
create_or_verify_ceo_secret
synchronize_ceo_administrator
import_ceo_registration
for email in "$ADMIN_EMAIL" "$CEO_EMAIL"; do
  verify_active_administrator "$email"
  verify_server_registration "$email"
done
for storage_user in admin_astforum.ru ceo_astforum.ru; do
  verify_storage_pgpass "$storage_user"
  verify_rollback_only_privileges "$storage_user"
done
pass 'Task 2 CEO Administrator provisioning completed'
