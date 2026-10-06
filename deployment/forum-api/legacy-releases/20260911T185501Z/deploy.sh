#!/usr/bin/env bash
set -euo pipefail
release=/opt/forum-api/releases/20260911T185501Z
backup=/opt/forum-api/backups/20260911T185501Z-relay
previous=/opt/forum-api/releases/20260911T183500Z
test "$(readlink /opt/forum-api/current)" = "$previous"
test "$(sha256sum /opt/outline/Caddyfile | cut -d ' ' -f 1)" = b89f75779cc07726376f2809a61d8ab8fb4f0ffc2a3348b8a445cf536d8e3e0f
test "$(sha256sum /opt/outline/astforum/index.html | cut -d ' ' -f 1)" = afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a
test ! -e "$backup"
install -d -m 0700 "$backup"
cp -a /opt/outline/Caddyfile "$backup/Caddyfile"
cp -a "$previous/deployment/forum-api/.env" "$backup/previous.env"
readlink /opt/forum-api/current > "$backup/previous-release"
docker ps --format '{{.Names}} {{.ID}}' > "$backup/containers-before"
inode=$(stat -c %i /opt/outline/Caddyfile)
caddy_started=$(docker inspect outline-caddy-1 --format '{{.State.StartedAt}}' < /dev/null)

install -m 0600 "$release/runtime.env" "$release/deployment/forum-api/.env"
ln -s /opt/forum-api/secrets "$release/deployment/forum-api/secrets"
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" config -q < /dev/null
docker cp "$release/Caddyfile.candidate" outline-caddy-1:/tmp/Caddyfile.sber-relay-20260911T185501Z < /dev/null
docker exec outline-caddy-1 caddy validate --config /tmp/Caddyfile.sber-relay-20260911T185501Z --adapter caddyfile < /dev/null
docker build --tag astforum/forum-api:20260911T185501Z "$release/apps/api" < /dev/null
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" \
  up -d --no-build --wait --wait-timeout 120 forum_api < /dev/null

# Preserve the inode of the bind-mounted configuration and hot-reload Caddy.
cp "$release/Caddyfile.candidate" /opt/outline/Caddyfile
if ! docker exec outline-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile < /dev/null; then
  cp "$backup/Caddyfile" /opt/outline/Caddyfile
  docker exec outline-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile < /dev/null
  exit 1
fi
test "$(stat -c %i /opt/outline/Caddyfile)" = "$inode"
test "$(docker inspect outline-caddy-1 --format '{{.State.StartedAt}}' < /dev/null)" = "$caddy_started"
test "$(sha256sum /opt/outline/astforum/index.html | cut -d ' ' -f 1)" = afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a
ln -s "$release" /opt/forum-api/.current-next
mv -Tf /opt/forum-api/.current-next /opt/forum-api/current
docker ps --format '{{.Names}} {{.ID}}' > "$backup/containers-after"
printf 'Callback relay deployed: %s\nBackup: %s\n' "$release" "$backup"
