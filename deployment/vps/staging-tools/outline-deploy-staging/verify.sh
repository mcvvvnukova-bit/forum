#!/bin/sh
set -eu

cd /opt/outline
docker compose config --quiet
docker compose ps
docker inspect -f '{{.Name}}={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    outline-outline-1 outline-postgres-1 outline-redis-1

printf 'origin_docs='
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: docs.astforum.ru' http://127.0.0.1/
printf 'origin_main='
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: astforum.ru' http://127.0.0.1/

python3 - <<'PY'
import imaplib
import json
import pathlib
import smtplib
import urllib.request

request = urllib.request.Request(
    "http://127.0.0.1/api/auth.config",
    data=b"{}",
    headers={"Host": "docs.astforum.ru", "Content-Type": "application/json"},
)
config = json.load(urllib.request.urlopen(request))
assert config["data"]["name"] == "АСТ Форум"
assert any(provider["id"] == "email" for provider in config["data"]["providers"])
print("outline_email_provider=ok")

password = pathlib.Path("/opt/outline/secrets/smtp_password").read_text().strip()
smtp = smtplib.SMTP_SSL("mail.hosting.reg.ru", 465, timeout=15)
smtp.login("docs@astforum.ru", password)
smtp.quit()
print("smtp_auth=ok")

imap = imaplib.IMAP4_SSL("mail.hosting.reg.ru", 993)
imap.login("docs@astforum.ru", password)
status, data = imap.select("INBOX", readonly=True)
message_count = int(data[0])
imap.logout()
assert status == "OK" and message_count >= 2
print(f"imap_messages={message_count}")
PY

printf 'backup_timer_active='
systemctl is-active outline-backup.timer
printf 'backup_timer_enabled='
systemctl is-enabled outline-backup.timer
find /var/backups/outline -maxdepth 1 -type f -size +0c -printf '%f %s bytes\n' | sort | tail -4
stat -c 'smtp_secret=%a:%U:%G:%s' /opt/outline/secrets/smtp_password
