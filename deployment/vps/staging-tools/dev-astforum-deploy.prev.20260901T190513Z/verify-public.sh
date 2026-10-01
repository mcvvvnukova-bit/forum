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

resolved_ip=$(dig +short A "$public_host" @1.1.1.1 | tail -n 1)
test "$resolved_ip" = "$expected_ip" || fail "$public_host resolves to $resolved_ip, expected $expected_ip"
pass "$public_host resolves to $expected_ip"

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
