#!/usr/bin/env python3
"""Replace only the dev homepage; retain the protected site and rollback copy."""
import argparse
import hashlib
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import shutil
import tempfile
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.deployment.public_site import build_files, compose, public_pages, publish

TARGET = Path('/opt/outline/dev-astforum/landing')
BACKUPS = Path('/opt/outline/backups')
PROTECTED = [Path('/opt/outline/astforum'), TARGET.parent / 'auth', TARGET / 'customers',
             Path('/opt/outline/dev-landing-auth'), Path('/opt/outline/Caddyfile'),
             Path('/opt/outline/docker-compose.yml')]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(paths):
    files = []
    for path in paths:
        if not path.exists():
            raise RuntimeError(f'Protected path missing: {path}')
        files.extend(sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path])
    return {str(path): digest(path.read_bytes()) for path in files}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(base, path, cookie=None, data=None):
    headers = {'Host': 'dev.astforum.ru'}
    if cookie:
        headers['Cookie'] = cookie
    req = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = urllib.request.build_opener(NoRedirect()).open(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify_release(source):
    origin = 'http://127.0.0.1'
    status, _, body = request(origin, '/')
    require(status == 200 and 'АСТ Форум — вход'.encode() in body, 'Dev access screen failed')
    password = Path('/opt/outline/secrets/dev_landing_password').read_text().strip()
    status, headers, _ = request(origin, '/auth/login', data=urllib.parse.urlencode({'password': password}).encode())
    require(status == 303, 'Existing dev login failed')
    cookies = SimpleCookie(headers.get('Set-Cookie', ''))
    require('forum_dev_auth' in cookies, 'Dev session cookie missing')
    cookie = 'forum_dev_auth=' + cookies['forum_dev_auth'].value
    assets = sorted(path for directory in ['assets', 'public-auth-assets']
                    for path in (source / directory).rglob('*') if path.is_file())
    checks = []
    for base in [origin, 'https://dev.astforum.ru']:
        status, _, body = request(base, '/', cookie)
        require(status == 200 and body == (source / 'index.html').read_bytes(), 'Homepage mismatch: ' + base)
        for asset in assets:
            status, headers, body = request(base, '/' + asset.relative_to(source).as_posix(), cookie)
            require(status == 200 and digest(body) == digest(asset.read_bytes()), 'Asset mismatch: ' + asset.name)
            require('text/html' not in headers.get('Content-Type', ''), 'Asset returned HTML: ' + asset.name)
        status, _, body = request(base, '/customers/', cookie)
        require(status == 200 and body == (TARGET / 'customers/index.html').read_bytes(), 'Customer page mismatch')
        status, _, body = request(base, '/_landing_health')
        require(status == 200 and body.strip() == b'ok', 'Gateway health failed')
        status, _, body = request(base, '/robots.txt')
        require(status == 200 and b'Disallow: /' in body, 'Dev robots policy changed')
        status, _, _ = request(base, '/api/auth/session')
        require(status == 401, 'Anonymous session API status changed')
        checks.append({'base': base, 'indexSha256': digest((source / 'index.html').read_bytes()),
                       'assetsVerified': len(assets), 'customersPreserved': True, 'gatewayHealth': 'ok'})
    return checks


def deploy(source, commit, target=TARGET, backups=BACKUPS, protected=PROTECTED, verifier=verify_release):
    source, target = Path(source), Path(target)
    require((source / 'index.html').is_file(), 'Build index/assets missing')
    require(target.is_dir() and (target / 'index.html').is_file(), 'Existing dev homepage missing')
    assets = build_files(source, ['assets'])
    before = fingerprint(protected)
    protected_bytes = {Path(name): Path(name).read_bytes() for name in before}

    def verify_composed(report):
        # Verification receives composed markup in a disposable build view.
        # Uploaded source bytes stay unchanged; retain the verifier(Path) API.
        with tempfile.TemporaryDirectory(prefix='primer-home-verification-') as temporary:
            view = Path(temporary) / 'dist'
            shutil.copytree(source, view)
            (view / 'index.html').write_bytes((target / 'index.html').read_bytes())
            if report['auth']:
                for name in report['auth']['assets']:
                    dest = view / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes((target / name).read_bytes())
            checks = verifier(view)
        expected = dict(before)
        if report['auth']:
            public = public_pages(target)
            for path, original in protected_bytes.items():
                try:
                    name = path.relative_to(target).as_posix()
                except ValueError:
                    continue
                if name in public:
                    expected[str(path)] = digest(compose(original, report['auth']))
        after = fingerprint(protected)
        require(expected == after, 'Protected files changed during deployment')
        report['protectedFilesUnchanged'] = sum(before[name] == after[name] for name in before)
        report['protectedFilesVerified'] = len(before)
        report['protectedAuthHtmlComposed'] = [str(Path(name).relative_to(target))
                                             for name in before if before[name] != expected[name]]
        return checks

    report = publish(source, target, backups, label='primer-home',
                     pages={'index.html': (source / 'index.html').read_bytes()},
                     assets=assets, commit=commit, verifier=verify_composed)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Uploaded dist directory')
    parser.add_argument('--commit', required=True, help='Source Git commit')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run via sudo')
    print(json.dumps(deploy(args.source.resolve(), args.commit), indent=2))
