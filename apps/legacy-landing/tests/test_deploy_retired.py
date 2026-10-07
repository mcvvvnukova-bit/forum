"""Run the real retired entrypoint against synthetic targets, never a live host.

Catches re-enabled deployment/password mutation, marker-only preflight races,
and deletion of the permanent lock inode while another publisher owns it.
The historical rollback fixture supplies temp paths and Docker/root shims only.
"""
import fcntl
import os
from pathlib import Path
import pty
import select
import shlex
import subprocess
import sys
import time
import unittest

import test_deploy_rollback as historical

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'scripts/deployment'))
from public_site import site_lock


class RetiredDeployTest(unittest.TestCase):
    def setUp(self):
        self.fixture = historical.DeployRollbackTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.previous()
        # Always run the complete real entrypoint, never the historical payload
        # which the rollback fixture may extract for its own archaeology tests.
        source = (REPO / 'scripts/deployment/legacy-landing/deploy.sh').read_text()
        self.fixture.script.write_text(source.replace('app_dir=/opt/outline',
            'app_dir=' + shlex.quote(str(self.fixture.app)), 1))
        (self.fixture.component / 'scripts/verification/check_origin_login.py').write_text('import sys\nsys.exit(0)\n')
        self.landing = self.fixture.app / 'dev-astforum/landing'
        (self.landing / 'web-assets').mkdir()
        (self.landing / 'web-assets/current.js').write_text('retained immutable bytes')
        self.marker = self.landing / '.web-release.json'
        self.lock = self.landing.parent / '.landing.public-site.lock'

    def snapshot(self):
        root = self.fixture.app
        return {str(p.relative_to(root)): (p.lstat().st_ino, p.lstat().st_mode,
                    p.lstat().st_uid, p.lstat().st_gid, p.lstat().st_mtime_ns,
                    p.read_bytes() if p.is_file() else None)
                for p in (root, *sorted(root.rglob('*')))}

    def refuse(self, args=(), first_owner=False):
        master, slave = pty.openpty()
        ready_r, ready_w = os.pipe()
        resume_r, resume_w = os.pipe()
        # A deterministic caller preflight sees no owner. Publication acquires
        # the real common lock and establishes ownership before the invocation
        # resumes. Retirement has no script-side preflight/mutation window.
        prefix = ''
        if first_owner:
            prefix = (f'test ! -e {shlex.quote(str(self.marker))} || exit 91; '
                      f'printf ready >&{ready_w}; read -r resume <&{resume_r}; ')
        command = prefix + 'exec /bin/sh ' + shlex.quote(str(self.fixture.script)) + ' "$@"'
        before = self.snapshot()
        proc = subprocess.Popen(['/bin/sh', '-c', command, 'retirement-test', *args],
            env=dict(self.fixture.env, DEV_LANDING_PASSWORD='synthetic-never-write'),
            stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            pass_fds=(ready_w, resume_r))
        os.close(slave)
        os.close(ready_w)
        os.close(resume_r)
        try:
            if first_owner:
                self.assertTrue(select.select([ready_r], [], [], 5)[0], 'preflight did not complete')
                self.assertEqual(os.read(ready_r, 5), b'ready')
                self.marker.write_text('{"sourceSha":"synthetic-first-unified-owner"}')
                before = self.snapshot()
            if first_owner:
                os.write(resume_w, b'continue\n')
            # A TTY is deliberately supplied so --set-password cannot pass just
            # because the old script rejected noninteractive stdin. Never send
            # password input; an attempted prompt must fail this test.
            output = b''
            deadline = time.monotonic() + 15
            while proc.poll() is None:
                self.assertLess(time.monotonic(), deadline, 'entrypoint did not refuse promptly')
                if select.select([proc.stderr], [], [], 2)[0]:
                    output += os.read(proc.stderr.fileno(), 4096)
                if b'Shared dev landing password:' in output:
                    proc.kill()
                    break
            stdout, stderr = proc.communicate(timeout=10)
            output += stdout + stderr
            self.assertNotIn(b'Shared dev landing password:', output)
            self.assertNotEqual(proc.returncode, 0, output.decode())
            self.assertIn(b'retired', output.lower())
            self.assertTrue(self.snapshot() == before, 'site/config/auth/secret/backup bytes or metadata changed')
            self.assertEqual((self.fixture.runtime.starts, self.fixture.runtime.caddy_starts), (0, 0))
            self.assertFalse((self.fixture.app / 'backups').exists())
            self.assertNotIn(b'synthetic-never-write', output)
            # A new opener must still see the SAME locked inode, not a freshly
            # created lock after a destructive parent-directory replacement.
            with self.lock.open('r+') as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.communicate()
            for fd in (master, ready_r, resume_w):
                os.close(fd)

    def test_unified_owner_refuses_deploy_and_password_without_mutation(self):
        self.marker.write_text('{"sourceSha":"synthetic-current-unified"}')
        with site_lock(self.landing):
            for args in ((), ('--set-password',)):
                with self.subTest(args=args):
                    self.refuse(args)

    def test_marker_absence_does_not_reenable_deploy_or_password(self):
        with site_lock(self.landing):
            for args in ((), ('--set-password',)):
                with self.subTest(args=args):
                    self.refuse(args)

    def test_first_owner_after_preflight_cannot_race_legacy_mutation(self):
        with site_lock(self.landing):
            for args in ((), ('--set-password',)):
                with self.subTest(args=args):
                    self.marker.unlink(missing_ok=True)
                    self.refuse(args, first_owner=True)


if __name__ == '__main__':
    unittest.main()
