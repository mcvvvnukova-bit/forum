#!/usr/bin/env bash
set -euo pipefail

release=/opt/forum-api/releases/20260911T183500Z
backup=/opt/forum-api/backups/20260911T183500Z-dev
outline=/opt/outline
main_hash=afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a
caddy_hash=b89f75779cc07726376f2809a61d8ab8fb4f0ffc2a3348b8a445cf536d8e3e0f

test "$(sha256sum "$outline/astforum/index.html" | cut -d ' ' -f 1)" = "$main_hash"
test "$(sha256sum "$outline/Caddyfile" | cut -d ' ' -f 1)" = "$caddy_hash"
test ! -e "$backup"
test ! -e "$outline/dev-landing-api.override.yaml"

install -d -m 0700 "$backup"
cp -a "$outline/dev-astforum" "$backup/site"
cp -a "$outline/dev-landing-auth" "$backup/gateway"
cp -a "$outline/docker-compose.yml" "$outline/Caddyfile" "$backup/"
readlink /opt/forum-api/current > "$backup/previous-release"
docker ps --format '{{.Names}} {{.ID}}' > "$backup/containers-before"

install -m 0600 "$release/runtime.env" "$release/deployment/forum-api/.env"
ln -s /opt/forum-api/secrets "$release/deployment/forum-api/secrets"
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" config -q < /dev/null
docker compose --project-name outline --project-directory "$outline" \
  -f "$outline/docker-compose.yml" -f "$release/dev-landing-api.override.yaml" config -q < /dev/null

docker build --tag astforum/forum-api:20260911T183500Z "$release/apps/api" < /dev/null
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" \
  up -d --no-build --wait --wait-timeout 120 forum_api < /dev/null

# Keep bind-mounted root directories and old hashed assets in place.
cp -a "$release/deployment/dev-landing/dist/site/auth/auth-assets" "$outline/dev-astforum/auth/"
cp -a "$release/deployment/dev-landing/dist/site/landing/landing-assets" "$outline/dev-astforum/landing/"
cp -a "$release/deployment/dev-landing/dist/site/fonts" "$release/deployment/dev-landing/dist/site/landing-assets" "$outline/dev-astforum/"
for file in favicon.png forum-logo-square.svg forum-hard-hat.png robots.txt; do
  install -m 0644 "$release/deployment/dev-landing/dist/site/$file" "$outline/dev-astforum/$file"
done
for part in auth landing; do
  install -m 0644 "$release/deployment/dev-landing/dist/site/$part/index.html" "$outline/dev-astforum/$part/.index-next.html"
  mv "$outline/dev-astforum/$part/.index-next.html" "$outline/dev-astforum/$part/index.html"
done
install -m 0644 "$release/deployment/dev-landing/auth-gateway/forum_dev_auth.py" "$outline/dev-landing-auth/.forum_dev_auth.next.py"
mv "$outline/dev-landing-auth/.forum_dev_auth.next.py" "$outline/dev-landing-auth/forum_dev_auth.py"
install -m 0644 "$release/dev-landing-api.override.yaml" "$outline/dev-landing-api.override.yaml"
docker compose --project-name outline --project-directory "$outline" \
  -f "$outline/docker-compose.yml" -f "$outline/dev-landing-api.override.yaml" \
  up -d --no-deps dev_landing_auth < /dev/null

ln -s "$release" /opt/forum-api/.current-next
mv -Tf /opt/forum-api/.current-next /opt/forum-api/current
cmp "$outline/Caddyfile" "$backup/Caddyfile"
cmp "$outline/docker-compose.yml" "$backup/docker-compose.yml"
test "$(sha256sum "$outline/astforum/index.html" | cut -d ' ' -f 1)" = "$main_hash"
docker ps --format '{{.Names}} {{.ID}}' > "$backup/containers-after"
printf 'Dev deployment installed: %s\nBackup: %s\n' "$release" "$backup"
