"""Add only mail routes to existing Caddy configuration with validate/reload rollback."""
import datetime
import pathlib
import subprocess

root = pathlib.Path('/opt/outline')
config = root / 'Caddyfile'
original = config.read_text()
start = '    # astforum-mail:start\n'
end = '    # astforum-mail:end\n'
fragment = pathlib.Path('/opt/astforum-mail/caddy.fragment').read_text()
if not fragment.endswith('\n'):
    fragment += '\n'
if start in original:
    before, rest = original.split(start, 1)
    _, after = rest.split(end, 1)
    candidate = before + fragment + after
else:
    marker = '    respond 404\n}'
    if original.count(marker) != 1:
        raise SystemExit('Expected exactly one final fallback; shared configuration unchanged')
    candidate = original.replace(marker, fragment + '\n' + marker)
backup = pathlib.Path('/opt/astforum-mail/backups')
backup.mkdir(mode=0o700, exist_ok=True)
backup_file = backup / ('Caddyfile-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup_file.write_text(original)
backup_file.chmod(0o600)
candidate_file = pathlib.Path('/opt/astforum-mail/Caddyfile.candidate')
candidate_file.write_text(candidate)
subprocess.run(['docker', 'cp', str(candidate_file), 'outline-caddy-1:/tmp/mail-candidate.Caddyfile'], check=True)
subprocess.run(['docker', 'exec', 'outline-caddy-1', 'caddy', 'validate', '--config', '/tmp/mail-candidate.Caddyfile', '--adapter', 'caddyfile'], check=True)
config.write_text(candidate)
try:
    subprocess.run(['docker', 'exec', 'outline-caddy-1', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
except Exception:
    config.write_text(original)
    subprocess.run(['docker', 'exec', 'outline-caddy-1', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
    raise
print('Mail host routes validated and loaded; original configuration backed up')
