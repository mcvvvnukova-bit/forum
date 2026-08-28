#!/usr/bin/env bash
# Task 3 root-only publication of pgAdmin through the HTTP-only Caddy origin.
set -Eeuo pipefail
set +x
umask 077

readonly ROOT_SCRIPT_PATH=/root/pgadmin-publication/task3-publish.sh
readonly ROOT_DEPLOY_DIR=/root/pgadmin-publication
readonly ROOT_CADDY="$ROOT_DEPLOY_DIR/task3-Caddyfile.candidate"
readonly ROOT_COMPOSE="$ROOT_DEPLOY_DIR/task3-pgadmin-compose.candidate.yaml"
readonly OUTLINE_COMPOSE=/opt/outline/docker-compose.yml
readonly OUTLINE_CADDY=/opt/outline/Caddyfile
readonly PGADMIN_COMPOSE=/opt/pgadmin/compose.yaml
readonly BACKUP_MARKER=/root/.pgadmin-publication-last-backup
readonly BACKUP_PARENT=/opt/backups/pgadmin-publication
readonly FRONTEND_NETWORK=outline_frontend
readonly ACTIVE_CADDY_SHA=58d2d055109b06165467cded49860be63b166593b3fc76d61461ec868ca7db7e
readonly ACTIVE_COMPOSE_SHA=fad20a2f71534bba65f85bf249a1dd300bb20947361f4b76a4af8c08f98ab92f
readonly CANDIDATE_CADDY_SHA=100224644bcff315e79f0f5ff5c7ebaf1f7e58d7f34a2fe4d88144520bb00e55
readonly CANDIDATE_COMPOSE_SHA=89ef7bb04008063fb2ba2a60e1d53e212d4cee3db5a9e87f2628b578f9848142

caddy_id=""
pgadmin_id=""
preapply_dir=""
mutation_started=0
publication_already_applied=0

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
  [[ -f "$1" && -s "$1" ]] || fail "required file is unavailable: $1"
}

sha256_of() { sha256sum "$1" | awk '{print $1}'; }

require_exact_sha() {
  local path="$1" expected="$2" actual
  require_file "$path"
  actual="$(sha256_of "$path")" || fail "cannot hash $path"
  [[ "$actual" == "$expected" ]] || fail "unexpected SHA-256 for $path"
}

require_root_owned_mode() {
  local path="$1" expected_mode="$2" actual
  actual="$(stat -c '%a:%u:%g' "$path" 2>/dev/null)" || fail "cannot inspect $path"
  [[ "$actual" == "$expected_mode:0:0" ]] || fail "unexpected owner or mode for $path"
}

verify_root_candidate_file() {
  local path="$1" root_directory="$2" resolved_path resolved_root_directory metadata

  require_file "$path"
  resolved_path="$(readlink -f "$path" 2>/dev/null)" || fail "cannot resolve root candidate path: $path"
  resolved_root_directory="$(readlink -f "$root_directory" 2>/dev/null)" || fail "cannot resolve root deployment directory: $root_directory"
  [[ "$resolved_path" == "$resolved_root_directory/"* ]] || fail "candidate is outside the root-only deployment directory: $path"
  metadata="$(stat -c '%a:%u:%g' "$resolved_path" 2>/dev/null)" || fail "cannot inspect root candidate: $path"
  [[ "$metadata" == '400:0:0' ]] || fail "candidate is not root-owned mode 0400: $path"
}

require_exact_loopback_binding() {
  local bindings="$1" actual
  actual="$(awk '$1 == "5050/tcp" { for (i = 2; i <= NF; i++) print $i }' <<< "$bindings")"
  [[ "$actual" == '127.0.0.1:5050' ]] || fail 'pgAdmin 5050 is not exactly loopback-bound'
}

require_absent_caddy_443_bindings() {
  local bindings="$1" tcp udp
  tcp="$(awk '$1 == "443/tcp" { print }' <<< "$bindings")"
  udp="$(awk '$1 == "443/udp" { print }' <<< "$bindings")"
  [[ -z "$tcp" && -z "$udp" ]] || fail 'Caddy has an unexpected Docker TCP or UDP 443 binding'
}

require_absent_host_tcp_443() {
  local sockets
  sockets="$(ss -ltnH 2>/dev/null)" || fail 'cannot inspect host TCP listeners'
  if awk '$4 ~ /:443$/ { found = 1 } END { exit(found ? 0 : 1) }' <<< "$sockets"; then
    fail 'host has an unexpected TCP 443 listener'
  fi
}

