#!/usr/bin/env bash
set -Eeuo pipefail

script_path="deployment/pgadmin-publication/task1-preflight-backup.sh"
report_path=".superpowers/sdd/2026-08-28-pgadmin-publication/task-1-report.md"

require_script_text() {
  local expected="$1"
  grep -Fq -- "$expected" "$script_path" || {
    printf 'missing required script contract: %s\n' "$expected" >&2
    exit 1
  }
}

require_report_text() {
  local expected="$1"
  grep -Fq -- "$expected" "$report_path" || {
    printf 'missing required report contract: %s\n' "$expected" >&2
    exit 1
  }
}

reject_text() {
  local unexpected="$1"
  shift
  if grep -Fq -- "$unexpected" "$@"; then
    printf 'forbidden contract text found: %s\n' "$unexpected" >&2
    exit 1
  fi
}

test -f "$script_path"
test -f "$report_path"

require_script_text 'readonly ROOT_SCRIPT_PATH=/root/pgadmin-publication/task1-preflight-backup.sh'
require_script_text '[[ "$script_path" == "$ROOT_SCRIPT_PATH" ]]'
require_script_text 'ps -q pgadmin'
require_script_text 'ps -q caddy'
require_script_text 'ps -q postgres'
require_script_text 'ps -q redis'
require_script_text 'docker inspect --format'
require_script_text 'require_exact_loopback_binding "$pgadmin_bindings" 5050/tcp 127.0.0.1:5050'
require_script_text 'reject_public_bindings'
require_script_text 'reject_public_listener'
require_script_text 'Caddy Compose container exposes public TCP ports 80 and 443'
require_report_text 'sudo env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin bash --noprofile --norc -c'
require_report_text 'expected_sha256='
require_report_text 'root_dir=/root/pgadmin-publication'
require_report_text 'install -m 0700 "$source_path" "$root_path"'
require_report_text 'reviewed root copy SHA-256 verified'
require_report_text 'exec "$root_path"'
reject_text 'sudo bash /home/testing-user/' "$script_path" "$report_path"
reject_text '.State.Pid' "$script_path"
reject_text 'expected_sha256=REVIEWED_COMMITTED_SHA256' "$report_path"

bash -n "$script_path"
printf 'task1 round-1 contract: PASS\n'
