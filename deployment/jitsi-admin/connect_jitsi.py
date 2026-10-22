"""Back up and connect the existing Jitsi installation. Run as root on the VPS."""
import datetime
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path('/opt/jitsi-meet')
WEB = Path('/var/lib/jitsi-meet/web')
PRIVATE = Path('/opt/jitsi-admin/secrets/access.private.json')


def command(*args, capture=False):
    return subprocess.run(args, cwd=ROOT, check=True, capture_output=capture, text=True)


def main():
    stats = json.loads(command('docker', 'compose', 'exec', '-T', 'jicofo', 'wget', '-qO-', 'http://127.0.0.1:8888/stats', capture=True).stdout)
    if stats.get('conferences') != 0 or stats.get('participants') != 0:
        raise RuntimeError('An active conference prevents cutover; retry after it ends')
    secrets = json.loads(PRIVATE.read_text())
    backup = Path(secrets['backup_directory'])
    archive = backup / ('cutover-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar.gz')
    with tarfile.open(archive, 'w:gz') as stream:
        for path in [ROOT, WEB, Path('/var/lib/jitsi-meet/prosody')]:
            stream.add(path, arcname=str(path).lstrip('/'))
    archive.chmod(0o600)
    settings = {}
    for line in Path('/opt/jitsi-admin/jitsi.env.example').read_text().splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            settings[key] = value
    settings['JWT_APP_SECRET'] = secrets['jwt_secret']
    env = ROOT / '.env'
    lines = env.read_text().splitlines()
    updated = []
    seen = set()
    for line in lines:
        key = line.split('=', 1)[0] if '=' in line and not line.startswith('#') else None
        if key in settings:
            if key not in seen:
                updated.append(key + '=' + settings[key])
                seen.add(key)
        else:
            updated.append(line)
    updated.extend(key + '=' + value for key, value in settings.items() if key not in seen)
    env.write_text('\n'.join(updated) + '\n')
    env.chmod(0o600)
    custom = WEB / 'custom-config.js'
    content = custom.read_text() if custom.exists() else ''
    if '// PROJ-213 host login' not in content:
        custom.write_text(content + '\n// PROJ-213 host login: continue in this tab, preserving the exact room.\nconfig.tokenAuthInline = true;\n')
    command('python3', '/opt/jitsi-admin/prepare_prosody.py')
    command('docker', 'compose', 'config', '--quiet')
    # Check again immediately before a bounded restart of these three services.
    stats = json.loads(command('docker', 'compose', 'exec', '-T', 'jicofo', 'wget', '-qO-', 'http://127.0.0.1:8888/stats', capture=True).stdout)
    if stats.get('conferences') != 0:
        raise RuntimeError('A conference started during preparation; configuration is saved but not applied')
    command('docker', 'compose', 'up', '-d', '--no-deps', 'prosody', 'jicofo', 'web')
    print(json.dumps({'backup': str(archive), 'authType': 'jwt', 'guestLinksPreserved': True, 'jvbRestarted': False}))


if __name__ == '__main__':
    main()
