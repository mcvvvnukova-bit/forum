#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
artifact=$(cd "${1:?Pass exact built artifact directory}" && pwd)
proof=$(mktemp -d)
trap 'rm -rf "$proof"' EXIT
# Both mounts refer to the same stable parent, matching observed VPS boundaries.
docker run --rm --network none --read-only --tmpfs /tmp \
  -v "$repo:/repo:ro" -v "$artifact:/artifact:ro" \
  -v "$proof:/proof:rw" -v "$proof:/srv/static:ro" \
  python@sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a python /repo/tests/integration/test_web_release.py