require_absent_host_udp_443() {
  local sockets="${1:-}"

  if [[ -z "$sockets" ]]; then
    sockets="$(ss -lunH 2>/dev/null)" || fail 'cannot inspect host UDP listeners'
  fi
  if awk '$4 ~ /:443$/ { found = 1 } END { exit(found ? 0 : 1) }' <<< "$sockets"; then
    fail 'host has an unexpected UDP 443 listener'
  fi
}

require_exact_ping() {
  [[ "$1" == PING ]] || fail 'pgAdmin ping did not return exact PING'
}

verify_caddy_candidate_layout() {
  local candidate="$1" host_count handle_count final_404_count
  require_file "$candidate"
  host_count="$(grep -Fxc '    @pgadmin host pg.astforum.ru' "$candidate" || true)"
  handle_count="$(grep -Fxc '    handle @pgadmin {' "$candidate" || true)"
  final_404_count="$(grep -Fxc '    respond 404' "$candidate" || true)"
  [[ "$host_count" == 1 && "$handle_count" == 1 && "$final_404_count" == 1 ]] || fail 'Caddy candidate does not contain exactly one host-matched pgAdmin handler'
  ! grep -Eq '^[[:space:]]*pg\.astforum\.ru[[:space:]]*\{' "$candidate" || fail 'Caddy candidate contains a standalone pgAdmin HTTPS site'
  ! grep -Eq '(^|[^[:alnum:]_.-])(:443|https://)' "$candidate" || fail 'Caddy candidate is not HTTP-only'
  grep -Fqx '        encode zstd gzip' "$candidate" || fail 'Caddy candidate lacks approved response encoding'
  grep -Fqx '            -Server' "$candidate" || fail 'Caddy candidate does not remove Server'
  grep -Fqx '            Strict-Transport-Security "max-age=31536000"' "$candidate" || fail 'Caddy candidate lacks approved HSTS'
  grep -Fqx '            X-Content-Type-Options "nosniff"' "$candidate" || fail 'Caddy candidate lacks nosniff'
  grep -Fqx '            X-Frame-Options "SAMEORIGIN"' "$candidate" || fail 'Caddy candidate lacks SAMEORIGIN'
  grep -Fqx '            Referrer-Policy "same-origin"' "$candidate" || fail 'Caddy candidate lacks same-origin referrer policy'
  grep -Fqx '        reverse_proxy pgadmin:5050 {' "$candidate" || fail 'Caddy candidate does not proxy to pgadmin:5050'
  grep -Fqx '            header_up X-Forwarded-Proto https' "$candidate" || fail 'Caddy candidate lacks HTTPS forwarding'
  grep -Fqx '            header_up X-Forwarded-Host {http.request.host}' "$candidate" || fail 'Caddy candidate lacks dynamic host forwarding'
  awk '/    @pgadmin host pg\.astforum\.ru/ { pgadmin = NR } /    respond 404/ { final_404 = NR } END { exit(pgadmin && final_404 > pgadmin ? 0 : 1) }' "$candidate" || fail 'Caddy pgAdmin handler is not before the final 404'
}

verify_compose_candidate_layout() {
  local candidate="$1"
  require_file "$candidate"
  [[ "$(grep -Fxc '      - outline-backend' "$candidate" || true)" == 1 ]] || fail 'pgAdmin must retain exactly one outline-backend attachment'
  [[ "$(grep -Fxc '      - pgadmin-access' "$candidate" || true)" == 1 ]] || fail 'pgAdmin must retain exactly one pgadmin-access attachment'
  [[ "$(grep -Fxc '      - outline-frontend' "$candidate" || true)" == 1 ]] || fail 'pgAdmin must join outline_frontend exactly once'
  grep -Fqx '  outline-frontend:' "$candidate" || fail 'Compose candidate does not declare outline-frontend'
  awk '/^  outline-frontend:$/ { frontend = 1; next } frontend && /^    external: true$/ { external = 1 } END { exit(external ? 0 : 1) }' "$candidate" || fail 'Compose candidate does not declare outline_frontend external'
  grep -Fqx '    name: outline_frontend' "$candidate" || fail 'Compose candidate does not use the existing outline_frontend network'
  grep -Fqx '      - "127.0.0.1:5050:5050"' "$candidate" || fail 'Compose candidate does not retain the loopback 5050 mapping'
  grep -Fqx '    image: dpage/pgadmin4:9.17' "$candidate" || fail 'Compose candidate changes the pgAdmin image'
  grep -Fqx '      - ALL' "$candidate" || fail 'Compose candidate loses cap_drop ALL'
  grep -Fqx '      - no-new-privileges:true' "$candidate" || fail 'Compose candidate loses no-new-privileges'
  ! grep -Fq 'caddy' "$candidate" || fail 'pgAdmin Compose candidate must not attach Caddy to any network'
}

