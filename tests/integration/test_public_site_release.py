"""Exercise the three real filesystem publishers together, without network access."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import sys
from unittest.mock import patch
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


home = load('home_publisher', 'deployment/primer-home/scripts/deploy-dev-home.py')
audience = load('audience_publisher', 'deployment/audience-pages/scripts/deploy.py')
auth = load('auth_publisher', 'deployment/public-auth/scripts/deploy.py')


def html(body, loaders=''):
    return f'<html><head>{loaders}</head><body>{body}</body></html>'


def write(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data)


def snapshot(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()}


class PublicSiteReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = self.root / 'landing'
        self.backups = self.root / 'backups'
        self.home = self.root / 'home'
        self.audience = self.root / 'audience'
        self.auth = self.root / 'auth'
        write(self.target, 'index.html', html('old home'))
        write(self.target, 'profile/index.html', html('existing profile'))
        write(self.target, 'assets/old-home.js', 'old homepage bundle')
        write(self.home, 'assets/home-a.js', 'home bundle')
        write(self.home, 'index.html', html('new home', '<script type="module" src="/assets/home-a.js"></script>'))
        for route in ('customers', 'suppliers', 'work', 'participate'):
            write(self.target, route + '/index.html', html('old ' + route))
            write(self.audience, route + '/index.html', html('new ' + route, '<script type="module" src="/audience-assets/audience-a.js"></script>')
                  .replace('</body>', '<script src="/audience-assets/resume.js" defer></script></body>'))
        write(self.audience, 'audience-assets/audience-a.js', 'audience bundle')
        write(self.audience, 'audience-assets/resume.js', 'legacy resume')
        self.make_auth('a')
        self.original_sources = {p: snapshot(p) for p in (self.home, self.audience, self.auth)}

    def make_auth(self, version):
        write(self.auth, f'public-auth-assets/auth-{version}.js', 'auth ' + version)
        write(self.auth, f'public-auth-assets/auth-{version}.css', 'styles ' + version)
        write(self.auth, 'index.html', html('<div id="public-auth-root"></div>',
              f'<script type="module" src="/public-auth-assets/auth-{version}.js"></script>'
              f'<link rel="stylesheet" href="/public-auth-assets/auth-{version}.css">'))

    def publish_home(self, verifier=lambda _: []):
        return home.deploy(self.home, 'home-sha', self.target, self.backups, [], verifier)

    def publish_audience(self, verifier=None):
        if verifier is None:
            return audience.deploy(self.audience, self.target, self.backups, preserve_homepage=True)
        return audience.deploy(self.audience, self.target, self.backups, preserve_homepage=True, verifier=verifier)

    def publish_auth(self, verifier=None):
        return auth.deploy(self.auth, self.target, self.backups, 'auth-sha', verifier)

    def assert_auth_all(self, version='a'):
        pages = sorted(self.target.rglob('*.html'))
        self.assertEqual(len(pages), 8)
        for page in pages:
            body = page.read_text()
            with self.subTest(page=page.relative_to(self.target)):
                self.assertEqual(body.count(f'/public-auth-assets/auth-{version}.js'), 1)
                self.assertEqual(body.count(f'/public-auth-assets/auth-{version}.css'), 1)
                self.assertNotIn('resume.js', body)
                for ref in re.findall(r'(?:src|href)="(/[^\"]+)"', body):
                    self.assertTrue((self.target / ref.lstrip('/')).is_file(), ref)

    def restore_fixture_site(self, original):
        shutil.rmtree(self.target)
        for name, data in original.items():
            path = self.target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if self.backups.exists():
            shutil.rmtree(self.backups)

    def assert_rejected_without_mutation(self, operation):
        before = snapshot(self.target)
        sources = {path: snapshot(path) for path in (self.home, self.audience, self.auth)}
        backups = snapshot(self.backups)
        with self.assertRaisesRegex(ValueError, 'executable.*enabled stylesheet'):
            operation()
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual(snapshot(self.backups), backups)
        for path, original in sources.items():
            self.assertEqual(snapshot(path), original)

    def invalid_loaders(self):
        script = '<script src="/public-auth-assets/auth-a.js"></script>'
        style = '<link rel="stylesheet" href="/public-auth-assets/auth-a.css">'
        return {
            'json-script': script.replace('<script ', '<script type="application/json" ') + style,
            'nomodule-classic': script.replace('<script ', '<script nomodule ') + style,
            'disabled-style': script + style.replace('<link ', '<link disabled '),
            'nomodule-false': script.replace('<script ', '<script nomodule=false ') + style,
            'disabled-false': script + style.replace('<link ', '<link disabled=false '),
            'duplicate-inert-type': script.replace('<script ', '<script type=application/json type=module ') + style,
            'mime-parameters': script.replace('<script ', '<script type="application/javascript; charset=utf-8" ') + style,
            'padded-module': script.replace('<script ', '<script type=" module " ') + style,
            'whitespace-type': script.replace('<script ', '<script type=" \t\n" ') + style,
            'language-vbscript': script.replace('<script ', '<script language=vbscript ') + style,
            'padded-language': script.replace('<script ', '<script language=" javascript " ') + style,
            'non-ascii-whitespace-type': script.replace('<script ', '<script type="\u00a0text/javascript\u00a0" ') + style,
        }

    def test_first_install_rejects_inert_loader_without_source_site_or_backup_writes(self):
        original = snapshot(self.target)
        for case, loaders in self.invalid_loaders().items():
            with self.subTest(case=case):
                self.restore_fixture_site(original)
                write(self.auth, 'index.html', html('<div id="public-auth-root"></div>', loaders))
                self.assert_rejected_without_mutation(self.publish_auth)

    def test_all_publishers_reject_inert_legacy_auth_without_mutation(self):
        original = snapshot(self.target)
        for case, loaders in self.invalid_loaders().items():
            for operation in (self.publish_home, self.publish_audience, self.publish_auth):
                with self.subTest(case=case, publisher=operation.__name__):
                    self.restore_fixture_site(original)
                    for route in ('login', 'register'):
                        write(self.target, route + '/index.html', html('legacy auth', loaders))
                    for asset in (self.auth / 'public-auth-assets').iterdir():
                        write(self.target, 'public-auth-assets/' + asset.name, asset.read_text())
                    self.assert_rejected_without_mutation(operation)

    def test_supported_module_classic_and_ordinary_attributes_remain_executable(self):
        original = snapshot(self.target)
        variants = (
            '<script src="/public-auth-assets/auth-a.js"></script>',
            '<script type="text/javascript" src="/public-auth-assets/auth-a.js"></script>',
            '<script type="application/javascript" charset="utf-8" src="/public-auth-assets/auth-a.js"></script>',
            '<script type=" \tTEXT/JAVASCRIPT\n" src="/public-auth-assets/auth-a.js"></script>',
            '<script type="" language=vbscript src="/public-auth-assets/auth-a.js"></script>',
            '<script language=javascript src="/public-auth-assets/auth-a.js"></script>',
            '<script language="" src="/public-auth-assets/auth-a.js"></script>',
            '<script type="text/javascript1.5" src="/public-auth-assets/auth-a.js"></script>',
            '<script type="application/x-javascript" src="/public-auth-assets/auth-a.js"></script>',
            '<script language=jscript src="/public-auth-assets/auth-a.js"></script>',
            '<script type=MoDuLe src="/public-auth-assets/auth-a.js"></script>',
            '<script type=module language=vbscript src="/public-auth-assets/auth-a.js"></script>',
            '<SCRIPT TYPE = module SRC = /public-auth-assets/auth-a.js></SCRIPT>',
            "<script type='module' nomodule src='/public-auth-assets/auth-a.js'></script>",
        )
        for script in variants:
            with self.subTest(script=script):
                self.restore_fixture_site(original)
                loaders = script + "<LINK REL = 'preload stylesheet' HREF = /public-auth-assets/auth-a.css>"
                write(self.auth, 'index.html', html('<div id="public-auth-root"></div>', loaders))
                for operation in (self.publish_auth, self.publish_home, self.publish_audience, self.publish_auth):
                    operation()
                    for page in self.target.rglob('*.html'):
                        body = page.read_text()
                        self.assertEqual(body.count('/public-auth-assets/auth-a.js'), 1)
                        self.assertEqual(body.count('/public-auth-assets/auth-a.css'), 1)

    def test_auth_then_home_keeps_active_loader_on_every_page(self):
        self.publish_auth()
        self.publish_home()
        self.assert_auth_all()

    def test_auth_then_audience_keeps_active_loader_on_every_page(self):
        self.publish_auth()
        self.publish_audience()
        self.assert_auth_all()

    def test_repeated_full_sequence_and_rotation_preserve_sources_and_assets(self):
        for operation in (self.publish_auth, self.publish_home, self.publish_audience, self.publish_auth):
            operation()
            self.assert_auth_all()
        for path, original in self.original_sources.items():
            self.assertEqual(snapshot(path), original)
        self.make_auth('b')
        rotated = snapshot(self.auth)
        for operation in (self.publish_auth, self.publish_audience, self.publish_home, self.publish_auth):
            operation()
            self.assert_auth_all('b')
        self.assertEqual(snapshot(self.auth), rotated)
        for path in ('public-auth-assets/auth-a.js', 'public-auth-assets/auth-b.js', 'assets/old-home.js', 'assets/home-a.js'):
            self.assertTrue((self.target / path).is_file(), path)

    def test_home_and_audience_before_auth_are_composed_when_auth_installs(self):
        self.publish_home()
        self.publish_audience()
        self.publish_auth()
        self.assert_auth_all()

    def test_home_repairs_auth_on_protected_audience_html_without_changing_page_content(self):
        self.publish_auth()
        original = html('existing customer content', '<script src="/audience-assets/audience-a.js"></script>')
        write(self.target, 'customers/index.html', original)
        write(self.target, 'audience-assets/audience-a.js', 'audience bundle')
        protected = self.root / 'gateway-secret'
        protected.write_text('fixture secret')
        home.deploy(self.home, 'sha', self.target, self.backups,
                    [self.target / 'customers', protected], lambda _: [])
        self.assertIn('existing customer content', (self.target / 'customers/index.html').read_text())
        self.assertEqual(protected.read_text(), 'fixture secret')
        self.assert_auth_all()

    def test_late_failure_restores_composed_markup_and_retains_all_hashes(self):
        self.publish_auth()
        write(self.home, 'assets/home-b.js', 'new home hash')
        write(self.home, 'index.html', html('next home', '<script src="/assets/home-b.js"></script>'))
        write(self.audience, 'audience-assets/audience-b.js', 'new audience hash')
        self.make_auth('b')
        def fail(_):
            raise RuntimeError('forced late verification failure')
        for operation, new_asset in ((self.publish_home, 'assets/home-b.js'),
                                     (self.publish_audience, 'audience-assets/audience-b.js'),
                                     (self.publish_auth, 'public-auth-assets/auth-b.js')):
            before = snapshot(self.target)
            with self.subTest(operation=operation.__name__):
                with self.assertRaisesRegex(RuntimeError, 'forced late verification failure'):
                    operation(fail)
                for name, data in before.items():
                    self.assertEqual((self.target / name).read_bytes(), data, name)
                self.assertTrue((self.target / new_asset).is_file())
                self.assert_auth_all('a')

    def test_verifier_reads_composed_home_in_a_separate_unchanged_build_view(self):
        self.publish_auth()
        before = snapshot(self.home)
        def verify(view):
            self.assertNotEqual(view, self.home)
            self.assertEqual((view / 'index.html').read_bytes(), (self.target / 'index.html').read_bytes())
            self.assertIn('/public-auth-assets/auth-a.js', (view / 'index.html').read_text())
            self.assertTrue((view / 'public-auth-assets/auth-a.js').is_file())
            return ['composed homepage checked']
        self.assertEqual(self.publish_home(verify)['checks'], ['composed homepage checked'])
        self.assertEqual(snapshot(self.home), before)

    def test_each_publisher_preserves_external_html_and_assets_on_rollback_conflict(self):
        self.publish_auth()
        for operation in (self.publish_home, self.publish_audience, self.publish_auth):
            # Ensure the auth transaction actually changes the homepage too.
            self.make_auth('b' if operation == self.publish_auth else 'a')
            def conflict(_):
                write(self.target, 'index.html', html('parallel ' + operation.__name__))
                write(self.target, 'assets/parallel.js', 'parallel asset')
                raise RuntimeError('external update then failure')
            with self.subTest(operation=operation.__name__):
                with self.assertRaisesRegex(RuntimeError, 'rollback incomplete.*index.html'):
                    operation(conflict)
                self.assertEqual((self.target / 'index.html').read_text(), html('parallel ' + operation.__name__))
                self.assertEqual((self.target / 'assets/parallel.js').read_text(), 'parallel asset')
                conflicts = list(self.backups.rglob('rollback-conflicts.json'))
                self.assertTrue(conflicts)
        self.assertTrue((self.target / 'public-auth-assets/auth-a.js').exists())
        self.assertTrue((self.target / 'public-auth-assets/auth-b.js').exists())

    def test_partial_copy_failure_leaves_only_complete_assets_and_previous_html(self):
        from scripts.deployment import public_site
        self.publish_auth()
        before = snapshot(self.target)
        write(self.audience, 'audience-assets/new-a.js', 'new complete asset')
        write(self.audience, 'audience-assets/new-b.js', 'other complete asset')
        install = public_site.install_asset
        def fail(path, data):
            if path.name == 'new-b.js':
                raise OSError('asset copy interrupted')
            return install(path, data)
        with patch.object(public_site, 'install_asset', fail):
            with self.assertRaisesRegex(OSError, 'asset copy interrupted'):
                self.publish_audience()
        for name, data in before.items():
            self.assertEqual((self.target / name).read_bytes(), data, name)
        self.assertEqual((self.target / 'audience-assets/new-a.js').read_text(), 'new complete asset')
        self.assertFalse((self.target / 'audience-assets/new-b.js').exists())

    def test_partial_html_write_failure_rolls_back_previous_markup(self):
        from scripts.deployment import public_site
        self.publish_auth()
        before = snapshot(self.target)
        atomic_write = public_site.atomic_write
        def fail(path, data):
            if path == self.target / 'work/index.html' and b'new work' in data:
                raise OSError('HTML write interrupted')
            return atomic_write(path, data)
        with patch.object(public_site, 'atomic_write', fail):
            with self.assertRaisesRegex(OSError, 'HTML write interrupted'):
                self.publish_audience()
        for name, data in before.items():
            self.assertEqual((self.target / name).read_bytes(), data, name)

    def test_failed_rollback_reports_residual_path_and_backup(self):
        from scripts.deployment import public_site
        self.publish_auth()
        original = (self.target / 'index.html').read_bytes()
        atomic_write = public_site.atomic_write
        def fail_rollback(path, data):
            if path == self.target / 'index.html' and data == original:
                raise OSError('rollback disk failure')
            return atomic_write(path, data)
        def fail(_):
            raise RuntimeError('verifier failure')
        with patch.object(public_site, 'atomic_write', fail_rollback):
            with self.assertRaisesRegex(RuntimeError, 'rollback incomplete; backup .*index.html.*rollback disk failure'):
                self.publish_home(fail)
        self.assertIn('new home', (self.target / 'index.html').read_text())

    def test_corrupted_established_auth_fails_all_publishers_before_mutation(self):
        self.publish_auth()
        initial = snapshot(self.target)
        cases = ('manifest', 'login', 'register', 'css', 'tampered-asset', 'canonicals')
        for case in cases:
            shutil.rmtree(self.target)
            for name, data in initial.items():
                path = self.target / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            if case == 'manifest':
                write(self.target, '.public-auth.json', '{broken')
            elif case == 'login':
                (self.target / 'login/index.html').unlink()
            elif case == 'register':
                write(self.target, 'register/index.html', html('damaged'))
            elif case == 'css':
                (self.target / 'public-auth-assets/auth-a.css').unlink()
            elif case == 'tampered-asset':
                write(self.target, 'public-auth-assets/auth-a.js', 'wrong hash')
            else:
                (self.target / 'login/index.html').unlink()
                (self.target / 'register/index.html').unlink()
            before, backups_before = snapshot(self.target), snapshot(self.backups)
            for operation in (self.publish_home, self.publish_audience, self.publish_auth):
                with self.subTest(case=case, operation=operation.__name__):
                    with self.assertRaises(ValueError):
                        operation()
                    self.assertEqual(snapshot(self.target), before)
                    self.assertEqual(snapshot(self.backups), backups_before)

    def test_legacy_canonical_auth_is_validated_and_adopted_without_reinjection(self):
        self.publish_auth()
        (self.target / '.public-auth.json').unlink()
        self.publish_home()
        self.publish_audience()
        self.assert_auth_all()
        self.assertTrue((self.target / '.public-auth.json').is_file())

    def test_failed_first_auth_install_can_retry_with_retained_assets(self):
        def fail(_):
            raise RuntimeError('first install failed')
        with self.assertRaisesRegex(RuntimeError, 'first install failed'):
            self.publish_auth(fail)
        self.assertFalse((self.target / 'login/index.html').exists())
        self.assertFalse((self.target / '.public-auth.json').exists())
        self.assertTrue((self.target / 'public-auth-assets/auth-a.js').exists())
        self.publish_auth()
        self.assert_auth_all()

    def test_immutable_asset_collision_fails_before_page_or_backup_writes(self):
        self.publish_auth()
        write(self.home, 'assets/old-home.js', 'different bytes for an old hash')
        before, backups_before = snapshot(self.target), snapshot(self.backups)
        with self.assertRaisesRegex(ValueError, 'Immutable asset collision'):
            self.publish_home()
        self.assertEqual(snapshot(self.target), before)
        self.assertEqual(snapshot(self.backups), backups_before)

    def test_os_lock_is_shared_by_all_three_real_publisher_processes(self):
        from scripts.deployment import public_site
        code = """import importlib.util,sys
from pathlib import Path
script,source,target,backups,kind=sys.argv[1:]
spec=importlib.util.spec_from_file_location('publisher',script)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
if kind=='home': module.deploy(Path(source),'sha',Path(target),Path(backups),[],lambda _: [])
elif kind=='auth': module.deploy(source,target,backups,'sha')
else: module.deploy(source,target,backups)
"""
        before = snapshot(self.target)
        with public_site.site_lock(self.target):
            for script, source, kind in (
                ('deployment/primer-home/scripts/deploy-dev-home.py', self.home, 'home'),
                ('deployment/audience-pages/scripts/deploy.py', self.audience, 'audience'),
                ('deployment/public-auth/scripts/deploy.py', self.auth, 'auth')):
                result = subprocess.run([sys.executable, '-c', code, str(ROOT / script), str(source),
                                         str(self.target), str(self.backups), kind], capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('publication busy; retry', result.stderr)
        self.assertEqual(snapshot(self.target), before)
        self.assertFalse(self.backups.exists())


if __name__ == '__main__':
    unittest.main()
