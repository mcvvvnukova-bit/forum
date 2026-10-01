#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this installer with sudo.' >&2
  exit 1
fi

source_dir=/home/testing-user/pgadmin-deploy
install_dir=/opt/pgadmin
outline_dir=/opt/outline
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=/opt/pgadmin-backup-$timestamp
had_existing=0
deployment_complete=0

test -f "$source_dir/compose.yaml"
test -f "$source_dir/servers.json"
test -f "$outline_dir/secrets/postgres_password"
docker network inspect outline_backend >/dev/null

port_owner=$(docker ps --filter publish=5050 --format '{{.Names}}')
if [ -n "$port_owner" ] && ! printf '%s\n' "$port_owner" | grep -Eq '^pgadmin-pgadmin-1$'; then
  printf 'TCP port 5050 is already published by: %s\n' "$port_owner" >&2
  exit 1
fi

if [ -d "$install_dir" ]; then
  cp -a "$install_dir" "$backup_dir"
  had_existing=1
fi

rollback() {
  printf '%s\n' 'pgAdmin deployment failed; rolling back.' >&2
  if [ -f "$install_dir/compose.yaml" ]; then
    docker compose -f "$install_dir/compose.yaml" down --remove-orphans || true
  fi
  rm -rf /opt/pgadmin
  if [ "$had_existing" -eq 1 ]; then
    mv "$backup_dir" "$install_dir"
    docker compose -f "$install_dir/compose.yaml" up -d || true
  fi
}

cleanup() {
  if [ "$deployment_complete" -ne 1 ]; then
    rollback
  fi
}
trap cleanup EXIT HUP INT TERM

install -d -m 0750 "$install_dir"
install -d -m 0700 "$install_dir/secrets"
install -m 0640 "$source_dir/compose.yaml" "$install_dir/compose.yaml"
install -m 0644 "$source_dir/servers.json" "$install_dir/servers.json"

if [ ! -s "$install_dir/secrets/admin_password" ]; then
  openssl rand -out "$install_dir/secrets/admin_password" -hex 24
fi
chown 5050:5050 "$install_dir/secrets/admin_password"
chmod 0400 "$install_dir/secrets/admin_password"

outline_password=$(tr -d '\r\n' < "$outline_dir/secrets/postgres_password")
case "$outline_password" in
  *:*|*\\*)
    printf '%s\n' 'The existing PostgreSQL password requires pgpass escaping.' >&2
    exit 1
    ;;
esac
umask 077
printf 'postgres:5432:outline:outline:%s\n' "$outline_password" \
  > "$install_dir/secrets/outline_pgpass"
unset outline_password
chown 5050:5050 "$install_dir/secrets/outline_pgpass"
chmod 0400 "$install_dir/secrets/outline_pgpass"

cd "$install_dir"
docker compose config --quiet
docker compose pull
docker compose up -d

attempt=1
limit=60
while ! curl --fail --silent --output /dev/null \
  http://127.0.0.1:5050/login 2>/dev/null; do
  if [ "$attempt" -ge "$limit" ]; then
    docker compose logs --tail=100 pgadmin >&2 || true
    printf 'pgAdmin did not become ready after %s attempts.\n' "$limit" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

admin_password=$(cat "$install_dir/secrets/admin_password")
docker compose exec -T pgadmin \
  /venv/bin/python3 /pgadmin4/setup.py update-user \
  admin@astforum.ru --password "$admin_password" --admin >/dev/null
unset admin_password
printf '%s\n' 'pgAdmin administrator password synchronized.'

database_name=$(
  docker compose exec -T pgadmin \
    env PGPASSFILE=/var/lib/pgadmin/storage/admin_astforum.ru/.pgpass \
    /usr/local/pgsql-18/psql \
    -h postgres -p 5432 -U outline -d outline \
    -Atqc 'select current_database()'
)
if [ "$database_name" != outline ]; then
  printf 'Unexpected database response: %s\n' "$database_name" >&2
  exit 1
fi
printf 'PostgreSQL connection verified: %s\n' "$database_name"

touch "$install_dir/.install-complete"
deployment_complete=1
trap - EXIT HUP INT TERM
printf '%s\n' 'pgAdmin 4 deployed successfully.'
printf '%s\n' 'Listen address: 127.0.0.1:5050'
printf '%s\n' 'Login: admin@astforum.ru'
printf 'Password: '
cat "$install_dir/secrets/admin_password"
printf '\n'
if [ "$had_existing" -eq 1 ]; then
  printf 'Backup retained at: %s\n' "$backup_dir"
fi