verify_task1_snapshot() {
  local snapshot snapshot_file
  local required_files=(outline-docker-compose.yml Caddyfile pgadmin-compose.yaml servers.json pgadmin4.db)
  require_file "$BACKUP_MARKER"
  require_root_owned_mode "$BACKUP_MARKER" 600
  snapshot="$(<"$BACKUP_MARKER")"
  [[ "$snapshot" == "$BACKUP_PARENT/20260828T104134Z" ]] || fail 'required Task 1 snapshot marker is not selected'
  [[ -d "$snapshot" ]] || fail 'required Task 1 snapshot directory is unavailable'
  require_root_owned_mode "$snapshot" 700
  for snapshot_file in "${required_files[@]}"; do
    require_file "$snapshot/$snapshot_file"
    require_root_owned_mode "$snapshot/$snapshot_file" 600
  done
  pass 'restricted Task 1 rollback snapshot is available'
}

inspect_port_bindings() {
  docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{$port}}{{range $bindings}} {{.HostIp}}:{{.HostPort}}{{end}}{{"\n"}}{{end}}' "$1" 2>/dev/null
}

verify_runtime_boundary() {
  local require_pgadmin_frontend="${1:-0}"
  local caddy_bindings pgadmin_bindings caddy_networks pgadmin_networks pgadmin_image
  require_quiet 'existing outline_frontend Docker network is available' docker network inspect "$FRONTEND_NETWORK"
  caddy_id="$(docker compose -f "$OUTLINE_COMPOSE" ps -q caddy 2>/dev/null)" || fail 'cannot determine Caddy container ID'
  pgadmin_id="$(docker compose -f "$PGADMIN_COMPOSE" ps -q pgadmin 2>/dev/null)" || fail 'cannot determine pgAdmin container ID'
  [[ -n "$caddy_id" && -n "$pgadmin_id" ]] || fail 'Caddy or pgAdmin is not running'
  caddy_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$caddy_id" 2>/dev/null)" || fail 'cannot inspect Caddy networks'
  [[ " $caddy_networks " == *" $FRONTEND_NETWORK "* ]] || fail 'Caddy is not attached to outline_frontend'
  [[ " $caddy_networks " != *' outline_backend '* ]] || fail 'Caddy must not be attached to outline_backend'
  pgadmin_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$pgadmin_id" 2>/dev/null)" || fail 'cannot inspect pgAdmin networks'
  [[ " $pgadmin_networks " == *' outline_backend '* ]] || fail 'pgAdmin is not attached to outline_backend'
  [[ " $pgadmin_networks " == *' pgadmin_pgadmin-access '* ]] || fail 'pgAdmin is not attached to pgadmin_pgadmin-access'
  if [[ "$require_pgadmin_frontend" == 1 ]]; then
    [[ " $pgadmin_networks " == *" $FRONTEND_NETWORK "* ]] || fail 'pgAdmin is not attached to outline_frontend'
  fi
  pgadmin_image="$(docker inspect --format '{{.Config.Image}}' "$pgadmin_id" 2>/dev/null)" || fail 'cannot inspect pgAdmin image'
  [[ "$pgadmin_image" == dpage/pgadmin4:9.17 ]] || fail 'pgAdmin image is not dpage/pgadmin4:9.17'
  caddy_bindings="$(inspect_port_bindings "$caddy_id")" || fail 'cannot inspect Caddy bindings'
  pgadmin_bindings="$(inspect_port_bindings "$pgadmin_id")" || fail 'cannot inspect pgAdmin bindings'
  require_absent_caddy_443_bindings "$caddy_bindings"
  require_absent_host_tcp_443
  require_absent_host_udp_443
  require_exact_loopback_binding "$pgadmin_bindings"
  pass 'HTTP-only upstream-TLS and private-port boundary verified'
}

verify_already_applied_runtime() {
  local caddy_ping routed_ping

  verify_runtime_boundary 1
  require_quiet 'active Caddy configuration validates' docker compose -f "$OUTLINE_COMPOSE" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  caddy_ping="$(docker compose -f "$OUTLINE_COMPOSE" exec -T caddy wget -qO- http://pgadmin:5050/misc/ping 2>/dev/null)" || fail 'Caddy cannot resolve pgAdmin on retry'
  require_exact_ping "$caddy_ping"
  routed_ping="$(curl -fsS -H 'Host: pg.astforum.ru' http://127.0.0.1/misc/ping 2>/dev/null)" || fail 'host-routed Caddy request to pgAdmin failed on retry'
  require_exact_ping "$routed_ping"
  verify_runtime_boundary 1
  pass 'already-applied pgAdmin route and private-port boundary revalidated'
}

