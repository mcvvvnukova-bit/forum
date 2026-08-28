#!/usr/bin/env bash
# Task 1 production preflight and restricted rollback snapshot for pgAdmin.
# Usage: use the one-command root staging procedure in task-1-report.md. It must copy
# this file to the root-only path below, verify its reviewed SHA-256, then execute that copy.
# Never execute this user-owned upload directly through sudo or the output-only Codex PTY.

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
readonly ROOT_SCRIPT_PATH=/root/pgadmin-publication/task1-preflight-backup.sh

pgadmin_id=""
caddy_id=""
postgres_id=""
redis_id=""

pass() {
  printf 'PASS: %s\n' "$1"
}

info() {
  printf 'INFO: %s\n' "$1"
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

inspect_container_bindings() {
  docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{$port}}{{range $bindings}} {{.HostIp}}:{{.HostPort}}{{end}}{{"\n"}}{{end}}' "$1" 2>/dev/null
}

bindings_for_port() {
  local bindings="$1"
  local container_port="$2"

  awk -v port="$container_port" '$1 == port { for (i = 2; i <= NF; i += 1) print $i }' <<< "$bindings"
}

is_loopback_binding() {
  case "$1" in
    127.0.0.1:*|::1:*) return 0 ;;
    *) return 1 ;;
  esac
}

require_exact_loopback_binding() {
  local bindings="$1"
  local container_port="$2"
  local expected_binding="$3"
  local service_name="$4"
  local actual_bindings

  actual_bindings="$(bindings_for_port "$bindings" "$container_port")"
  [[ "$actual_bindings" == "$expected_binding" ]] || \
    fail "$service_name does not have exactly the required loopback Docker binding"
  pass "exact loopback binding verified for $service_name"
}

reject_public_bindings() {
  local bindings="$1"
  local container_port="$2"
  local service_name="$3"
  local binding

  while IFS= read -r binding; do
    [[ -z "$binding" ]] && continue
    is_loopback_binding "$binding" || fail "$service_name has a non-loopback Docker binding"
  done < <(bindings_for_port "$bindings" "$container_port")
  pass "$service_name has no non-loopback Docker binding"
}

require_caddy_http_binding() {
  local bindings="$1"
  local binding found public_found

  found=0
  public_found=0
  while IFS= read -r binding; do
    if [[ "$binding" == *':80' ]]; then
      found=1
      is_loopback_binding "$binding" || public_found=1
    fi
  done < <(bindings_for_port "$bindings" 80/tcp)
  (( found == 1 )) || fail 'Caddy Compose container has no host binding for TCP 80'
  (( public_found == 1 )) || fail 'Caddy Compose container has no non-loopback host binding for TCP 80'
  pass 'Caddy Compose container exposes public TCP port 80'
}

require_absent_caddy_tcp_443_binding() {
  local bindings="$1"
  local tcp_443

  tcp_443="$(bindings_for_port "$bindings" 443/tcp)"
  [[ -z "$tcp_443" ]] || fail 'Caddy Compose container has unexpected host binding for TCP 443'
  pass 'Caddy Compose container has no TCP 443 host binding; upstream TLS topology confirmed'
}

record_shared_network() {
  local caddy_networks="$1"
  local pgadmin_networks="$2"
  local network

  for network in $caddy_networks; do
    if [[ " $pgadmin_networks " == *" $network "* ]]; then
      pass "shared Docker network recorded: $network"
      return 0
    fi
  done
  info 'Caddy and pgAdmin share no Docker network; snapshot may proceed before attachment'
}

require_loopback_listener() {
  local port="$1"
  local service_name="$2"
  local listener_count

  listener_count="$(awk -v port="$port" '$4 == "127.0.0.1:" port { count += 1 } END { print count + 0 }' <<< "$listening_sockets")"
  [[ "$listener_count" == 1 ]] || fail "$service_name does not have exactly one loopback listener"
  pass "exact loopback listener verified for $service_name"
}

reject_public_listener() {
  local port="$1"
  local service_name="$2"

  if awk -v port="$port" '
    $4 ~ (":" port "$") && $4 != "127.0.0.1:" port && $4 != "::1:" port && $4 != "[::1]:" port { public_listener = 1 }
    END { exit(public_listener ? 0 : 1) }
  ' <<< "$listening_sockets"; then
    fail "$service_name has a non-loopback host listener"
  fi
  pass "$service_name has no non-loopback host listener"
}

