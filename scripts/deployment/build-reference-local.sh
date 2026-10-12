#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
build_dir=$(mktemp -d /tmp/forum-reference-build.XXXXXX)
trap 'rmdir "$build_dir"' EXIT
cd "$build_dir"
# Stream a bounded context from an ASCII path: BuildKit session headers reject
# non-ASCII directory names. This also excludes local secrets and node_modules.
tar -C "$repo_root" -cf - package.json package-lock.json \
  apps/api/package.json apps/api/tsconfig.json apps/api/src apps/api/migrations apps/api/Dockerfile \
  apps/dev-gateway/package.json apps/web/package.json apps/profile-preview/package.json |
  docker build -t forum-okved-reference-local -f apps/api/Dockerfile -
