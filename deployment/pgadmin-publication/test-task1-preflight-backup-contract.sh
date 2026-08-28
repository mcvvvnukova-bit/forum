#!/usr/bin/env bash
set -Eeuo pipefail

script_path="deployment/pgadmin-publication/task1-preflight-backup.sh"

require_script_text() {
  local expected="$1"
  grep -Fq -- "$expected" "$script_path" || {
    printf 'missing required script contract: %s\n' "$expected" >&2
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

assert_caddy_http_binding_case() {
  local case_name="$1"
  local bindings="$2"
  local expected_status="$3"
  local actual_status

  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    require_caddy_http_binding "$2"
  ' _ "$script_path" "$bindings"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'Caddy binding case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_shared_network_case() {
  local case_name="$1"
  local caddy_networks="$2"
  local pgadmin_networks="$3"
  local expected_status="$4"
  local actual_status

  if bash -c '
    source "$1"
    pass() { :; }
    info() { :; }
    fail() { exit 97; }
    record_shared_network "$2" "$3"
  ' _ "$script_path" "$caddy_networks" "$pgadmin_networks"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'shared network case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_caddy_tls_binding_case() {
  local case_name="$1"
  local bindings="$2"
  local expected_status="$3"
  local actual_status

  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    require_absent_caddy_tcp_443_binding "$2"
  ' _ "$script_path" "$bindings"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'Caddy TLS binding case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_absent_host_listener_case() {
  local case_name="$1"
  local sockets="$2"
  local expected_status="$3"
  local actual_status

  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    listening_sockets="$2"
    require_absent_listener 443 "Caddy TLS"
  ' _ "$script_path" "$sockets"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'host listener case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

assert_ping_case() {
  local case_name="$1"
  local body="$2"
  local expected_status="$3"
  local actual_status

  if bash -c '
    source "$1"
    pass() { :; }
    fail() { exit 97; }
    verify_pgadmin_ping "$2"
  ' _ "$script_path" "$body"; then
    actual_status=pass
  else
    actual_status=fail
  fi

  [[ "$actual_status" == "$expected_status" ]] || {
    printf 'pgAdmin ping case %s: expected %s, got %s\n' \
      "$case_name" "$expected_status" "$actual_status" >&2
    exit 1
  }
}

test -f "$script_path"

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
require_script_text 'record_shared_network'
require_script_text 'require_caddy_http_binding'
require_script_text 'require_absent_caddy_tcp_443_binding'
require_script_text "require_absent_listener 443 'Caddy TLS'"
require_script_text 'if [[ "${BASH_SOURCE[0]}" != "$0" ]]'
reject_text 'sudo bash /home/testing-user/' "$script_path"
reject_text '.State.Pid' "$script_path"
reject_text 'require_listener 443 '\''Caddy'\''' "$script_path"
reject_text 'require_caddy_public_bindings' "$script_path"
reject_text 'record_upstream_tls_topology' "$script_path"

assert_caddy_http_binding_case 'public HTTP-only Caddy binding' $'80/tcp 0.0.0.0:80' pass
assert_caddy_http_binding_case 'loopback-only HTTP Caddy binding' $'80/tcp 127.0.0.1:80' fail
assert_caddy_http_binding_case 'missing HTTP Caddy binding' $'443/tcp :::443' fail
assert_shared_network_case 'missing shared network is recorded' 'outline_frontend' 'outline_backend pgadmin_pgadmin-access' pass
assert_caddy_tls_binding_case 'HTTP-only Caddy has no TCP 443 binding' $'80/tcp 0.0.0.0:80' pass
assert_caddy_tls_binding_case 'loopback TCP 443 binding is rejected' $'80/tcp 0.0.0.0:80\n443/tcp 127.0.0.1:443' fail
assert_caddy_tls_binding_case 'public TCP 443 binding is rejected' $'80/tcp 0.0.0.0:80\n443/tcp 0.0.0.0:443' fail
assert_caddy_tls_binding_case 'loopback UDP 443 binding is rejected' $'80/tcp 0.0.0.0:80\n443/udp 127.0.0.1:443' fail
assert_caddy_tls_binding_case 'public UDP 443 binding is rejected' $'80/tcp 0.0.0.0:80\n443/udp 0.0.0.0:443' fail
assert_absent_host_listener_case 'no host TCP 443 listener' $'State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0 4096 0.0.0.0:80 0.0.0.0:*' pass
assert_absent_host_listener_case 'host TCP 443 listener is rejected' $'State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0 4096 127.0.0.1:443 0.0.0.0:*' fail
assert_ping_case 'pgAdmin 9.17 PING response' 'PING' pass
assert_ping_case 'stale SUCCESS response' 'SUCCESS' fail

bash -n "$script_path"
printf 'task1 round-5 contract: PASS\n'
