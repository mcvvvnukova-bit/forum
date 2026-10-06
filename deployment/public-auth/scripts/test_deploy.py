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
            body = (self.target/route/'index.html').read_text()
            self.assertIn('id="public-auth-root"', body)
            self.assertEqual(body.count('/public-auth-assets/app.js'), 1)
            self.assertEqual(body.count('/public-auth-assets/app.css'), 1)
        self.assertEqual((self.target/'unrelated.txt').read_text(),'keep'); self.assertTrue(Path(report['backup']).exists())
    def test_repeated_publication_does_not_duplicate_loader(self):
        deploy(self.source,self.target,self.backups,'abc'); deploy(self.source,self.target,self.backups,'def')
        self.assertEqual((self.target/'index.html').read_text().count('/public-auth-assets/app.js'),1)
    def test_ignores_macos_metadata_without_modifying_it(self):
        metadata=self.target/'._index.html'
        metadata.write_bytes(b'\x00\x05\x16\x07Mac OS X\xa3')
        archived=self.target/'__MACOSX'/'index.html'
        archived.parent.mkdir(); archived.write_bytes(b'\xffmetadata')
        before={p:p.read_bytes() for p in [metadata,archived]}
        report=deploy(self.source,self.target,self.backups,'abc')
        self.assertIn('public-auth:start',(self.target/'index.html').read_text())
        for path,data in before.items():
            self.assertEqual(path.read_bytes(),data)
            self.assertNotIn(str(path.relative_to(self.target)),report['files'])
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
    def test_preserves_a_concurrent_page_update_it_did_not_write(self):
        from unittest.mock import patch
        from scripts.deployment import public_site
        original_write=public_site.install_asset
        other=self.target/'work/index.html'
        def write_with_other_deployment(path,data):
            original_write(path,data)
            if path == self.target/'public-auth-assets/app.js': other.write_text('<html><head></head><body>Other deployment</body></html>')
        with patch.object(public_site,'install_asset',side_effect=write_with_other_deployment):
            with self.assertRaises(RuntimeError): deploy(self.source,self.target,self.backups,'abc')
        self.assertIn('Other deployment',other.read_text())
        self.assertNotIn('public-auth:start',(self.target/'index.html').read_text())
