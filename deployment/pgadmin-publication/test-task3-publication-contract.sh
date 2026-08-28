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
  local output_file="$temporary_root/$case_name.output"
  if [[ "$expected" == fail ]]; then
    if "$@" >"$output_file" 2>&1; then
      actual=pass
    fi
  elif "$@"; then
    actual=pass
  fi
  if [[ "$actual" != "$expected" ]]; then
    [[ -f "$output_file" ]] && cat "$output_file" >&2
    fail "$case_name: expected $expected, got $actual"
  fi
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

# Break caught: root verifies staged candidates but subsequently follows a
# testing-user-controlled path. The real provenance guard must accept only
# root-owned, root-directory candidate copies.
root_candidate="$temporary_root/root-candidate"
user_candidate="$temporary_root/user-candidate"
printf 'candidate fixture\n' > "$root_candidate"
printf 'candidate fixture\n' > "$user_candidate"
assert_status 'root-owned candidate is accepted' pass \
  bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    stat() { printf "400:0:0\n"; }
    verify_root_candidate_file "$2" "$3"
  ' _ "$root_script_path" "$root_candidate" "$temporary_root"
assert_status 'testing-user candidate is rejected' fail \
  bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    stat() { printf "400:1000:1000\n"; }
    verify_root_candidate_file "$2" "$3"
  ' _ "$root_script_path" "$user_candidate" "$temporary_root"

# Break caught: a standalone HTTPS site or local :443 listener would steal the
# upstream TLS boundary. Candidate structure and the runtime-binding guard both
# have to reject it.
https_caddy="$temporary_root/https-Caddyfile"
printf '%s\n' 'pg.astforum.ru {' '    reverse_proxy pgadmin:5050' '}' > "$https_caddy"
assert_root_function_status 'standalone HTTPS Caddy site is rejected' fail verify_caddy_candidate_layout "$https_caddy"
assert_root_function_status 'local TCP 443 binding is rejected' fail require_absent_caddy_443_bindings $'80/tcp 0.0.0.0:80\n443/tcp 127.0.0.1:443'
assert_root_function_status 'local UDP 443 binding is rejected' fail require_absent_caddy_443_bindings $'80/tcp 0.0.0.0:80\n443/udp 127.0.0.1:443'
assert_root_function_status 'host UDP 443 listener is rejected' fail require_absent_host_udp_443 $'UNCONN 0 0 127.0.0.1:443 0.0.0.0:*'

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

# Break caught: an already-applied retry that skips the running network or
# endpoint probes can claim success while the Caddy route is dead.
assert_status 'already-applied runtime checks require both exact PING probes' pass \
  bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    verify_runtime_boundary() { :; }
    require_quiet() { :; }
    docker() {
      [[ "$*" == *"wget -qO- http://pgadmin:5050/misc/ping"* ]] && { printf PING; return 0; }
      exit 98
    }
    curl() { printf PING; }
    verify_already_applied_runtime
  ' _ "$root_script_path"
assert_status 'already-applied runtime rejects stale Caddy ping' fail \
  bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    verify_runtime_boundary() { :; }
    require_quiet() { :; }
    docker() { [[ "$*" == *"wget -qO-"* ]] && { printf SUCCESS; return 0; }; exit 98; }
    curl() { printf PING; }
    verify_already_applied_runtime
  ' _ "$root_script_path"

