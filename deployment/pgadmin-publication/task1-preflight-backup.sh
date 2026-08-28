#!/usr/bin/env bash
# Task 1 production preflight and restricted rollback snapshot for pgAdmin.
# Usage: operator runs `sudo bash /home/testing-user/pgadmin-deploy/task1-preflight-backup.sh`
# from their normal Terminal. Do not run this script through the output-only Codex PTY.

set -Eeuo pipefail
set +x
umask 077

readonly OUTLINE_COMPOSE=/opt/outline/docker-compose.yml
readonly OUTLINE_CADDYFILE=/opt/outline/Caddyfile
readonly PGADMIN_COMPOSE=/opt/pgadmin/compose.yaml
readonly PGADMIN_SERVERS=/opt/pgadmin/servers.json
readonly BACKUP_PARENT=/opt/backups/pgadmin-publication
readonly BACKUP_MARKER=/root/.pgadmin-publication-last-backup
readonly CONTAINER_DB_BACKUP=/tmp/pgadmin4.db.backup

pgadmin_id=""
caddy_id=""

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

trap 'status=$?; printf "FAIL: preflight stopped (exit %d)\n" "$status" >&2' ERR

quietly() {
  "$@" >/dev/null 2>&1
}

require_quiet() {
  local description="$1"
  shift
  quietly "$@" || fail "$description"
  pass "$description"
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "required file is unavailable: $path"
  pass "required file is present: $path"
}

require_mode_and_owner() {
  local path="$1"
  local expected_mode="$2"
  local mode owner

  mode="$(stat -c '%a' "$path" 2>/dev/null)" || fail "cannot read mode for $path"
  owner="$(stat -c '%u' "$path" 2>/dev/null)" || fail "cannot read owner for $path"
  [[ "$mode" == "$expected_mode" && "$owner" == 0 ]] || \
    fail "restricted mode or root ownership check failed for $path"
  pass "restricted mode and root ownership verified: $path"
}

cleanup_container_backup() {
  if [[ -n "$pgadmin_id" ]]; then
    quietly docker exec "$pgadmin_id" rm -f "$CONTAINER_DB_BACKUP" || true
  fi
}

if [[ ${EUID} -eq 0 ]]; then
  pass 'root execution confirmed'
else
  fail 'this script must run as root'
fi

trap cleanup_container_backup EXIT

# Step 2: establish the active production baseline without printing configuration.
require_file "$OUTLINE_COMPOSE"
require_file "$OUTLINE_CADDYFILE"
require_file "$PGADMIN_COMPOSE"
require_file "$PGADMIN_SERVERS"
require_quiet 'Outline Compose configuration is valid' \
  docker compose -f /opt/outline/docker-compose.yml config --quiet
require_quiet 'pgAdmin Compose configuration is valid' \
  docker compose -f /opt/pgadmin/compose.yaml config --quiet

pgadmin_id="$(docker compose -f /opt/pgadmin/compose.yaml ps -q pgadmin 2>/dev/null)" || \
  fail 'cannot determine the pgAdmin Compose container ID'
caddy_id="$(docker compose -f /opt/outline/docker-compose.yml ps -q caddy 2>/dev/null)" || \
  fail 'cannot determine the Caddy Compose container ID'
[[ -n "$pgadmin_id" ]] || fail 'pgAdmin Compose container is not running'
[[ -n "$caddy_id" ]] || fail 'Caddy Compose container is not running'
pass 'pgAdmin and Caddy Compose containers are running'

pgadmin_image="$(docker inspect --format '{{.Config.Image}}' "$pgadmin_id" 2>/dev/null)" || \
  fail 'cannot inspect the pgAdmin image'
[[ "$pgadmin_image" == 'dpage/pgadmin4:9.17' ]] || \
  fail 'pgAdmin image is not dpage/pgadmin4:9.17'
pass 'pgAdmin image is dpage/pgadmin4:9.17'

caddy_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$caddy_id" 2>/dev/null)" || \
  fail 'cannot inspect Caddy Docker networks'
pgadmin_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$pgadmin_id" 2>/dev/null)" || \
  fail 'cannot inspect pgAdmin Docker networks'
shared_network=""
for network in $caddy_networks; do
  if [[ " $pgadmin_networks " == *" $network "* ]]; then
    shared_network="$network"
    break
  fi
done
[[ -n "$shared_network" ]] || fail 'Caddy and pgAdmin do not share a Docker network'
pass "shared Docker network: $shared_network"

listening_sockets="$(ss -ltnp 2>/dev/null)" || fail 'cannot inspect listening TCP sockets'
if ! printf '%s\n' "$listening_sockets" | awk '$0 ~ /127\.0\.0\.1:5050([[:space:]]|$)/ { found=1 } END { exit !found }'; then
  fail 'pgAdmin is not listening on 127.0.0.1:5050'
fi
pass 'pgAdmin loopback listener is present'

caddy_pid="$(docker inspect --format '{{.State.Pid}}' "$caddy_id" 2>/dev/null)" || \
  fail 'cannot inspect the Caddy process ID'
