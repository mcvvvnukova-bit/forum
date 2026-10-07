#!/bin/bash
# Run as root on forum-prod. Briefly stops only the new mail services.
set -euo pipefail
umask 077
root=/opt/astforum-mail
destination=/var/backups/astforum-mail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="$destination/$stamp"
compose=(docker compose --project-directory "$root" -f "$root/compose.yaml")
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
mkdir -p "$snapshot"
chmod 700 "$destination" "$snapshot"
mapfile -t running < <("${compose[@]}" ps --status running --services | sed -n '/^stalwart$/p; /^listmonk$/p')
resume() {
  if ((${#running[@]})); then
    "${compose[@]}" start "${running[@]}" >/dev/null
  fi
}
trap resume EXIT
if ((${#running[@]})); then
  "${compose[@]}" stop -t 30 "${running[@]}" >/dev/null
fi
"${compose[@]}" exec -T database pg_dump -U listmonk -Fc listmonk > "$snapshot/listmonk.dump"
tar --exclude='./postgres' --exclude='./backups' --exclude='*/__pycache__' \
  -C "$root" -czf "$snapshot/mail-files.tar.gz" .
install -m 600 /opt/outline/Caddyfile "$snapshot/Caddyfile.origin"
tar -C /etc -czf "$snapshot/letsencrypt-mail.tar.gz" \
  letsencrypt/live/mail.astforum.ru letsencrypt/archive/mail.astforum.ru \
  letsencrypt/renewal/mail.astforum.ru.conf letsencrypt/accounts \
  letsencrypt/renewal-hooks/deploy/astforum-stalwart
tar -tzf "$snapshot/mail-files.tar.gz" >/dev/null
tar -tzf "$snapshot/letsencrypt-mail.tar.gz" >/dev/null
"${compose[@]}" exec -T database pg_restore --list < "$snapshot/listmonk.dump" >/dev/null
(
  cd "$snapshot"
  sha256sum listmonk.dump mail-files.tar.gz Caddyfile.origin letsencrypt-mail.tar.gz > SHA256SUMS
  sha256sum --check SHA256SUMS
)
resume
trap - EXIT
echo "Backup created: $snapshot"
echo 'Local root-only backup. Restore procedure has not been exercised.'
