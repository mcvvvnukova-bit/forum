#!/usr/bin/env bash
set -Eeuo pipefail

script_path="deployment/pgadmin-publication/task2-provision.sh"

assert_status() {
  local case_name="$1"
  local expected_status="$2"
  shift 2
  local actual_status

  if "$@"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_user_json_case() {
  local case_name="$1"
  local json="$2"
  local expected_status="$3"
  local actual_status

  if printf '%s\n' "$json" | user_json_has_active_administrator ceo@astforum.ru; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'user JSON case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_server_json_case() {
  local case_name="$1"
  local json="$2"
  local expected_status="$3"
  local actual_status

  if printf '%s\n' "$json" | server_json_has_canonical_registration; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'server JSON case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_snapshot_guard_case() {
  local case_name="$1"
  local omitted_artifact="$2"
  local expected_status="$3"
  local temporary_root marker snapshot artifact actual_status
  local artifacts=(
    outline-docker-compose.yml
    Caddyfile
    pgadmin-compose.yaml
    servers.json
    pgadmin4.db
  )

  temporary_root="$(mktemp -d)"
  marker="$temporary_root/last-backup"
  snapshot="$temporary_root/snapshot"
  mkdir "$snapshot"
  printf '%s\n' "$snapshot" > "$marker"
  for artifact in "${artifacts[@]}"; do
    [[ "$artifact" == "$omitted_artifact" ]] && continue
    printf 'snapshot fixture\n' > "$snapshot/$artifact"
  done

  if (
    pass() { :; }
    fail() { exit 97; }
    stat() {
      case "$2:$3" in
        '%a:'"$snapshot") printf '700\n' ;;
        '%a:'*) printf '600\n' ;;
        '%u:'*) printf '0\n' ;;
        *) exit 98 ;;
      esac
    }
    verify_task1_snapshot "$marker" "$temporary_root"
  ); then
    actual_status=pass
  else
    actual_status=fail
  fi
  rm -rf -- "$temporary_root"

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'snapshot guard case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

test -f "$script_path"

source "$script_path"

assert_status 'distinct password values are accepted' pass \
  assert_distinct_password_values 'ceo-example' 'admin-example'
assert_status 'equal password values are rejected' fail \
  assert_distinct_password_values 'same-example' 'same-example'
assert_user_json_case 'active Administrator JSON is accepted' \
  '[{"email":"ceo@astforum.ru","active":true,"role":"Administrator"}]' pass
assert_user_json_case 'inactive Administrator JSON is rejected' \
  '[{"email":"ceo@astforum.ru","active":false,"role":"Administrator"}]' fail
assert_server_json_case 'canonical server registration is accepted' \
  '{"Servers":{"1":{"Name":"AST Forum / Outline PostgreSQL","Host":"postgres","Username":"outline"}}}' pass
assert_server_json_case 'non-canonical server registration is rejected' \
  '{"Servers":{"1":{"Name":"Wrong","Host":"postgres","Username":"outline"}}}' fail
assert_snapshot_guard_case 'complete Task 1 snapshot is accepted' '' pass
assert_snapshot_guard_case 'marker and directory alone are rejected' outline-docker-compose.yml fail
assert_snapshot_guard_case 'missing Caddyfile is rejected' Caddyfile fail
assert_snapshot_guard_case 'missing pgAdmin Compose snapshot is rejected' pgadmin-compose.yaml fail
assert_snapshot_guard_case 'missing server-definition snapshot is rejected' servers.json fail
assert_snapshot_guard_case 'missing pgAdmin database snapshot is rejected' pgadmin4.db fail

bash -n "$script_path"
printf 'task2 provision contract: PASS\n'