require_listener() {
  local port="$1"
  local service_name="$2"

  if ! awk -v port="$port" '$4 ~ (":" port "$") { listener = 1 } END { exit(listener ? 0 : 1) }' <<< "$listening_sockets"; then
    fail "$service_name has no host listener on TCP $port"
  fi
  pass "$service_name host listener is present on TCP $port"
}

require_absent_listener() {
  local port="$1"
  local service_name="$2"

  if awk -v port="$port" '$4 ~ (":" port "$") { listener = 1 } END { exit(listener ? 0 : 1) }' <<< "$listening_sockets"; then
    fail "$service_name has unexpected host TCP $port listener"
  fi
  pass "$service_name has no host TCP $port listener"
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

if [[ ${EUID} -eq 0 ]]; then
  pass 'root execution confirmed'
else
  fail 'this script must run as root'
fi

script_path="$(readlink -f "$0" 2>/dev/null)" || fail 'cannot resolve script path'
[[ "$script_path" == "$ROOT_SCRIPT_PATH" ]] || fail 'refusing to execute outside the root-owned staging path'
require_mode_and_owner "$ROOT_SCRIPT_PATH" 700

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
postgres_id="$(docker compose -f /opt/outline/docker-compose.yml ps -q postgres 2>/dev/null)" || \
  fail 'cannot determine the PostgreSQL Compose container ID'
redis_id="$(docker compose -f /opt/outline/docker-compose.yml ps -q redis 2>/dev/null)" || \
  fail 'cannot determine the Redis Compose container ID'
[[ -n "$pgadmin_id" ]] || fail 'pgAdmin Compose container is not running'
[[ -n "$caddy_id" ]] || fail 'Caddy Compose container is not running'
[[ -n "$postgres_id" ]] || fail 'PostgreSQL Compose container is not running'
[[ -n "$redis_id" ]] || fail 'Redis Compose container is not running'
pass 'pgAdmin, Caddy, PostgreSQL, and Redis Compose containers are running'

pgadmin_image="$(docker inspect --format '{{.Config.Image}}' "$pgadmin_id" 2>/dev/null)" || \
  fail 'cannot inspect the pgAdmin image'
[[ "$pgadmin_image" == 'dpage/pgadmin4:9.17' ]] || \
  fail 'pgAdmin image is not dpage/pgadmin4:9.17'
pass 'pgAdmin image is dpage/pgadmin4:9.17'

caddy_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$caddy_id" 2>/dev/null)" || \
  fail 'cannot inspect Caddy Docker networks'
pgadmin_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$pgadmin_id" 2>/dev/null)" || \
  fail 'cannot inspect pgAdmin Docker networks'
record_shared_network "$caddy_networks" "$pgadmin_networks"

pgadmin_bindings="$(inspect_container_bindings "$pgadmin_id")" || \
  fail 'cannot inspect pgAdmin Docker port bindings'
caddy_bindings="$(inspect_container_bindings "$caddy_id")" || \
  fail 'cannot inspect Caddy Docker port bindings'
postgres_bindings="$(inspect_container_bindings "$postgres_id")" || \
  fail 'cannot inspect PostgreSQL Docker port bindings'
redis_bindings="$(inspect_container_bindings "$redis_id")" || \
  fail 'cannot inspect Redis Docker port bindings'

require_exact_loopback_binding "$pgadmin_bindings" 5050/tcp 127.0.0.1:5050 'pgAdmin 5050'
reject_public_bindings "$pgadmin_bindings" 5050/tcp 'pgAdmin 5050'
reject_public_bindings "$postgres_bindings" 5432/tcp 'PostgreSQL 5432'
reject_public_bindings "$redis_bindings" 6379/tcp 'Redis 6379'
require_caddy_http_binding "$caddy_bindings"
require_absent_caddy_tcp_443_binding "$caddy_bindings"

listening_sockets="$(ss -ltnp 2>/dev/null)" || fail 'cannot inspect listening TCP sockets'
require_loopback_listener 5050 'pgAdmin 5050'
reject_public_listener 5050 'pgAdmin 5050'
reject_public_listener 5432 'PostgreSQL 5432'
reject_public_listener 6379 'Redis 6379'
require_listener 80 'Caddy'
require_absent_listener 443 'Caddy TLS'

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
