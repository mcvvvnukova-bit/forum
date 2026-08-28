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

bash -n "$script_path"
printf 'task2 provision contract: PASS\n'
