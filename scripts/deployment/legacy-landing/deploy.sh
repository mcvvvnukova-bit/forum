#!/bin/sh
# This entrypoint is permanently retired, including bootstrap and --set-password.
# Refuse before inspecting a target, prompting, creating backups or running tools.
# A marker-only preflight could race the first unified publication; the old
# replacement also unlinks the permanent site lock and mounted parent directory.
printf '%s\n' 'Legacy landing deployment is retired. Use deployment/release.md for unified web publication; this command cannot change passwords.' >&2
exit 1

# Inert historical bootstrap/recovery source, retained for review and isolated
# archaeology tests only. No argument or environment variable enables it.
: <<'FORUM_RETIRED_LEGACY_DEPLOY_SOURCE'
#!/bin/sh
set -eu

app_dir=/opt/outline
site_dir_name=dev-astforum
auth_dir_name=dev-landing-auth
auth_service_name=dev_landing_auth
public_host=dev.astforum.ru
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd -P)
source_dir="$repo_dir/apps/legacy-landing/dist/site"
source_auth_dir="$repo_dir/apps/dev-gateway"
compose_file="$app_dir/docker-compose.yml"
caddy_file="$app_dir/Caddyfile"
password_secret_file="$app_dir/secrets/dev_landing_password"
session_secret_file="$app_dir/secrets/dev_landing_session_secret"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$app_dir/backups/dev-astforum-$timestamp"
target_dir="$app_dir/$site_dir_name"
tmp_target="$app_dir/$site_dir_name.tmp"
auth_target_dir="$app_dir/$auth_dir_name"
tmp_auth_target="$app_dir/$auth_dir_name.tmp"
deployment_complete=0
set_password=0
auth_start_attempted=0

usage() {
  printf '%s\n' "Usage: sudo $0 [--set-password]"
  printf '%s\n' "  --set-password  Prompt for and replace the shared dev landing password."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --set-password)
      set_password=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Run this script with sudo." >&2
  exit 1
fi

# cp -a preserves symlinks, while writing a secret follows them. Reject such
# paths (including broken links) before prompting or changing deployment state.
for secret_file in "$password_secret_file" "$session_secret_file"; do
  if [ -L "$secret_file" ] || { [ -e "$secret_file" ] && [ ! -f "$secret_file" ]; }; then
    printf '%s\n' "Secret path must be a regular file, not a symlink: $secret_file" >&2
    exit 1
  fi
done

if [ "$set_password" -eq 1 ]; then
  if [ ! -t 0 ]; then
    printf '%s\n' "--set-password requires an interactive terminal." >&2
    exit 1
  fi

  printf '%s' "Shared dev landing password: " >&2
  saved_stty=$(stty -g)
  stty -echo
  if ! IFS= read -r DEV_LANDING_PASSWORD; then
    stty "$saved_stty"
    printf '\n%s\n' "Could not read password." >&2
    exit 1
  fi
  stty "$saved_stty"
  printf '\n' >&2

  if [ -z "$DEV_LANDING_PASSWORD" ]; then
    printf '%s\n' "Password must not be empty." >&2
    exit 1
  fi
fi

test -f "$compose_file"
test -f "$caddy_file"
test -f "$source_dir/auth/index.html"
test -f "$source_dir/landing/index.html"
test -f "$source_dir/robots.txt"
test -f "$source_auth_dir/forum_dev_auth.py"
test -f "$repo_dir/scripts/verification/check_origin_login.py"

install -d -m 0750 "$backup_dir"
cp -a "$compose_file" "$backup_dir/docker-compose.yml"
cp -a "$caddy_file" "$backup_dir/Caddyfile"

if [ -d "$target_dir" ]; then
  cp -a "$target_dir" "$backup_dir/$site_dir_name"
else
  : > "$backup_dir/no-existing-$site_dir_name"
fi

if [ -d "$auth_target_dir" ]; then
  cp -a "$auth_target_dir" "$backup_dir/$auth_dir_name"
else
  : > "$backup_dir/no-existing-$auth_dir_name"
fi

# Save both existence and metadata; generated/replaced secrets belong to this
# deployment until all checks pass. Backups stay in the private backup directory.
for secret_file in "$password_secret_file" "$session_secret_file"; do
  if [ -e "$secret_file" ]; then
    cp -a "$secret_file" "$backup_dir/$(basename "$secret_file")"
  fi
