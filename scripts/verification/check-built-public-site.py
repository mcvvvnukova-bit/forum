"""Check actual fresh Vite outputs through all three publishers in temp paths."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot(directory):
    return {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in directory.rglob('*') if p.is_file()}


home = load('built_home', 'scripts/deployment/primer-home/deploy-dev-home.py')
audience = load('built_audience', 'scripts/deployment/audience-pages/deploy.py')
auth = load('built_auth', 'scripts/deployment/public-auth/deploy.py')
home_build = ROOT / 'apps/primer-home/dist'
audience_build = ROOT / 'apps/audience-pages/dist/site'
auth_build = ROOT / 'apps/public-auth/dist'
for source, entry in ((home_build, 'index.html'), (audience_build, 'customers/index.html'),
                      (auth_build, 'index.html')):
    assert (source / entry).is_file(), f'Fresh owned build missing: {source / entry}'
before_sources = {p: snapshot(p) for p in (home_build, audience_build, auth_build)}
with tempfile.TemporaryDirectory(prefix='forum-built-public-site-') as temporary:
    site = Path(temporary) / 'landing'
    shutil.copytree(home_build, site)
    shutil.copytree(audience_build, site, dirs_exist_ok=True)
    (site / 'profile').mkdir()
    (site / 'profile/index.html').write_text('<html><head></head><body>synthetic profile</body></html>')
    (site / 'assets/old-home-hash.js').write_text('retained synthetic prior hash')
    retained = {name: digest for name, digest in snapshot(site).items() if not name.endswith('.html')}
    backups = site.parent / 'backups'
    operations = [
        ('auth', lambda: auth.deploy(auth_build, site, backups, 'quality-fixture')),
        ('home', lambda: home.deploy(home_build, 'quality-fixture', site, backups,
                                   [site / 'customers'], lambda _: [])),
        ('audience', lambda: audience.deploy(audience_build, site, backups, preserve_homepage=True)),
        ('auth', lambda: auth.deploy(auth_build, site, backups, 'quality-fixture')),
    ]
    for name, operation in operations:
        operation()
        pages = sorted(site.rglob('*.html'))
        assert len(pages) == 8, pages
        contract = json.loads((site / '.public-auth.json').read_text())
        for page in pages:
            body = page.read_text()
            assert body.count('<!-- public-auth:start -->') == 1, page
            for asset in contract['assets']:
                assert body.count('/' + asset) == 1, (page, asset)
            for ref in re.findall(r'(?:src|href)="(/[^\"]+)"', body):
                assert (site / ref.lstrip('/')).is_file(), (page, ref)
        actual = snapshot(site)
        assert all(actual[name] == digest for name, digest in retained.items())
        assert all(snapshot(path) == original for path, original in before_sources.items())
        print(f'{name}: 8 composed pages, referenced assets, retained hashes, unchanged source builds')
