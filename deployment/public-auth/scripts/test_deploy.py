import tempfile
import unittest
from pathlib import Path
from deploy import deploy

class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.target=self.root/'landing'; self.source=self.root/'dist'; self.backups=self.root/'backups'
        self.target.mkdir(); self.source.mkdir(); (self.source/'public-auth-assets').mkdir()
        (self.source/'public-auth-assets/app.js').write_text('shared auth')
        (self.source/'public-auth-assets/app.css').write_text('auth styles')
        (self.source/'index.html').write_text('<html><head><script type="module" src="/public-auth-assets/app.js"></script><link rel="stylesheet" href="/public-auth-assets/app.css"></head><body><div id="public-auth-root"></div></body></html>')
        for path in ['index.html','customers/index.html','suppliers/index.html','work/index.html','participate/index.html']:
            p=self.target/path; p.parent.mkdir(exist_ok=True); p.write_text('<html><head></head><body>Existing page<script src="/audience-assets/resume.js"></script></body></html>')
        (self.target/'unrelated.txt').write_text('keep')
    def test_adds_shared_form_to_every_page_and_direct_urls(self):
        report=deploy(self.source,self.target,self.backups,'abc')
        for route in ['','customers','suppliers','work','participate']:
            body=(self.target/route/'index.html').read_text()
            self.assertIn('Existing page',body); self.assertIn('/public-auth-assets/app.js',body); self.assertNotIn('resume.js',body)
        for route in ['login','register']:
            self.assertEqual((self.target/route/'index.html').read_bytes(),(self.source/'index.html').read_bytes())
        self.assertEqual((self.target/'unrelated.txt').read_text(),'keep'); self.assertTrue(Path(report['backup']).exists())
    def test_repeated_publication_does_not_duplicate_loader(self):
        deploy(self.source,self.target,self.backups,'abc'); deploy(self.source,self.target,self.backups,'def')
        self.assertEqual((self.target/'index.html').read_text().count('/public-auth-assets/app.js'),1)
    def test_restores_existing_html_on_failed_verification(self):
        before=(self.target/'index.html').read_bytes()
        def fail(_): raise RuntimeError('failed verification')
        with self.assertRaises(RuntimeError): deploy(self.source,self.target,self.backups,'abc',verifier=fail)
        self.assertEqual((self.target/'index.html').read_bytes(),before)
        self.assertFalse((self.target/'login/index.html').exists())
    def test_refuses_missing_head_before_overwriting_any_page(self):
        (self.target/'work/index.html').write_text('corrupt page')
        before=(self.target/'index.html').read_bytes()
        with self.assertRaises(ValueError): deploy(self.source,self.target,self.backups,'abc')
        self.assertEqual((self.target/'index.html').read_bytes(),before)