assert_rollback_case() {
  local case_name="$1"
  local fail_reload="$2"
  local expected_status="$3"
  local rollback_root="$temporary_root/$case_name"
  local log_file="$rollback_root/operations"
  local marker="$rollback_root/task1-marker"
  local snapshot="$rollback_root/task1-snapshot"
  local preapply="$rollback_root/preapply"
  local restored_compose="$rollback_root/restored-compose"
  local restored_caddy="$rollback_root/restored-Caddyfile"
  local status_file="$rollback_root/status"
  local actual_status

  mkdir -p "$snapshot" "$preapply"
  printf 'Task 1 snapshot must survive\n' > "$snapshot/Caddyfile"
  printf '%s\n' "$snapshot" > "$marker"
  printf 'old compose\n' > "$preapply/compose.yaml"
  printf 'old Caddy\n' > "$preapply/Caddyfile"
  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    preapply_dir="$2"
    mutation_started=1
    caddy_id=caddy-id
    rollback_log="$6"
    fail_reload="$7"
    status_file="$8"
    restored_compose="$4"
    restored_caddy="$5"
    cp() {
      local source_path destination_path
      if [[ "$1" == -- ]]; then
        source_path="$2"
        destination_path="$3"
      else
        source_path="$1"
        destination_path="$2"
      fi
      printf "copy:%s:%s\n" "$source_path" "$destination_path" >> "$rollback_log"
      case "$source_path" in
        */compose.yaml) command cp "$source_path" "$restored_compose" ;;
        */Caddyfile) command cp "$source_path" "$restored_caddy" ;;
        *) return 98 ;;
      esac
    }
    chown() { printf "chown\n" >> "$rollback_log"; }
    chmod() { printf "chmod\n" >> "$rollback_log"; }
    docker() {
      if [[ "$*" == *"up -d --no-deps --force-recreate pgadmin"* ]]; then
        printf "pgadmin-recreate\n" >> "$rollback_log"
        return 0
      fi
      if [[ "$*" == *"caddy reload"* ]]; then
        printf "caddy-reload\n" >> "$rollback_log"
        [[ "$fail_reload" == 0 ]] && return 0
        return 1
      fi
      exit 98
    }
    cleanup_transient_candidates() { printf "cleanup\n" >> "$rollback_log"; }
    set +e
    rollback_partial_apply 23
    status=$?
    printf "%s\n" "$status" > "$status_file"
    exit 0
  ' _ "$root_script_path" "$preapply" "$marker" "$restored_compose" "$restored_caddy" "$log_file" "$fail_reload" "$status_file" >"$rollback_root/output" 2>&1; then
    actual_status=pass
  else
    actual_status=fail
  fi
  [[ "$actual_status" == "$expected_status" ]] || fail "$case_name: expected $expected_status, got $actual_status"
  if [[ "$fail_reload" == 0 ]]; then
    [[ "$(<"$status_file")" == 23 ]] || fail "$case_name: successful rollback did not preserve the original failure status"
  else
    [[ "$(<"$status_file")" == 1 ]] || fail "$case_name: incomplete rollback did not fail closed"
  fi
  cmp -s "$preapply/compose.yaml" "$restored_compose" || fail "$case_name: Compose was not restored"
  cmp -s "$preapply/Caddyfile" "$restored_caddy" || fail "$case_name: Caddyfile was not restored"
  [[ -s "$snapshot/Caddyfile" && -s "$marker" ]] || fail "$case_name: Task 1 snapshot was not preserved"
  awk '
    /copy:.*\/compose\.yaml:/ { compose = NR }
    /pgadmin-recreate/ { recreate = NR }
    /copy:.*\/Caddyfile:/ { caddy_copy = NR }
    /caddy-reload/ { reload = NR }
    /cleanup/ { cleanup = NR }
    END { exit(compose && recreate && caddy_copy && reload && cleanup &&
      compose < recreate && recreate < caddy_copy && caddy_copy < reload && reload < cleanup ? 0 : 1) }
  ' "$log_file" || fail "$case_name: rollback restoration order or transient cleanup is missing"
}

# Break caught: a partial apply can leave either candidate active unless the
# real rollback function restores Compose, recreates only pgAdmin, restores and
# reloads Caddy, preserves Task 1, cleans transients, and fails closed on error.
assert_rollback_case 'complete-rollback' 0 pass
assert_rollback_case 'incomplete-rollback' 1 pass

# Break caught: mutating production before active and candidate validation.
operation_log="$temporary_root/operation.log"
verify_publication_prerequisites() { printf 'validated\n' >> "$operation_log"; }
apply_validated_candidates() { printf 'applied\n' >> "$operation_log"; }
run_publication
[[ "$(tr '\n' ' ' < "$operation_log")" == 'validated applied ' ]] || \
  fail 'publication orchestration did not validate before apply'

# Break caught: a retry after a successful deployment must not recreate pgAdmin
# or Caddy merely because the reviewed candidate is already active.
: > "$operation_log"
publication_already_applied=0
verify_publication_prerequisites() { publication_already_applied=1; printf 'validated\n' >> "$operation_log"; }
apply_validated_candidates() { printf 'unexpected-apply\n' >> "$operation_log"; }
run_publication
[[ "$(tr '\n' ' ' < "$operation_log")" == 'validated ' ]] || \
  fail 'already-applied publication was not idempotent'

bash -n "$builder_path"
bash -n "$root_script_path"
printf 'task3 publication contract: PASS\n'
