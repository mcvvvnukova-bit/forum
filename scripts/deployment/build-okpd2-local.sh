#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# A bounded stdin context avoids BuildKit's non-ASCII checkout path failure.
tar -cf - package.json package-lock.json apps/api/package.json apps/web/package.json apps/dev-gateway/package.json apps/profile-preview/package.json apps/api/tsconfig.json apps/api/Dockerfile apps/api/src apps/api/migrations apps/api/resources |
 docker build -f apps/api/Dockerfile -t forum-okpd2-local:latest -
