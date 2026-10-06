import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-dev-home.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'dist'
        self.target = self.root / 'landing'
        for path in [self.source / 'assets', self.target / 'assets', self.target / 'customers']:
            path.mkdir(parents=True)
        (self.source / 'index.html').write_text('new homepage')
        (self.source / 'assets/new.js').write_text('new bundle')
        (self.target / 'index.html').write_text('old homepage')
        (self.target / 'assets/old.js').write_text('old bundle')
        (self.target / 'customers/index.html').write_text('existing customer page')
        self.production = self.root / 'production.html'
        self.production.write_text('production placeholder')

    def run_deploy(self, verifier):
        return module.deploy(self.source, 'test-commit', self.target, self.root / 'backups',
                             [self.production, self.target / 'customers'], verifier)

    def test_success_retains_old_assets_and_protected_pages(self):
        report = self.run_deploy(lambda _: [{'verified': True}])
        self.assertEqual((self.target / 'index.html').read_text(), 'new homepage')
        self.assertEqual((self.target / 'assets/old.js').read_text(), 'old bundle')
        self.assertEqual((self.target / 'assets/new.js').read_text(), 'new bundle')
        self.assertEqual(self.production.read_text(), 'production placeholder')
        self.assertEqual((self.target / 'customers/index.html').read_text(), 'existing customer page')
        self.assertEqual((Path(report['backup']) / 'index.html').read_text(), 'old homepage')

    def test_verification_failure_restores_index_and_assets(self):
        def fail(_):
            raise RuntimeError('asset verification failed')
        with self.assertRaisesRegex(RuntimeError, 'asset verification failed'):
            self.run_deploy(fail)
        self.assertEqual((self.target / 'index.html').read_text(), 'old homepage')
        self.assertEqual((self.target / 'assets/old.js').read_text(), 'old bundle')
        self.assertEqual((self.target / 'assets/new.js').read_text(), 'new bundle')
        self.assertEqual(self.production.read_text(), 'production placeholder')


if __name__ == '__main__':
    unittest.main()
