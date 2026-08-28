#!/usr/bin/env bash
# Builds the Task 3 candidates from exact active Caddy and pgAdmin Compose inputs.
set -Eeuo pipefail
set +x
umask 077

readonly REVIEWED_CADDY="deployment/pgadmin-publication/task3-Caddyfile.candidate"
readonly REVIEWED_COMPOSE="deployment/pgadmin-publication/task3-pgadmin-compose.candidate.yaml"

active_caddy=""
active_compose=""
output_dir=""

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_sha() {
  local path="$1"
  local expected="$2"
  local actual

  actual="$(sha256sum "$path" | awk '{print $1}')" || fail "cannot hash $path"
  [[ "$actual" == "$expected" ]] || fail "unexpected active source SHA-256: $path"
}

require_one() {
  local pattern="$1"
  local path="$2"
  local count

  count="$(grep -Fxc -- "$pattern" "$path" || true)"
  [[ "$count" == 1 ]] || fail "expected exactly one $pattern in $path"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --active-caddy) active_caddy="${2:-}"; shift 2 ;;
    --active-compose) active_compose="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$active_caddy" && -n "$active_compose" && -n "$output_dir" ]] || \
  fail 'usage: task3-build-candidates.sh --active-caddy FILE --active-compose FILE --output-dir DIRECTORY'
[[ -f "$active_caddy" && -f "$active_compose" ]] || fail 'active candidate source is unavailable'
[[ ! -e "$output_dir" ]] || fail 'candidate output directory already exists'

require_sha "$active_caddy" "${TASK3_ACTIVE_CADDY_SHA:-58d2d055109b06165467cded49860be63b166593b3fc76d61461ec868ca7db7e}"
require_sha "$active_compose" "${TASK3_ACTIVE_COMPOSE_SHA:-fad20a2f71534bba65f85bf249a1dd300bb20947361f4b76a4af8c08f98ab92f}"
! grep -Fq 'pg.astforum.ru' "$active_caddy" || fail 'active Caddyfile already routes pg.astforum.ru'
! grep -Eq '(^|[^[:alnum:]_.-])(:443|https://)' "$active_caddy" || fail 'active Caddyfile is not HTTP-only'
require_one '    respond 404' "$active_caddy"
require_one '      - pgadmin-access' "$active_compose"
! grep -Fq 'outline-frontend' "$active_compose" || fail 'active pgAdmin Compose already defines the frontend attachment'

mkdir -m 0700 "$output_dir"
install -m 0400 "$REVIEWED_CADDY" "$output_dir/Caddyfile"
install -m 0400 "$REVIEWED_COMPOSE" "$output_dir/compose.yaml"
printf 'PASS: reviewed Task 3 candidates built from exact active sources\n'
