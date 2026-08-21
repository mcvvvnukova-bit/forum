#!/bin/sh
set -eu

app_dir=/opt/outline
source_dir=/home/testing-user/astforum-deploy-staging
compose_file="$app_dir/docker-compose.yml"
caddy_file="$app_dir/Caddyfile"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$app_dir/backups/astforum-$timestamp"

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Run this script with sudo." >&2
  exit 1
fi

test -f "$compose_file"
test -f "$caddy_file"
test -f "$source_dir/site/index.html"
test -f "$source_dir/site/forum-hard-hat.png"

install -d -m 0750 "$backup_dir"
cp -a "$compose_file" "$backup_dir/docker-compose.yml"
cp -a "$caddy_file" "$backup_dir/Caddyfile"

if [ -d "$app_dir/astforum" ]; then
  cp -a "$app_dir/astforum" "$backup_dir/astforum"
else
  : > "$backup_dir/no-existing-astforum"
fi

rollback() {
  printf '%s\n' "Deployment failed; restoring $backup_dir" >&2
  cp -a "$backup_dir/docker-compose.yml" "$compose_file"
  cp -a "$backup_dir/Caddyfile" "$caddy_file"
  rm -rf "$app_dir/astforum"
  if [ -d "$backup_dir/astforum" ]; then
    cp -a "$backup_dir/astforum" "$app_dir/astforum"
  fi
  cd "$app_dir"
  docker compose up -d --no-deps --force-recreate caddy || true
}

deployment_complete=0
cleanup() {
  if [ "$deployment_complete" -ne 1 ]; then
    rollback
  fi
}
trap cleanup EXIT HUP INT TERM

install -d -m 0755 "$app_dir/astforum"
cp -a "$source_dir/site/." "$app_dir/astforum/"
find "$app_dir/astforum" -type d -exec chmod 0755 {} \;
find "$app_dir/astforum" -type f -exec chmod 0644 {} \;

python3 - "$caddy_file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

if "root * /srv/astforum" not in text:
    needle = "    respond 404"
    if needle not in text:
        raise SystemExit("Caddyfile anchor not found")

    site_block = """    @astforum host astforum.ru
    handle @astforum {
        root * /srv/astforum
        encode zstd gzip

        header {
            Content-Security-Policy \"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'\"
            Referrer-Policy \"strict-origin-when-cross-origin\"
            X-Content-Type-Options \"nosniff\"
            X-Frame-Options \"DENY\"
        }

        file_server
    }

"""
    text = text.replace(needle, site_block + needle, 1)
    path.write_text(text)
PY

python3 - "$compose_file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
mount = "      - ./astforum:/srv/astforum:ro"

if mount not in text:
    needle = "      - ./Caddyfile:/etc/caddy/Caddyfile:ro"
    if needle not in text:
        raise SystemExit("Compose Caddy mount anchor not found")
    text = text.replace(needle, needle + "\n" + mount, 1)
    path.write_text(text)
PY

cd "$app_dir"
docker compose config -q
docker compose run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --no-deps --force-recreate caddy

readiness_attempt=1
readiness_limit=30
while ! curl --fail --silent --output /dev/null \
  http://127.0.0.1/_origin_health 2>/dev/null; do
  if [ "$readiness_attempt" -ge "$readiness_limit" ]; then
    printf '%s\n' \
      "Caddy did not become ready after $readiness_limit attempts." >&2
    exit 1
  fi

  readiness_attempt=$((readiness_attempt + 1))
  sleep 1
done

curl --fail --silent --show-error \
  -H 'Host: astforum.ru' http://127.0.0.1/ \
  | grep -F 'Сайт находится в разработке' >/dev/null
curl --fail --silent --show-error \
  -H 'Host: astforum.ru' http://127.0.0.1/forum-hard-hat.png \
  >/dev/null

deployment_complete=1
trap - EXIT HUP INT TERM
printf '%s\n' "AST Forum placeholder deployed successfully."
printf '%s\n' "Backup: $backup_dir"
