"""Local administrative helper. Run on the VPS as root; secrets never go to stdout."""
import base64
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path('/opt/astforum-mail')
SECRETS = ROOT / 'secrets'


def credentials(bootstrap=False):
    if bootstrap:
        return 'admin', (SECRETS / 'stalwart_bootstrap_password').read_text().strip()
    saved = json.loads((SECRETS / 'stalwart_admin.private.json').read_text())
    return saved['username'], saved['secret']


def call(method, args, bootstrap=False):
    user, password = credentials(bootstrap)
    payload = {'using': ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
               'methodCalls': [[method, args, 'c1']]}
    req = urllib.request.Request(
        'http://127.0.0.1:18080/jmap/', data=json.dumps(payload).encode(),
        headers={'Authorization': 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode(),
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.load(response)['methodResponses'][0]
    if result[0] == 'error' or any(result[1].get(k) for k in ('notCreated', 'notUpdated', 'notDestroyed')):
        raise RuntimeError(json.dumps(scrub(result)))
    return result[1]


def save_private(name, value):
    path = SECRETS / name
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def scrub(value):
    if isinstance(value, dict):
        return {key: ('[REDACTED]' if any(word in key.lower() for word in
                ('password', 'secret', 'token', 'privatekey', 'accountkey', 'credentials')) else scrub(item))
                for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


def bootstrap():
    if (SECRETS / 'stalwart_admin.private.json').exists():
        print('Bootstrap already completed; credentials preserved')
        return
    config = call('x:Bootstrap/get', {}, bootstrap=True)['list'][0]
    config.pop('id', None)
    config.update(serverHostname='mail.astforum.ru', defaultDomain='astforum.ru',
                  requestTlsCertificate=False, generateDkimKeys=True,
                  tracer={'@type': 'Stdout', 'enable': True, 'level': 'info'})
    result = call('x:Bootstrap/set', {'update': {'singleton': config}}, bootstrap=True)
    admin = result['updated']['singleton']
    if not admin.get('username') or not admin.get('secret'):
        save_private('stalwart-bootstrap-response.private.json', result)
        raise RuntimeError('Bootstrap response saved; credential fields missing')
    save_private('stalwart_admin.private.json', admin)
    print('Bootstrap completed; permanent administrator saved privately')


if __name__ == '__main__':
    if sys.argv[1] == 'bootstrap':
        bootstrap()
    else:
        args = json.load(sys.stdin) if len(sys.argv) > 2 and sys.argv[2] == '-' else {}
        print(json.dumps(scrub(call(sys.argv[1], args)), indent=2))