validate_caddy_configurations() {
  require_quiet 'active Caddy configuration validates' docker compose -f "$OUTLINE_COMPOSE" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker cp "$ROOT_CADDY" "$caddy_id:/tmp/task3-Caddyfile.candidate" || fail 'cannot copy Caddy candidate into Caddy container'
  require_quiet 'candidate Caddy configuration validates' docker compose -f "$OUTLINE_COMPOSE" exec -T caddy caddy validate --config /tmp/task3-Caddyfile.candidate --adapter caddyfile
  require_quiet 'transient Caddy candidate removed from container' docker exec "$caddy_id" rm -f /tmp/task3-Caddyfile.candidate
}

verify_publication_prerequisites() {
  local active_caddy_sha active_compose_sha

  active_caddy_sha="$(sha256_of "$OUTLINE_CADDY")" || fail 'cannot hash active Caddyfile'
  active_compose_sha="$(sha256_of "$PGADMIN_COMPOSE")" || fail 'cannot hash active pgAdmin Compose'
  if [[ "$active_caddy_sha" == "$ACTIVE_CADDY_SHA" && "$active_compose_sha" == "$ACTIVE_COMPOSE_SHA" ]]; then
    verify_root_candidate_file "$ROOT_CADDY" "$ROOT_DEPLOY_DIR"
    verify_root_candidate_file "$ROOT_COMPOSE" "$ROOT_DEPLOY_DIR"
    require_exact_sha "$ROOT_CADDY" "$CANDIDATE_CADDY_SHA"
    require_exact_sha "$ROOT_COMPOSE" "$CANDIDATE_COMPOSE_SHA"
    verify_caddy_candidate_layout "$ROOT_CADDY"
    verify_compose_candidate_layout "$ROOT_COMPOSE"
  elif [[ "$active_caddy_sha" == "$CANDIDATE_CADDY_SHA" && "$active_compose_sha" == "$CANDIDATE_COMPOSE_SHA" ]]; then
    publication_already_applied=1
    verify_caddy_candidate_layout "$OUTLINE_CADDY"
    verify_compose_candidate_layout "$PGADMIN_COMPOSE"
  else
    fail 'active Caddyfile or pgAdmin Compose SHA does not match the reviewed pre-apply or applied state'
  fi
  verify_task1_snapshot
  require_quiet 'active Outline Compose configuration validates' docker compose -f "$OUTLINE_COMPOSE" config --quiet
  require_quiet 'active pgAdmin Compose configuration validates' docker compose -f "$PGADMIN_COMPOSE" config --quiet
  if [[ "$publication_already_applied" == 0 ]]; then
    require_quiet 'candidate pgAdmin Compose configuration validates' docker compose -f "$ROOT_COMPOSE" config --quiet
  fi
  verify_runtime_boundary
  if [[ "$publication_already_applied" == 0 ]]; then
    validate_caddy_configurations
  else
    verify_already_applied_runtime
  fi
  pass 'all active and candidate publication validations completed before mutation'
}

prepare_preapply_rollback() {
  preapply_dir="$(mktemp -d /opt/pgadmin/.task3-preapply.XXXXXX)" || fail 'cannot create pre-apply rollback directory'
  install -m 0600 "$OUTLINE_CADDY" "$preapply_dir/Caddyfile" || fail 'cannot preserve pre-apply Caddyfile'
  install -m 0600 "$PGADMIN_COMPOSE" "$preapply_dir/compose.yaml" || fail 'cannot preserve pre-apply pgAdmin Compose'
}

wait_for_pgadmin_ping() {
  local attempt body
  for attempt in $(seq 1 30); do
    body="$(curl -fsS http://127.0.0.1:5050/misc/ping 2>/dev/null || true)"
    [[ "$body" == PING ]] && return 0
    sleep 1
  done
  fail 'pgAdmin did not become healthy on its private loopback endpoint'
}

