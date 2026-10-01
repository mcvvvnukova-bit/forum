"""Configure the newly installed listmonk through its authenticated HTTP interface."""
import http.cookiejar
import json
import pathlib
import time
import urllib.parse
import urllib.request
import uuid
from html.parser import HTMLParser

ROOT = pathlib.Path('/opt/astforum-mail')
SECRETS = ROOT / 'secrets'
BASE = 'http://127.0.0.1:19000'


class Inputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'input' and values.get('name'):
            self.values[values['name']] = values.get('value', '')


def login():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    response = opener.open(BASE + '/admin/login', timeout=15)
    form = Inputs()
    form.feed(response.read().decode())
    form.values.update(username='admin', password=(SECRETS / 'listmonk_admin_password').read_text().strip(), next='/admin/')
    opener.open(urllib.request.Request(BASE + '/admin/login', data=urllib.parse.urlencode(form.values).encode()), timeout=15).read()
    # Requests travel only over VPS loopback. Explicit cookies preserve the authenticated
    # session when the configured external root URL correctly marks them Secure.
    cookie = '; '.join(f'{entry.name}={entry.value}' for entry in jar)
    opener.addheaders = [('Cookie', cookie)]
    return opener


def api(opener, path, value=None, method=None):
    request = urllib.request.Request(BASE + '/api/' + path,
        data=json.dumps(value).encode() if value is not None else None,
        method=method, headers={'Content-Type': 'application/json'})
    with opener.open(request, timeout=20) as response:
        return json.load(response)['data']


def configure():
    opener = login()
    settings = api(opener, 'settings')
    backup = SECRETS / 'listmonk-settings-before.private.json'
    if not backup.exists():
        backup.write_text(json.dumps(settings, indent=2))
        backup.chmod(0o600)
    settings.update({
        'app.site_name': 'АСТ Форум — рассылки',
        'app.root_url': 'https://campaigns.astforum.ru',
        'app.from_email': 'АСТ Форум <newsletter@astforum.ru>',
        'app.notify_emails': ['postmaster@astforum.ru'],
        'app.lang': 'ru', 'app.concurrency': 2, 'app.message_rate': 2,
        'upload.filesystem.upload_path': 'uploads',
        'upload.filesystem.upload_uri': '/uploads',
        'bounce.enabled': False,
    })
    settings['smtp'] = [{
        'uuid': str(uuid.uuid4()), 'name': 'Stalwart AST Forum', 'enabled': True,
        'host': 'mail.astforum.ru', 'hello_hostname': 'mail.astforum.ru', 'port': 465,
        'auth_protocol': 'plain', 'username': 'newsletter@astforum.ru',
        'password': (SECRETS / 'newsletter_password').read_text().strip(),
        'email_headers': [{'Return-Path': 'bounces@astforum.ru'}],
        'max_conns': 2, 'max_msg_retries': 2, 'msg_retry_delay': '5s',
        'idle_timeout': '15s', 'wait_timeout': '10s',
        'tls_type': 'TLS', 'tls_skip_verify': False,
        'from_addresses': ['newsletter@astforum.ru'],
    }]
    settings['bounce.mailboxes'] = [{
        'uuid': str(uuid.uuid4()), 'enabled': True, 'type': 'pop',
        'host': 'mail.astforum.ru', 'port': 995, 'auth_protocol': 'userpass',
        'return_path': 'bounces@astforum.ru', 'username': 'bounces@astforum.ru',
        'password': (SECRETS / 'bounces_password').read_text().strip(),
        'scan_interval': '15m', 'tls_enabled': True, 'tls_skip_verify': False,
    }]
    api(opener, 'settings', settings, 'PUT')
    deadline = time.monotonic() + 30
    while True:
        try:
            verified = api(opener, 'settings')
            break
        except (ConnectionError, urllib.error.URLError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
    assert verified['app.root_url'] == 'https://campaigns.astforum.ru'
    assert verified['smtp'][0]['username'] == 'newsletter@astforum.ru'
    assert verified['smtp'][0]['tls_skip_verify'] is False
    print('listmonk settings saved and verified; bounce worker awaits trusted TLS certificate')


if __name__ == '__main__':
    configure()
