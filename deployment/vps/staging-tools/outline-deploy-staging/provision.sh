#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    printf '%s\n' 'provision.sh must run as root' >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

. /etc/os-release
if [ "$ID" != debian ] || [ "$VERSION_CODENAME" != trixie ]; then
    printf 'Unsupported host: %s %s\n' "$ID" "$VERSION_CODENAME" >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl openssl
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
install -m 0644 "$script_dir/docker.sources" /etc/apt/sources.list.d/docker.sources
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

install -d -m 0750 /opt/outline
install -d -m 0700 /opt/outline/secrets
install -m 0644 "$script_dir/docker-compose.yml" /opt/outline/docker-compose.yml
install -m 0600 "$script_dir/docker.env" /opt/outline/docker.env
install -m 0644 "$script_dir/Caddyfile" /opt/outline/Caddyfile

if [ ! -s /opt/outline/secrets/outline_secret_key ]; then
    openssl rand -out /opt/outline/secrets/outline_secret_key -hex 32
fi
if [ ! -s /opt/outline/secrets/outline_utils_secret ]; then
    openssl rand -out /opt/outline/secrets/outline_utils_secret -hex 32
fi
if [ ! -s /opt/outline/secrets/postgres_password ]; then
    openssl rand -out /opt/outline/secrets/postgres_password -hex 32
fi

postgres_password=$(tr -d '\r\n' < /opt/outline/secrets/postgres_password)
umask 077
printf 'postgres://outline:%s@postgres:5432/outline\n' "$postgres_password" > /opt/outline/secrets/database_url
unset postgres_password
chown root:1001 \
    /opt/outline/secrets/outline_secret_key \
    /opt/outline/secrets/outline_utils_secret \
    /opt/outline/secrets/database_url
chmod 0640 \
    /opt/outline/secrets/outline_secret_key \
    /opt/outline/secrets/outline_utils_secret \
    /opt/outline/secrets/database_url
chown root:root /opt/outline/secrets/postgres_password
chmod 0600 /opt/outline/secrets/postgres_password

docker compose -f /opt/outline/docker-compose.yml config --quiet
docker compose -f /opt/outline/docker-compose.yml pull
docker compose -f /opt/outline/docker-compose.yml up -d

install -m 0750 "$script_dir/outline-backup" /usr/local/sbin/outline-backup
install -m 0644 "$script_dir/outline-backup.service" /etc/systemd/system/outline-backup.service
install -m 0644 "$script_dir/outline-backup.timer" /etc/systemd/system/outline-backup.timer
install -d -m 0700 /var/backups/outline
systemctl daemon-reload
systemctl enable --now outline-backup.timer
