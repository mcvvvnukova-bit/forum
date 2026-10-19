"""Apply exact callbacks and locale to this installation; run as root on its VPS.

Secrets are read only from the private installation directory and never printed.
"""
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path('/opt/jitsi-admin/secrets')
BASE = 'http://127.0.0.1:18080/admin/auth'
PUBLIC = 'https://vks.mvpspace.ru/admin'


def configure():
    secrets = json.loads((ROOT / 'access.private.json').read_text())
    env = dict(line.split('=', 1) for line in (ROOT / 'keycloak.env').read_text().splitlines() if '=' in line)
    body = urllib.parse.urlencode({
        'client_id': 'admin-cli', 'grant_type': 'password',
        'username': env.get('KC_BOOTSTRAP_ADMIN_USERNAME', 'admin'),
        'password': secrets['keycloak_admin'],
    }).encode()
    with urllib.request.urlopen(BASE + '/realms/master/protocol/openid-connect/token', body, timeout=30) as response:
        token = json.load(response)['access_token']

    def api(path, method='GET', data=None):
        request = urllib.request.Request(BASE + '/admin/realms/vks' + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    callbacks = [PUBLIC + prefix + '/login/keycloak_login/check' for prefix in ['', '/de', '/en', '/fr', '/es', '/vi', '/zh', '/ja', '/pt']]
    realm = api('')
    realm.update(internationalizationEnabled=True, supportedLocales=['ru', 'en'], defaultLocale='ru', registrationAllowed=False)
    api('', 'PUT', realm)
    for client in api('/clients'):
        if client['clientId'] == 'jitsi-admin':
            client['redirectUris'] = callbacks
            client['webOrigins'] = ['https://vks.mvpspace.ru']
            api('/clients/' + client['id'], 'PUT', client)
        elif client['clientId'] == 'vks-host':
            # The host route reuses the portal session; this unused bootstrap client is unnecessary.
            api('/clients/' + client['id'], 'DELETE')
    seed_path = ROOT / 'vks-realm.json'
    seed = json.loads(seed_path.read_text())
    seed.update(internationalizationEnabled=True, supportedLocales=['ru', 'en'], defaultLocale='ru')
    seed['clients'] = [c for c in seed['clients'] if c['clientId'] != 'vks-host']
    for client in seed['clients']:
        if client['clientId'] == 'jitsi-admin':
            client['redirectUris'] = callbacks
    seed_path.chmod(0o600)
    seed_path.write_text(json.dumps(seed, ensure_ascii=False, indent=2))
    seed_path.chmod(0o444)
    print(json.dumps({'realm': 'vks', 'registrationAllowed': False, 'exactCallbacks': len(callbacks), 'defaultLocale': 'ru'}))


if __name__ == '__main__':
    configure()