done
previous_services=$(cd "$app_dir" && docker compose config --services)
if printf '%s\n' "$previous_services" | grep -Fx "$auth_service_name" >/dev/null; then
  previous_auth_service=1
else
  previous_auth_service=0
fi

rollback() {
  printf '%s\n' "Deployment failed; restoring $backup_dir" >&2
  rollback_failed=0
  cd "$app_dir" || return 1
  # Remove a first-install gateway while the failed Compose definition still
  # contains it. Never remove any unrelated service or use compose down.
  if [ "$previous_auth_service" -eq 0 ] && [ "$auth_start_attempted" -eq 1 ]; then
    docker compose rm -s -f "$auth_service_name" || rollback_failed=1
  fi
  cp -a "$backup_dir/docker-compose.yml" "$compose_file" || rollback_failed=1
  cp -a "$backup_dir/Caddyfile" "$caddy_file" || rollback_failed=1
  rm -rf "$target_dir" "$tmp_target" "$auth_target_dir" "$tmp_auth_target" || rollback_failed=1
  if [ -d "$backup_dir/$site_dir_name" ]; then
    cp -a "$backup_dir/$site_dir_name" "$target_dir" || rollback_failed=1
  fi
  if [ -d "$backup_dir/$auth_dir_name" ]; then
    cp -a "$backup_dir/$auth_dir_name" "$auth_target_dir" || rollback_failed=1
  fi
  for secret_file in "$password_secret_file" "$session_secret_file"; do
    rm -f "$secret_file" || rollback_failed=1
    if [ -e "$backup_dir/$(basename "$secret_file")" ]; then
      cp -a "$backup_dir/$(basename "$secret_file")" "$secret_file" || rollback_failed=1
    fi
  done
  # Directory replacement invalidates the running gateway's bind mounts. Both
  # gateway and Caddy must be recreated after restoring files and secrets.
  if [ "$previous_auth_service" -eq 1 ]; then
    docker compose up -d --no-deps --force-recreate "$auth_service_name" || rollback_failed=1
  fi
  docker compose up -d --no-deps --force-recreate caddy || rollback_failed=1
  [ "$rollback_failed" -eq 0 ]
}

