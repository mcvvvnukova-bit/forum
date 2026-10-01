#!/bin/sh
set -eu

app_dir=/opt/outline
site_dir_name=dev-astforum
public_host=dev.astforum.ru
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
source_dir="$script_dir/site"
compose_file="$app_dir/docker-compose.yml"
caddy_file="$app_dir/Caddyfile"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$app_dir/backups/dev-astforum-$timestamp"
target_dir="$app_dir/$site_dir_name"
tmp_target="$app_dir/$site_dir_name.tmp"
deployment_complete=0

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Run this script with sudo." >&2
  exit 1
fi

test -f "$compose_file"
test -f "$caddy_file"
test -f "$source_dir/index.html"
test -f "$source_dir/robots.txt"

install -d -m 0750 "$backup_dir"
cp -a "$compose_file" "$backup_dir/docker-compose.yml"
cp -a "$caddy_file" "$backup_dir/Caddyfile"

if [ -d "$target_dir" ]; then
  cp -a "$target_dir" "$backup_dir/$site_dir_name"
else
  : > "$backup_dir/no-existing-$site_dir_name"
fi

rollback() {
  printf '%s\n' "Deployment failed; restoring $backup_dir" >&2
  cp -a "$backup_dir/docker-compose.yml" "$compose_file"
  cp -a "$backup_dir/Caddyfile" "$caddy_file"
  rm -rf "$target_dir" "$tmp_target"
  if [ -d "$backup_dir/$site_dir_name" ]; then
    cp -a "$backup_dir/$site_dir_name" "$target_dir"
  fi
  cd "$app_dir"
  docker compose up -d --no-deps --force-recreate caddy || true
}

cleanup() {
  if [ "$deployment_complete" -ne 1 ]; then
    rollback
  fi
}
trap cleanup EXIT HUP INT TERM

rm -rf "$tmp_target"
install -d -m 0755 "$tmp_target"
cp -a "$source_dir/." "$tmp_target/"
find "$tmp_target" -type d -exec chmod 0755 {} \;
find "$tmp_target" -type f -exec chmod 0644 {} \;
rm -rf "$target_dir"
mv "$tmp_target" "$target_dir"

python3 - "$caddy_file" "$public_host" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
public_host = sys.argv[2]
text = path.read_text()

start = "    # astforum-dev-landing:start\n"
end = "    # astforum-dev-landing:end\n"
block = f"""{start}    @dev_landing_health {{
        host {public_host}
        path /_landing_health
    }}
    handle @dev_landing_health {{
        respond "ok" 200
    }}

    @dev_demo_api {{
        host {public_host}
        path /api/demo-request
    }}
    handle @dev_demo_api {{
        header Content-Type "text/plain; charset=utf-8"
        respond "Demo request endpoint is reserved for the Bitrix24 integration service." 501
    }}

    @dev_astforum host {public_host}
    handle @dev_astforum {{
        root * /srv/dev-astforum
        encode zstd gzip

        header {{
            Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; form-action 'self'; upgrade-insecure-requests"
            Permissions-Policy "camera=(), microphone=(), geolocation=()"
            Referrer-Policy "strict-origin-when-cross-origin"
            Strict-Transport-Security "max-age=31536000"
            X-Content-Type-Options "nosniff"
            X-Frame-Options "DENY"
            X-Robots-Tag "noindex, nofollow, noarchive"
        }}

        try_files {{path}} /index.html
        file_server
    }}
{end}
"""

if start in text or end in text:
    if start not in text or end not in text:
        raise SystemExit("Incomplete dev landing marker block in Caddyfile")
    before, remainder = text.split(start, 1)
    _, after = remainder.split(end, 1)
    text = before + block + after
elif f"@dev_astforum host {public_host}" in text or public_host in text:
    raise SystemExit(f"{public_host} is already present without managed markers; inspect Caddyfile before continuing")
else:
    needle = "    respond 404"
    if needle not in text:
        raise SystemExit("Caddyfile final 404 anchor not found")
    text = text.replace(needle, block + "\n" + needle, 1)

path.write_text(text)
PY

python3 - "$compose_file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
mount = "      - ./dev-astforum:/srv/dev-astforum:ro"

if mount not in text:
    anchors = [
        "      - ./astforum:/srv/astforum:ro",
        "      - ./Caddyfile:/etc/caddy/Caddyfile:ro",
    ]
    for anchor in anchors:
        if anchor in text:
            text = text.replace(anchor, anchor + "\n" + mount, 1)
            break
    else:
        raise SystemExit("Compose Caddy volume anchor not found")

path.write_text(text)
PY

cd "$app_dir"
docker compose config -q
docker compose run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --no-deps --force-recreate caddy

readiness_attempt=1
readiness_limit=30
while ! curl --fail --silent --output /dev/null http://127.0.0.1/_origin_health 2>/dev/null; do
  if [ "$readiness_attempt" -ge "$readiness_limit" ]; then
    printf '%s\n' "Caddy did not become ready after $readiness_limit attempts." >&2
    exit 1
  fi

  readiness_attempt=$((readiness_attempt + 1))
  sleep 1
done

curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/ \
  | grep -F 'Площадка для лендинга готова' >/dev/null
curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/robots.txt \
  | grep -F 'Disallow: /' >/dev/null
curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/_landing_health \
  | grep -F 'ok' >/dev/null
demo_status=$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -H "Host: $public_host" http://127.0.0.1/api/demo-request
)
test "$demo_status" = "501"

deployment_complete=1
trap - EXIT HUP INT TERM
printf '%s\n' "AST Forum dev landing infrastructure deployed successfully."
printf '%s\n' "Host: $public_host"
printf '%s\n' "Backup: $backup_dir"
