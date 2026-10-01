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
    def test_partial_failure_restores_previous_route_and_homepage(self):
        rename=Path.rename
        def fail(path,dest):
            if path.name=='work' and path.parent.name.startswith('.audience-pages-'): raise OSError('fixture disk error')
            return rename(path,dest)
        with patch.object(Path,'rename',fail),self.assertRaises(OSError): module.deploy(self.source,self.target,self.root/'backups')
        self.assertEqual((self.target/'customers/index.html').read_text(),'previous')
        self.assertEqual((self.target/'index.html').read_text(),'<body>original-home</body>')
        self.assertFalse((self.target/'suppliers').exists())
        self.assertEqual((self.target/'auth/keep').read_text(),'protected')

if __name__=='__main__': unittest.main()