cleanup() {
  deployment_status=$?
  trap - EXIT HUP INT TERM
  if [ "$deployment_complete" -ne 1 ]; then
    if ! rollback; then
      printf '%s\n' "Rollback failed; inspect $backup_dir and service state." >&2
    fi
    if [ "$deployment_status" -eq 0 ]; then
      deployment_status=1
    fi
  fi
  exit "$deployment_status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

rm -rf "$tmp_target"
install -d -m 0755 "$tmp_target"
cp -a "$source_dir/." "$tmp_target/"
find "$tmp_target" -type d -exec chmod 0755 {} \;
find "$tmp_target" -type f -exec chmod 0644 {} \;
rm -rf "$target_dir"
mv "$tmp_target" "$target_dir"

rm -rf "$tmp_auth_target"
install -d -m 0755 "$tmp_auth_target"
cp -a "$source_auth_dir/." "$tmp_auth_target/"
find "$tmp_auth_target" -type d -exec chmod 0755 {} \;
find "$tmp_auth_target" -type f -exec chmod 0644 {} \;
rm -rf "$auth_target_dir"
mv "$tmp_auth_target" "$auth_target_dir"

if [ ! -d "$app_dir/secrets" ]; then
  install -d -m 0700 "$app_dir/secrets"
fi
if [ -n "${DEV_LANDING_PASSWORD:-}" ]; then
  printf '%s' "$DEV_LANDING_PASSWORD" > "$password_secret_file"
  chmod 0400 "$password_secret_file"
  chown root:root "$password_secret_file"
  password_state=updated
elif [ ! -s "$password_secret_file" ]; then
  openssl rand -base64 24 > "$password_secret_file"
  chmod 0400 "$password_secret_file"
  chown root:root "$password_secret_file"
  password_state=generated
else
  password_state=preserved
fi

if [ ! -s "$session_secret_file" ]; then
  openssl rand -base64 48 > "$session_secret_file"
  chmod 0400 "$session_secret_file"
  chown root:root "$session_secret_file"
fi

python3 - "$caddy_file" "$public_host" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
public_host = sys.argv[2]
text = path.read_text()

start = "    # astforum-dev-landing:start\n"
end = "    # astforum-dev-landing:end\n"
block = f"""{start}    @dev_astforum host {public_host}
    handle @dev_astforum {{
        encode zstd gzip

        reverse_proxy dev_landing_auth:8080 {{
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Host {{http.request.host}}
        }}
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

service_start = "  # astforum-dev-landing-auth:start\n"
service_end = "  # astforum-dev-landing-auth:end\n"
service_block = """  # astforum-dev-landing-auth:start
  dev_landing_auth:
    image: python:3.13-alpine
    restart: unless-stopped
    command: ["python", "/app/forum_dev_auth.py"]
    environment:
      STATIC_ROOT: /srv/dev-astforum
      LOGIN_INDEX: /srv/dev-astforum/auth/index.html
      LANDING_ROOT: /srv/dev-astforum/landing
      PASSWORD_FILE: /run/secrets/dev_landing_password
      SESSION_SECRET_FILE: /run/secrets/dev_landing_session_secret
      PUBLIC_HOST: dev.astforum.ru
      FORUM_API_ORIGIN: http://forum_api:3001
      COOKIE_NAME: forum_dev_auth
      SESSION_TTL_SECONDS: "86400"
      PORT: "8080"
    expose:
      - "8080"
    volumes:
      - ./dev-astforum:/srv/dev-astforum:ro
      - ./dev-landing-auth:/app:ro
    secrets:
      - dev_landing_password
      - dev_landing_session_secret
    networks:
      - frontend
  # astforum-dev-landing-auth:end

"""

if service_start in text or service_end in text:
    if service_start not in text or service_end not in text:
        raise SystemExit("Incomplete dev landing auth service marker block in Compose file")
    before, remainder = text.split(service_start, 1)
    _, after = remainder.split(service_end, 1)
    text = before + service_block + after
elif "\nsecrets:\n" in text:
    text = text.replace("\nsecrets:\n", "\n" + service_block + "secrets:\n", 1)
else:
    raise SystemExit("Compose top-level secrets anchor not found")

secret_entries = """  dev_landing_password:
    file: ./secrets/dev_landing_password
  dev_landing_session_secret:
    file: ./secrets/dev_landing_session_secret
"""

if "  dev_landing_password:" not in text:
    text = text.replace("\nsecrets:\n", "\nsecrets:\n" + secret_entries, 1)

path.write_text(text)
PY

cd "$app_dir"
docker compose config -q
docker compose run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
auth_start_attempted=1
docker compose up -d --no-deps --force-recreate "$auth_service_name"
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

printf '%s\n' "Checking origin password screen..."
curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/ \
  | grep -F 'АСТ Форум — вход' >/dev/null
printf '%s\n' "Checking origin robots.txt..."
curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/robots.txt \
  | grep -F 'Disallow: /' >/dev/null
printf '%s\n' "Checking origin health endpoint..."
curl --fail --silent --show-error \
  -H "Host: $public_host" http://127.0.0.1/_landing_health \
  | grep -F 'ok' >/dev/null
printf '%s\n' "Checking origin demo endpoint placeholder..."
demo_status=$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -H "Host: $public_host" http://127.0.0.1/api/demo-request
)
test "$demo_status" = "501"

printf '%s\n' "Checking origin wrong-password flow..."
wrong_status=$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -H "Host: $public_host" \
    --data-urlencode "password=wrong-password" \
    http://127.0.0.1/auth/login
)
test "$wrong_status" = "303"

printf '%s\n' "Checking origin correct-password flow..."
python3 "$repo_dir/scripts/verification/check_origin_login.py" \
  http://127.0.0.1 \
  "$public_host" \
  "$password_secret_file" \
  'Одна площадка для всех участников стройки'

deployment_complete=1
trap - EXIT HUP INT TERM
printf '%s\n' "AST Forum dev landing infrastructure deployed successfully."
printf '%s\n' "Host: $public_host"
printf '%s\n' "Password secret: $password_secret_file ($password_state)"
printf '%s\n' "Backup: $backup_dir"
FORUM_RETIRED_LEGACY_DEPLOY_SOURCE
