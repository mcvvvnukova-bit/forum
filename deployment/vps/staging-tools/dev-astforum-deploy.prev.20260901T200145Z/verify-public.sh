#!/bin/sh
set -eu

public_host=${1:-dev.astforum.ru}
expected_ip=${EXPECTED_IP:-84.47.165.130}
base_url="https://$public_host"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

resolve_with_dig() {
  if command -v dig >/dev/null 2>&1; then
    dig +time=3 +tries=1 +short A "$@" 2>/dev/null \
      | awk '/^[0-9.]+$/ { last = $0 } END { if (last) print last }'
  fi
}

resolve_with_getent() {
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$1" 2>/dev/null \
      | awk '/^[0-9.]+/ { print $1; exit }'
  fi
}

resolved_ip=$(resolve_with_dig "$public_host" @1.1.1.1)
resolver_label="1.1.1.1"

if [ -z "$resolved_ip" ]; then
  resolved_ip=$(resolve_with_dig "$public_host")
  resolver_label="system DNS"
fi

if [ -z "$resolved_ip" ]; then
  resolved_ip=$(resolve_with_getent "$public_host")
  resolver_label="getent"
fi

test -n "$resolved_ip" || fail "$public_host could not be resolved"
test "$resolved_ip" = "$expected_ip" || fail "$public_host resolves to $resolved_ip, expected $expected_ip"
pass "$public_host resolves to $expected_ip via $resolver_label"

curl -fsSIL --max-time 20 "$base_url/" | grep -Eiq '^x-robots-tag: noindex, nofollow, noarchive' \
  || fail "$base_url/ does not include the expected X-Robots-Tag"
pass "$base_url/ includes noindex header"

curl -fsS --max-time 20 "$base_url/" | grep -F 'Площадка для лендинга готова' >/dev/null \
  || fail "$base_url/ does not return the dev landing placeholder"
pass "$base_url/ returns the dev landing placeholder"

curl -fsS --max-time 20 "$base_url/robots.txt" | grep -F 'Disallow: /' >/dev/null \
  || fail "$base_url/robots.txt does not disallow indexing"
pass "$base_url/robots.txt disallows indexing"

curl -fsS --max-time 20 "$base_url/_landing_health" | grep -Fx 'ok' >/dev/null \
  || fail "$base_url/_landing_health is not healthy"
pass "$base_url/_landing_health returns ok"

demo_status=$(
  curl -sS --max-time 20 --output /dev/null --write-out '%{http_code}' "$base_url/api/demo-request"
)
test "$demo_status" = "501" || fail "$base_url/api/demo-request returned $demo_status, expected 501"
pass "$base_url/api/demo-request is reserved with 501"
