import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DeploymentScope(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source, self.target = self.root/'package', self.root/'site'
        self.target.mkdir()
        (self.target/'index.html').write_text('<body>original-home</body>')
        (self.target/'auth').mkdir(); (self.target/'auth/keep').write_text('protected')
        for name in module.NAMES:
            (self.source/name).mkdir(parents=True)
            (self.source/name/('resume.js' if name=='audience-assets' else 'index.html')).write_text('new')
        (self.target/'customers').mkdir(); (self.target/'customers/index.html').write_text('previous')
    def tearDown(self): self.tmp.cleanup()
    def test_updates_only_owned_routes_and_resume_marker(self):
        result=module.deploy(self.source,self.target,self.root/'backups')
        self.assertEqual((self.target/'auth/keep').read_text(),'protected')
        self.assertEqual((self.target/'customers/index.html').read_text(),'new')
        self.assertTrue(result['homepage_only_resume_changed'])
        self.assertEqual((Path(result['backup'])/'customers/index.html').read_text(),'previous')
    def test_repeated_publish_does_not_duplicate_resume_script(self):
        module.deploy(self.source,self.target,self.root/'backups')
        module.deploy(self.source,self.target,self.root/'backups')
        self.assertEqual((self.target/'index.html').read_text().count(module.MARKER),1)
    def test_can_publish_routes_without_changing_homepage_callback_owner(self):
        original=b'<head></head><body>home independently managed</body>'
        (self.target/'index.html').write_bytes(original)
        result=module.deploy(self.source,self.target,self.root/'backups',preserve_homepage=True)
        self.assertEqual((self.target/'index.html').read_bytes(),original)
        self.assertEqual((Path(result['backup'])/'index.html').read_bytes(),original)
        self.assertEqual((self.target/'work/index.html').read_text(),'new')
        self.assertEqual((self.target/'auth/keep').read_text(),'protected')
        self.assertEqual(result['homepage_before'],result['homepage_after'])
    def test_partial_failure_restores_previous_route_and_homepage(self):
        from scripts.deployment import public_site
        atomic_write = public_site.atomic_write
        def fail(path, data):
            if path == self.target/'work/index.html': raise OSError('fixture disk error')
            return atomic_write(path, data)
        with patch.object(public_site, 'atomic_write', fail), self.assertRaises(OSError):
            module.deploy(self.source, self.target, self.root/'backups')
        self.assertEqual((self.target/'customers/index.html').read_text(),'previous')
        self.assertEqual((self.target/'index.html').read_text(),'<body>original-home</body>')
        self.assertFalse((self.target/'suppliers/index.html').exists())
        self.assertEqual((self.target/'auth/keep').read_text(),'protected')

if __name__=='__main__': unittest.main()
