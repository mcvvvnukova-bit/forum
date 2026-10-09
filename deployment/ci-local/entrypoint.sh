#!/usr/bin/env bash
set -euo pipefail
# Registration input is a short-lived token on stdin. Never enable shell tracing.
if [[ "${1:-runner}" == daemon ]]; then
  mkdir -p /docker /ci
  chmod 1777 /ci
  exec dockerd --host=unix:///docker/docker.sock --group=docker --data-root=/var/lib/docker --feature=containerd-snapshotter=true
fi
export HOME=/home/runner
if [[ ! -f "$HOME/run.sh" ]]; then
  cp -a /opt/runner-template/. "$HOME/"
fi
mkdir -p "/ci/$RUNNER_SLOT" "$TMPDIR" "$RUNNER_TOOL_CACHE" "$PLAYWRIGHT_BROWSERS_PATH" "$npm_config_cache"
chown -R runner:runner "$HOME" "/ci/$RUNNER_SLOT" /cache
cd "$HOME"
if [[ "${1:-runner}" == register ]]; then
  IFS= read -r registration_token
  [[ -n "$registration_token" ]] || exit 1
  # Token is an argument only inside Linux; host/container environment stays clean.
  exec runuser -u runner -- ./config.sh --unattended \
    --url https://github.com/mcvvvnukova-bit/forum --token "$registration_token" \
    --name "$RUNNER_NAME" --labels astforum-local-ci --work "/ci/$RUNNER_SLOT"
fi
until [[ -f .runner ]] && docker info >/dev/null 2>&1; do sleep 2; done
exec runuser -u runner -- ./run.sh
