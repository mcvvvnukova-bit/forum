"""Real built files + Linux exchange through two views of an actual Docker bind.
Run via scripts/verification/check-web-release.sh, not a mocked rename syscall.
"""
import http.client
import importlib.util
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import sys
import threading
import unittest
import urllib.request
sys.path.insert(0, '/repo')
from scripts.deployment.web_release import deploy, fingerprint, inventory, validate_artifact, rollback
from scripts.deployment.public_site import publish, site_lock
spec=importlib.util.spec_from_file_location('web_release_gateway','/repo/apps/dev-gateway/forum_dev_auth.py')
gateway=importlib.util.module_from_spec(spec);sys.modules[spec.name]=gateway;spec.loader.exec_module(gateway)

class Release(unittest.TestCase):
    def setUp(self):
        self.parent=Path('/proof')
        for path in self.parent.iterdir():
            if path.is_dir(): shutil.rmtree(path)
            else:path.unlink()
        self.target=self.parent/'landing'
        shutil.copytree('/artifact/site',self.target)
        self.old=(self.target/'index.html').read_bytes().replace(b'<title>',b'<title>Prior ')
        (self.target/'index.html').write_bytes(self.old)
        (self.target/'profile').mkdir();(self.target/'profile/index.html').write_text('retained profile fixture')
        (self.target/'._legacy').write_bytes(b'retained AppleDouble fixture')
        (self.target/'assets').mkdir();(self.target/'assets/old-delayed.js').write_bytes(b'old delayed fixture')
        (self.target/'register').mkdir(exist_ok=True)
        self.old_registration=b'Legacy registration rollback fixture'
        (self.target/'register/index.html').write_bytes(self.old_registration)
        self.artifact=Path('/artifact')
        self.manifest=json.loads((self.artifact/'manifest.json').read_text())
        self.sha=self.manifest['sourceSha']
        # The previous release relied on SPA fallback and owned no cabinet HTML.
        for name in ['cabinet/index.html','cabinet/work/index.html']:
            (self.target/name).unlink()
        self.backups=self.parent/'backups'
        (self.parent/'auth').mkdir();(self.parent/'auth/index.html').write_text('Synthetic gateway login')
        password=Path('/tmp/test-web-password');password.write_text('synthetic-only')
        secret=Path('/tmp/test-web-session-secret');secret.write_text('synthetic-cookie-signing-only')
        config=gateway.GatewayConfig(static_root=Path('/srv/static'),login_index=Path('/srv/static/auth/index.html'),landing_root=Path('/srv/static/landing'),password_file=password,session_secret_file=secret,public_host='dev.astforum.ru')
        handler=gateway.create_handler(config)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        connection.request('POST','/auth/login',body='password=synthetic-only',headers={'Content-Type':'application/x-www-form-urlencoded'})
        response=connection.getresponse();self.assertEqual(response.status,303)
        self.cookie=response.getheader('Set-Cookie').split(';')[0];response.read();connection.close()
        self.before=inventory(self.target)
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def get(self,name):
        request=urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}/'+name,headers={'Cookie':self.cookie})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers['Cache-Control'],'no-store')
            return response.read()
    def registration_response(self,method='GET',path='/register'):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        connection.request(method,path,headers={'Cookie':self.cookie})
        response=connection.getresponse()
        result=(response.status,response.getheader('Location'),response.read())
        connection.close()
        return result
    def run_deploy(self,verify):
        return deploy(self.artifact,self.target,self.backups,source_sha=self.sha,expected_target=fingerprint(self.before),environment='dev',verifier=verify)
    def verify(self,_):
        self.assertFalse((self.target/'register/index.html').exists())
        for path in ['/register','/register/','/register/index.html']:
            for method in ['GET','HEAD']:
                self.assertEqual(self.registration_response(method,path),(303,'/login',b''))
        for name in self.manifest['files']:
            self.assertEqual(self.get(name),(self.artifact/'site'/name).read_bytes())
        self.assertEqual(self.get('assets/old-delayed.js'),b'old delayed fixture')
        self.assertEqual(self.get('profile/index.html'),b'retained profile fixture')
        self.assertEqual((self.target/'._legacy').read_bytes(),b'retained AppleDouble fixture')
        return {'actualReadOnlyDockerParentMountHTTP':'all artifact files matched'}
    def test_atomic_switch_real_served_files_then_subsequent_release(self):
        inode=self.target.stat().st_ino
        self.run_deploy(self.verify)
        self.assertNotEqual(self.target.stat().st_ino,inode)
        self.before=inventory(self.target)
        self.run_deploy(self.verify)
    def test_post_switch_failure_restores_previous_served_artifact_and_late_assets(self):
        def fail(report):self.verify(report);raise RuntimeError('forced post-switch failure')
        with self.assertRaisesRegex(RuntimeError,'forced'):self.run_deploy(fail)
        self.assertEqual(self.get('index.html'),self.old)
        self.assertEqual(self.registration_response(),(200,None,self.old_registration))
        for name,digest in self.before.items():self.assertEqual(inventory(self.target)[name],digest)
        for name in self.manifest['files']:
            if name.startswith(('web-assets/','web-media/')):self.assertEqual(self.get(name),(self.artifact/'site'/name).read_bytes())
    def test_shared_lock_rejects_cooperating_publisher_and_same_release(self):
        def verify(report):
            with self.assertRaisesRegex(RuntimeError,'busy'):self.run_deploy(self.verify)
            with self.assertRaisesRegex(RuntimeError,'busy'):
                publish(self.artifact/'site',self.target,self.backups,label='old-concurrent',pages={},assets={})
            with self.assertRaisesRegex(RuntimeError,'busy'):
                with site_lock(self.target):pass
            return self.verify(report)
        self.run_deploy(verify)
        with self.assertRaisesRegex(RuntimeError,'Unified web release'):
            publish(self.artifact/'site',self.target,self.backups,label='old',pages={},assets={})
    def test_target_drift_aborts_before_exchange(self):
        (self.target/'index.html').write_bytes(b'parallel publisher')
        with self.assertRaisesRegex(RuntimeError,'preflight drift'):self.run_deploy(self.verify)
        self.assertEqual(self.get('index.html'),b'parallel publisher')
    def test_conflicting_rollback_preserves_both_trees(self):
        def conflict(_):
            (self.target/'index.html').write_bytes(b'parallel bytes')
            raise RuntimeError('forced failure with concurrent publisher')
        with self.assertRaisesRegex(RuntimeError,'Rollback CAS conflict'):self.run_deploy(conflict)
        self.assertEqual(self.get('index.html'),b'parallel bytes')
        self.assertEqual(len(list(self.parent.glob('.web-prepared-*'))),1)
        self.assertEqual(len(list(self.backups.glob('*/rollback-conflicts.json'))),1)
    def test_explicit_successful_rollback_preserves_late_hashes_and_cookie(self):
        report=self.run_deploy(self.verify)
        def verify_old(_):
            self.assertEqual(self.get('index.html'),self.old)
            for name in ['cabinet/index.html','cabinet/work/index.html']:
                self.assertFalse((self.target/name).exists())
            self.assertEqual(self.registration_response(),(200,None,self.old_registration))
            for name in self.manifest['files']:
                if name.startswith(('web-assets/','web-media/')):self.assertEqual(self.get(name),(self.artifact/'site'/name).read_bytes())
            return {'oldGatewayCookieAndLateAssets':True}
        rollback(self.target,Path(report['backup']),self.backups,expected_target=fingerprint(inventory(self.target)),verifier=verify_old)
        self.assertFalse((self.target/'.web-release.json').exists())

    def test_explicit_rollback_verifier_failure_restores_current_release(self):
        report=self.run_deploy(self.verify)
        current=inventory(self.target)
        def fail(_):raise RuntimeError('forced rollback verifier')
        with self.assertRaisesRegex(RuntimeError,'forced rollback verifier'):
            rollback(self.target,Path(report['backup']),self.backups,expected_target=fingerprint(current),verifier=fail)
        self.assertEqual(inventory(self.target),current)
        self.verify({})
    def test_changed_artifact_bytes_and_extra_files_fail_closed(self):
        corrupt=self.parent/'corrupt'
        shutil.copytree(self.artifact,corrupt)
        (corrupt/'site/index.html').write_bytes(b'changed artifact bytes')
        with self.assertRaisesRegex(ValueError,'bytes/inventory'):validate_artifact(corrupt,self.sha,'dev')
        (corrupt/'secret.private.json').write_text('synthetic forbidden extra')
        with self.assertRaisesRegex(ValueError,'only manifest'):validate_artifact(corrupt,self.sha,'dev')

    def test_artifact_source_and_environment_rejected(self):
        with self.assertRaisesRegex(ValueError,'mismatch'):validate_artifact(self.artifact,'0'*40,'dev')
        with self.assertRaisesRegex(ValueError,'mismatch'):validate_artifact(self.artifact,self.sha,'production')

if __name__=='__main__':unittest.main(verbosity=2)
