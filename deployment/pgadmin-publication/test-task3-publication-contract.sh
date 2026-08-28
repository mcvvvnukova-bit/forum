#!/usr/bin/env bash
# Behavioral contract for Task 3 pgAdmin publication artifacts.
# Each assertion names a production break it must catch; fixtures are hand-derived
# from the recorded active files and do not contact production.
set -Eeuo pipefail

builder_path="deployment/pgadmin-publication/task3-build-candidates.sh"
root_script_path="deployment/pgadmin-publication/task3-publish.sh"
active_caddy=".superpowers/sdd/2026-08-28-pgadmin-publication/task3-active-Caddyfile"
active_compose=".superpowers/sdd/2026-08-28-pgadmin-publication/task3-active-pgadmin-compose.yaml"
expected_caddy="deployment/pgadmin-publication/task3-Caddyfile.candidate"
expected_compose="deployment/pgadmin-publication/task3-pgadmin-compose.candidate.yaml"

fail() {
  printf 'task3 contract failure: %s\n' "$1" >&2
  exit 1
}

assert_status() {
  local case_name="$1"
  local expected="$2"
  shift 2
  local actual=fail
  if "$@"; then
    actual=pass
  fi
  [[ "$actual" == "$expected" ]] || fail "$case_name: expected $expected, got $actual"
}

assert_root_function_status() {
  local case_name="$1"
  local expected="$2"
  local function_name="$3"
  shift 3
  local actual=fail
  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    "$2" "${@:3}"
  ' _ "$root_script_path" "$function_name" "$@"; then
    actual=pass
  fi
  [[ "$actual" == "$expected" ]] || fail "$case_name: expected $expected, got $actual"
}

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "$temporary_root"' EXIT
fixture_caddy="$temporary_root/Caddyfile"
fixture_compose="$temporary_root/compose.yaml"
candidate_dir="$temporary_root/candidates"
cp "$active_caddy" "$fixture_caddy"
cp "$active_compose" "$fixture_compose"

test -f "$builder_path" || fail 'candidate builder is missing'
test -f "$root_script_path" || fail 'root publication script is missing'
test -f "$expected_caddy" || fail 'committed Caddy candidate is missing'
test -f "$expected_compose" || fail 'committed Compose candidate is missing'

# Break caught: duplicate or wrong host routing could shadow the final 404 or
# create a second pgAdmin handler. The real builder must produce the exact
# hand-reviewed candidates from exact active fixtures.
TASK3_ACTIVE_CADDY_SHA="$(sha256sum "$fixture_caddy" | awk '{print $1}')" \
TASK3_ACTIVE_COMPOSE_SHA="$(sha256sum "$fixture_compose" | awk '{print $1}')" \
bash "$builder_path" --active-caddy "$fixture_caddy" --active-compose "$fixture_compose" --output-dir "$candidate_dir"
cmp -s "$expected_caddy" "$candidate_dir/Caddyfile" || fail 'builder did not produce the reviewed Caddy candidate'
cmp -s "$expected_compose" "$candidate_dir/compose.yaml" || fail 'builder did not produce the reviewed Compose candidate'

duplicate_caddy="$temporary_root/duplicate-Caddyfile"
sed '/    respond 404/i\
    @duplicate host pg.astforum.ru
' "$fixture_caddy" > "$duplicate_caddy"
assert_status 'duplicate pgAdmin host fixture is rejected' fail \
  env TASK3_ACTIVE_CADDY_SHA="$(sha256sum "$duplicate_caddy" | awk '{print $1}')" \
  TASK3_ACTIVE_COMPOSE_SHA="$(sha256sum "$fixture_compose" | awk '{print $1}')" \
  bash "$builder_path" --active-caddy "$duplicate_caddy" --active-compose "$fixture_compose" --output-dir "$temporary_root/duplicate-output"

source "$root_script_path"

# Break caught: a standalone HTTPS site or local :443 listener would steal the
# upstream TLS boundary. Candidate structure and the runtime-binding guard both
# have to reject it.
https_caddy="$temporary_root/https-Caddyfile"
printf '%s\n' 'pg.astforum.ru {' '    reverse_proxy pgadmin:5050' '}' > "$https_caddy"
assert_root_function_status 'standalone HTTPS Caddy site is rejected' fail verify_caddy_candidate_layout "$https_caddy"
assert_root_function_status 'local TCP 443 binding is rejected' fail require_absent_caddy_443_bindings $'80/tcp 0.0.0.0:80\n443/tcp 127.0.0.1:443'
assert_root_function_status 'local UDP 443 binding is rejected' fail require_absent_caddy_443_bindings $'80/tcp 0.0.0.0:80\n443/udp 127.0.0.1:443'

# Break caught: Caddy must never be attached to the database network; only
# pgAdmin joins outline_frontend while retaining its private networks and hardening.
backend_compose="$temporary_root/backend-compose.yaml"
sed 's/      - outline-frontend/      - outline-backend/' "$expected_compose" > "$backend_compose"
assert_root_function_status 'Compose candidate without pgAdmin frontend attachment is rejected' fail verify_compose_candidate_layout "$backend_compose"
public_port_compose="$temporary_root/public-port-compose.yaml"
sed 's/127.0.0.1:5050:5050/0.0.0.0:5050:5050/' "$expected_compose" > "$public_port_compose"
assert_root_function_status 'Compose candidate with public pgAdmin port is rejected' fail verify_compose_candidate_layout "$public_port_compose"
weakened_compose="$temporary_root/weakened-compose.yaml"
sed 's/      - ALL/      - NET_ADMIN/' "$expected_compose" > "$weakened_compose"
assert_root_function_status 'Compose candidate that loses cap_drop ALL is rejected' fail verify_compose_candidate_layout "$weakened_compose"

# Break caught: the stale SUCCESS response must never pass the health gate.
assert_root_function_status 'pgAdmin 9.17 PING is accepted' pass require_exact_ping PING
assert_root_function_status 'stale SUCCESS is rejected' fail require_exact_ping SUCCESS

# Break caught: mutating production before active and candidate validation.
operation_log="$temporary_root/operation.log"
verify_publication_prerequisites() { printf 'validated\n' >> "$operation_log"; }
apply_validated_candidates() { printf 'applied\n' >> "$operation_log"; }
run_publication
[[ "$(tr '\n' ' ' < "$operation_log")" == 'validated applied ' ]] || \
  fail 'publication orchestration did not validate before apply'

bash -n "$builder_path"
bash -n "$root_script_path"
printf 'task3 publication contract: PASS\n'