apply_validated_candidates() {
  local caddy_ping routed_ping pgadmin_networks pgadmin_bindings
  prepare_preapply_rollback
  mutation_started=1
  install -o root -g root -m 0644 "$ROOT_COMPOSE" "$PGADMIN_COMPOSE" || fail 'cannot install pgAdmin Compose candidate'
  docker compose -f "$PGADMIN_COMPOSE" up -d --no-deps --force-recreate pgadmin >/dev/null || fail 'cannot recreate only pgAdmin with the frontend attachment'
  wait_for_pgadmin_ping
  pgadmin_id="$(docker compose -f "$PGADMIN_COMPOSE" ps -q pgadmin 2>/dev/null)" || fail 'cannot determine recreated pgAdmin container ID'
  [[ -n "$pgadmin_id" ]] || fail 'recreated pgAdmin container is unavailable'
  pgadmin_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$pgadmin_id" 2>/dev/null)" || fail 'cannot inspect recreated pgAdmin networks'
  [[ " $pgadmin_networks " == *" $FRONTEND_NETWORK "* ]] || fail 'recreated pgAdmin did not join outline_frontend'
  pgadmin_bindings="$(inspect_port_bindings "$pgadmin_id")" || fail 'cannot inspect recreated pgAdmin bindings'
  require_exact_loopback_binding "$pgadmin_bindings"
  caddy_ping="$(docker compose -f "$OUTLINE_COMPOSE" exec -T caddy wget -qO- http://pgadmin:5050/misc/ping 2>/dev/null)" || fail 'Caddy cannot resolve pgAdmin after frontend attachment'
  require_exact_ping "$caddy_ping"
  pass 'Caddy resolves exact pgAdmin PING through outline_frontend'
  cp -- "$ROOT_CADDY" "$OUTLINE_CADDY" || fail 'cannot install Caddy candidate while preserving the bind-mounted file'
  chown root:root "$OUTLINE_CADDY"
  chmod 0644 "$OUTLINE_CADDY"
  docker compose -f "$OUTLINE_COMPOSE" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || fail 'Caddy reload failed'
  routed_ping="$(curl -fsS -H 'Host: pg.astforum.ru' http://127.0.0.1/misc/ping 2>/dev/null)" || fail 'host-routed Caddy request to pgAdmin failed'
  require_exact_ping "$routed_ping"
  verify_runtime_boundary 1
  pass 'HTTP-only Caddy route reaches pgAdmin with exact PING'
}

cleanup_transient_candidates() {
  [[ -n "$caddy_id" ]] && quietly docker exec "$caddy_id" rm -f /tmp/task3-Caddyfile.candidate || true
  [[ -n "$preapply_dir" ]] && rm -rf -- "$preapply_dir"
  preapply_dir=""
}

rollback_partial_apply() {
  local original_status="$1" rollback_failed=0
  if [[ "$mutation_started" == 1 && -n "$preapply_dir" ]]; then
    printf 'INFO: rolling back Task 3 from exact pre-apply copies; Task 1 snapshot is preserved\n' >&2
    cp -- "$preapply_dir/compose.yaml" "$PGADMIN_COMPOSE" || rollback_failed=1
    docker compose -f "$PGADMIN_COMPOSE" up -d --no-deps --force-recreate pgadmin >/dev/null 2>&1 || rollback_failed=1
    cp -- "$preapply_dir/Caddyfile" "$OUTLINE_CADDY" || rollback_failed=1
    chown root:root "$OUTLINE_CADDY" 2>/dev/null || rollback_failed=1
    chmod 0644 "$OUTLINE_CADDY" 2>/dev/null || rollback_failed=1
    docker compose -f "$OUTLINE_COMPOSE" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || rollback_failed=1
  fi
  cleanup_transient_candidates
  if [[ "$rollback_failed" == 1 ]]; then
    printf 'FAIL: partial-apply rollback was incomplete; preserve and use the Task 1 snapshot\n' >&2
    return 1
  fi
  return "$original_status"
}

run_publication() {
  verify_publication_prerequisites
  if [[ "$publication_already_applied" == 1 ]]; then
    pass 'Task 3 publication is already applied; no container is recreated'
    return 0
  fi
  apply_validated_candidates
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

[[ ${EUID} -eq 0 ]] || fail 'this script must run as root'
script_path="$(readlink -f "$0" 2>/dev/null)" || fail 'cannot resolve root script path'
[[ "$script_path" == "$ROOT_SCRIPT_PATH" ]] || fail 'refusing to execute outside the root-only staging path'
require_root_owned_mode "$ROOT_SCRIPT_PATH" 700
trap 'status=$?; rollback_partial_apply "$status"' EXIT
run_publication
mutation_started=0
cleanup_transient_candidates
pass 'Task 3 pgAdmin publication completed'
