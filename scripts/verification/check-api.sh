#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

image="${FORUM_TEST_POSTGRES_IMAGE:-postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2}"
container="forum-quality-${RANDOM}-${RANDOM}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --platform linux/amd64 --name "$container" \
  -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=quality-tests-only "$image" >/dev/null
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  # Init uses a socket-only temporary server. TCP readiness proves the final
  # postmaster rather than racing database creation against init shutdown.
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then echo 'Disposable PostgreSQL final postmaster did not become ready' >&2; exit 1; fi
version=$(docker exec -e PGPASSWORD=quality-tests-only "$container" psql -h 127.0.0.1 -U postgres -Atqc 'SHOW server_version;')
if [ "$version" != 18.6 ]; then echo "Expected PostgreSQL 18.6, got $version" >&2; exit 1; fi
port=$(docker port "$container" 5432/tcp)
port=${port##*:}
docker exec -e PGPASSWORD=quality-tests-only "$container" createdb -h 127.0.0.1 -U postgres forum_quality_auth_test
docker exec -e PGPASSWORD=quality-tests-only "$container" createdb -h 127.0.0.1 -U postgres forum_quality_browser_test
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
TEST_DATABASE_CONTAINER="$container" TEST_DATABASE_URL="postgres://postgres:quality-tests-only@127.0.0.1:$port/forum_quality_auth_test" npm test --prefix apps/api
node --test apps/api/diagnostics/issuer-probe.test.mjs
node scripts/verification/forum-api/test-callback-relay.mjs
TEST_DATABASE_URL="postgres://postgres:quality-tests-only@127.0.0.1:$port/forum_quality_browser_test" npm run test:browser --prefix apps/api
