"""Exercise artifact ownership before any publisher can touch the target."""
import json
from pathlib import Path
import tempfile
import unittest
from scripts.deployment.web_release import fingerprint, inventory, validate_artifact

ROUTES=['/', '/customers/', '/suppliers/', '/work/', '/participate/', '/login', '/cabinet/', '/cabinet/work/', '/cabinet/settings/', '/cabinet/organizations/', '/cabinet/roles/']
class RoleWebRoutes(unittest.TestCase):
    def artifact(self, directory, routes, environment='dev'):
        root=Path(directory);site=root/'site';site.mkdir()
        for route in routes:
            path=site/('index.html' if route=='/' else route.strip('/')+'/index.html')
            path.parent.mkdir(parents=True,exist_ok=True);path.write_text('Synthetic page')
        inputs={'apps/web/src/home/RoleManagementSection.tsx':'a'*64}
        config={'VITE_FORUM_SESSION':'true','VITE_LOGIN_URL':'/login','VITE_START_URL':'/login'} if environment=='dev' else {}
        files=inventory(site)
        manifest=dict(schemaVersion=2,recordKind='build',reconciliationStatus='build-only',environment=environment,
                      sourceSha='a'*40,sourceTree='b'*40,sourceFingerprint=fingerprint(inputs),inputs=inputs,
                      config=config,configFingerprint=fingerprint(config),lockFingerprint='c'*64,
                      installedDependencyFingerprint='d'*64,toolchain={'node':'test','npm':'test','vite':'test'},
                      buildMode='vite' if environment=='dev' else 'static-copy',files=files,artifactFingerprint=fingerprint(files),routes=routes)
        (root/'manifest.json').write_text(json.dumps(manifest))
        return root
    def test_dev_roles_page_is_owned_by_the_exact_current_route_set(self):
        with tempfile.TemporaryDirectory() as root:
            _,pages=validate_artifact(self.artifact(root,ROUTES),'a'*40,'dev')
            self.assertIn('cabinet/roles/index.html',pages)
    def test_unknown_extra_route_is_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError,'Route inventory mismatch'):
                validate_artifact(self.artifact(root,ROUTES+['/cabinet/unknown/']),'a'*40,'dev')
    def test_roles_route_is_not_a_production_page(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError,'Route inventory mismatch'):
                validate_artifact(self.artifact(root,['/','/cabinet/roles/'],'production'),'a'*40,'production')
