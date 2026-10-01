#!/bin/bash
set -euo pipefail
umask 077
cd /opt/openproject
exec 9>/run/lock/astforum-openproject-backup.lock
flock -n 9 || { echo 'OpenProject backup is already running.' >&2; exit 1; }

snapshot="/var/backups/openproject/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$snapshot"
restart_application() {
  mapfile -t application_ids < <(docker compose ps --all --quiet web worker collaboration)
  docker start "${application_ids[@]}" >/dev/null
}
trap restart_application EXIT
docker compose stop web worker collaboration
docker compose exec -T db pg_dump -U openproject -d openproject -Fc > "$snapshot/database.dump"
assets_path=$(docker volume inspect astforum-openproject_assets --format '{{.Mountpoint}}')
tar -C "$assets_path" -czf "$snapshot/assets.tar.gz" .
cp -a compose.yaml .env Caddy.route admin-access.private.txt "$snapshot/"
cp -a /opt/outline/Caddyfile "$snapshot/Caddyfile"
docker compose images --format json > "$snapshot/images.json"
docker compose exec -T db pg_restore --list < "$snapshot/database.dump" > "$snapshot/database.contents.txt"
tar -tzf "$snapshot/assets.tar.gz" > "$snapshot/assets.contents.txt"
(cd "$snapshot" && sha256sum database.dump assets.tar.gz compose.yaml .env > SHA256SUMS)
echo "Backup created and archive contents verified: $snapshot"