[[ "$caddy_pid" =~ ^[1-9][0-9]*$ ]] || fail 'Caddy process ID is invalid'
for public_port in 80 443; do
  if ! printf '%s\n' "$listening_sockets" | \
    awk -v port="$public_port" -v process="pid=$caddy_pid" \
      '$0 ~ (":" port "([[:space:]]|$)") && index($0, process) { found=1 } END { exit !found }'; then
    fail "Caddy does not own public TCP port $public_port"
  fi
done
pass 'Caddy owns public TCP ports 80 and 443'

# Step 3: make a root-only, consistent rollback snapshot.
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$BACKUP_PARENT/$backup_stamp"
backup_suffix=1
while [[ -e "$backup_dir" ]]; do
  backup_dir="$BACKUP_PARENT/$backup_stamp-$backup_suffix"
  ((backup_suffix += 1))
done

require_quiet 'restricted rollback directory created' install -d -m 0700 "$backup_dir"
require_quiet 'Outline Compose copied to rollback snapshot' \
  install -m 0600 /opt/outline/docker-compose.yml "$backup_dir/outline-docker-compose.yml"
require_quiet 'Caddyfile copied to rollback snapshot' \
  install -m 0600 /opt/outline/Caddyfile "$backup_dir/Caddyfile"
require_quiet 'pgAdmin Compose copied to rollback snapshot' \
  install -m 0600 /opt/pgadmin/compose.yaml "$backup_dir/pgadmin-compose.yaml"
require_quiet 'pgAdmin server definitions copied to rollback snapshot' \
  install -m 0600 /opt/pgadmin/servers.json "$backup_dir/servers.json"

require_quiet 'stale in-container SQLite backup removed' \
  docker exec "$pgadmin_id" rm -f "$CONTAINER_DB_BACKUP"
require_quiet 'consistent pgAdmin SQLite backup created in container' \
  docker exec "$pgadmin_id" /venv/bin/python3 -c "import sqlite3; src=sqlite3.connect('/var/lib/pgadmin/pgadmin4.db'); dst=sqlite3.connect('/tmp/pgadmin4.db.backup'); src.backup(dst); dst.close(); src.close()"
require_quiet 'pgAdmin SQLite backup copied to rollback snapshot' \
  docker cp "$pgadmin_id:$CONTAINER_DB_BACKUP" "$backup_dir/pgadmin4.db"
require_quiet 'in-container SQLite backup removed' \
  docker exec "$pgadmin_id" rm -f "$CONTAINER_DB_BACKUP"
require_quiet 'pgAdmin SQLite backup mode restricted' chmod 0600 "$backup_dir/pgadmin4.db"

printf '%s\n' "$backup_dir" > "$BACKUP_MARKER"
require_quiet 'rollback marker mode restricted' chmod 0600 "$BACKUP_MARKER"

require_mode_and_owner "$backup_dir" 700
snapshot_files=(
  "$backup_dir/outline-docker-compose.yml"
  "$backup_dir/Caddyfile"
  "$backup_dir/pgadmin-compose.yaml"
  "$backup_dir/servers.json"
  "$backup_dir/pgadmin4.db"
)
for snapshot_file in "${snapshot_files[@]}"; do
  [[ -s "$snapshot_file" ]] || fail "rollback snapshot file is empty: $snapshot_file"
  require_mode_and_owner "$snapshot_file" 600
done
[[ -s "$BACKUP_MARKER" ]] || fail 'rollback marker is empty'
require_mode_and_owner "$BACKUP_MARKER" 600
marker_value="$(<"$BACKUP_MARKER")"
[[ "$marker_value" == "$backup_dir" ]] || fail 'rollback marker does not name this snapshot'
pass "rollback snapshot verified: $backup_dir"

# Step 4: record the required health checks without exposing their payloads.
pgadmin_ping="$(curl -fsS http://127.0.0.1:5050/misc/ping 2>/dev/null)" || \
  fail 'pgAdmin ping request failed'
[[ "$pgadmin_ping" == SUCCESS ]] || fail 'pgAdmin ping did not return SUCCESS'
pass 'pgAdmin ping returned SUCCESS'

pgadmin_users="$(docker compose -f /opt/pgadmin/compose.yaml exec -T pgadmin \
  /venv/bin/python3 /pgadmin4/setup.py get-users --username admin@astforum.ru --json 2>/dev/null)" || \
  fail 'cannot query the pgAdmin administrator account'
if ! grep -Fq 'admin@astforum.ru' <<< "$pgadmin_users" || \
  ! grep -Eqi '"(is_)?active"[[:space:]]*:[[:space:]]*true' <<< "$pgadmin_users" || \
  ! grep -Eqi 'administrator|"is_admin"[[:space:]]*:[[:space:]]*true' <<< "$pgadmin_users"; then
  fail 'pgAdmin administrator account is not active Administrator'
fi
pass 'pgAdmin administrator account is active Administrator'

require_quiet 'Caddy configuration validates' \
  docker compose -f /opt/outline/docker-compose.yml exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

pass 'Task 1 preflight and rollback snapshot completed'
