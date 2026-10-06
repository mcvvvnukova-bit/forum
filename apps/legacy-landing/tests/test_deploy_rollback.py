"""Execute deploy.sh locally; model bind mounts with pinned directory/file FDs.

Only root checks, ownership and Docker are shimmed. HTTP is real and the fixture
loads gateway code at recreation, so replacing host directories cannot silently
make an unrecreated gateway serve the restored tree.
"""
from __future__ import annotations

import importlib.util
import http.client
import json
import os
import pty
import select
import stat
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode


ROOT = Path(__file__).resolve().parents[1]
GATEWAY = (ROOT.parent / "dev-gateway/forum_dev_auth.py").read_text()


class MountedPath:
    """Path subset for the real gateway, resolved from a pinned directory FD."""
    def __init__(self, fd, name="."):
        self.fd, self.name = fd, name

    def __truediv__(self, name):
        return MountedPath(self.fd, str(Path(self.name) / name))

    def __str__(self):
        return self.name

    def exists(self):
        try:
            os.stat(self.name, dir_fd=self.fd)
            return True
        except FileNotFoundError:
            return False

    def is_file(self):
        return stat.S_ISREG(os.stat(self.name, dir_fd=self.fd).st_mode)

    def is_dir(self):
        return stat.S_ISDIR(os.stat(self.name, dir_fd=self.fd).st_mode)

    def read_bytes(self):
        fd = os.open(self.name, os.O_RDONLY, dir_fd=self.fd)
        try:
            return os.read(fd, 65536)
        finally:
            os.close(fd)


class MountedSecret:
    def __init__(self, fd):
        self.fd = fd

    def read_text(self, encoding):
        return os.pread(self.fd, 65536, 0).decode(encoding)



class Runtime:
    def __init__(self, root):
        self.root = root
        self.mounts = []
        self.gateway = None
        self.gateway_thread = None
        self.caddy = False
        self.fail_rollback = False
        self.fail_caddy_rollback = False
        self.caddy_starts = 0
        self.starts = 0
        self.unrelated = object()

    def close(self):
        if self.gateway:
            self.gateway.shutdown()
            self.gateway.server_close()
            self.gateway_thread.join()
        for fd in self.mounts:
            os.close(fd)
        self.mounts = []
        self.gateway = None

    def recreate(self):
        self.close()
        for path in ("dev-astforum", "dev-landing-auth", "secrets/dev_landing_password", "secrets/dev_landing_session_secret"):
            self.mounts.append(os.open(self.root / path, os.O_RDONLY))
        fd = os.open("forum_dev_auth.py", os.O_RDONLY, dir_fd=self.mounts[1])
        try:
            code = os.read(fd, 65536).decode()
        finally:
            os.close(fd)
        # Load the production gateway copied into the deployed mount.
        module_name = "rollback_gateway_" + str(id(self))
        module = importlib.util.module_from_spec(importlib.util.spec_from_loader(module_name, loader=None))
        sys.modules[module_name] = module
        exec(compile(code, "mounted/forum_dev_auth.py", "exec"), module.__dict__)
        config = module.GatewayConfig(
            static_root=MountedPath(self.mounts[0]),
            login_index=MountedPath(self.mounts[0], "auth/index.html"),
            landing_root=MountedPath(self.mounts[0], "landing"),
            password_file=MountedSecret(self.mounts[2]),
            session_secret_file=MountedSecret(self.mounts[3]),
            public_host="dev.astforum.ru",
        )
        handler = module.create_handler(config)
        handler.log_message = lambda *_: None
        self.gateway = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.gateway_thread = threading.Thread(target=self.gateway.serve_forever, daemon=True)
        self.gateway_thread.start()

    def command(self, args):
        if args[:3] == ["compose", "config", "--services"]:
            text = (self.root / "docker-compose.yml").read_text()
            return 0, "caddy\noutline\n" + ("dev_landing_auth\n" if "  dev_landing_auth:" in text else "")
        if args[:2] == ["compose", "up"]:
            if args[2:-1] != ["-d", "--no-deps", "--force-recreate"]:
                return 28, "recreation must preserve unrelated services"
            service = args[-1]
            if service == "dev_landing_auth":
                self.starts += 1
                if self.fail_rollback and self.starts > 1:
                    return 27, "fixture recreation failure"
                self.recreate()
            elif service == "caddy":
                self.caddy_starts += 1
                if self.fail_caddy_rollback and self.caddy_starts > 1:
                    return 27, "fixture Caddy recreation failure"
                self.caddy = (self.root / "Caddyfile").read_text()
            else:
                return 28, "unexpected service"
        elif args[:2] == ["compose", "rm"]:
            if args[2:-1] != ["-s", "-f"]:
                return 28, "gateway removal must stop and remove the service"
            if args[-1] != "dev_landing_auth":
                return 28, "unexpected removal"
            self.close()
        elif args[:2] not in (["compose", "config"], ["compose", "run"]):
            return 28, "unexpected Docker command"
        return 0, ""


class DeployRollbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.component = self.root / "component"
        self.bin = self.root / "bin"
        self.app.mkdir()
        self.bin.mkdir()
        for name in ("apps/legacy-landing/dist/site/auth", "apps/legacy-landing/dist/site/landing", "apps/dev-gateway", "scripts/verification", "scripts/deployment/legacy-landing"):
            (self.component / name).mkdir(parents=True)
        (self.component / "apps/legacy-landing/dist/site/auth/index.html").write_text("АСТ Форум — вход NEW")
        (self.component / "apps/legacy-landing/dist/site/landing/index.html").write_text("NEW LANDING")
        (self.component / "apps/legacy-landing/dist/site/robots.txt").write_text("Disallow: /")
        (self.component / "apps/dev-gateway/forum_dev_auth.py").write_text(GATEWAY)
        (self.component / "scripts/verification/check_origin_login.py").write_text("import sys\nsys.exit(19)\n")
        # The sole harness substitution relocates the fixed server directory.
        script = (ROOT.parents[1] / "scripts/deployment/legacy-landing/deploy.sh").read_text().replace("app_dir=/opt/outline", "app_dir=" + shlex.quote(str(self.app)), 1)
        self.script = self.component / "scripts/deployment/legacy-landing/deploy.sh"
        self.script.write_text(script)
        self.compose = "services:\n  caddy:\n    image: caddy\n  outline:\n    image: outline\nsecrets:\n  unrelated:\n    file: ./secrets/unrelated\n"
        self.caddy = ":80 {\n    respond 404\n}\n"
        (self.app / "docker-compose.yml").write_text(self.compose)
        (self.app / "Caddyfile").write_text(self.caddy)
        self.runtime = Runtime(self.app)
        runtime = self.runtime

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if self.path == "/command":
                    try:
                        code, output = runtime.command(json.loads(body))
                    except Exception as exc:
                        code, output = 29, type(exc).__name__
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps([code, output]).encode())
                else:
                    self.serve(parse_qs(body.decode()))

            def do_GET(self):
                if self.path in ("/_origin_health", "/_landing_health", "/robots.txt", "/api/demo-request"):
                    self.send_response(501 if self.path == "/api/demo-request" else 200)
                    self.end_headers()
                    self.wfile.write(b"Disallow: /" if self.path == "/robots.txt" else b"ok")
                else:
                    self.serve(None)

            def serve(self, form):
                if not runtime.gateway or not runtime.caddy:
                    self.send_response(503)
                    self.end_headers()
                    return
                connection = http.client.HTTPConnection("127.0.0.1", runtime.gateway.server_port)
                body = urlencode(form, doseq=True) if form is not None else None
                connection.request("POST" if form is not None else "GET", self.path, body, dict(self.headers))
                response = connection.getresponse()
                self.send_response_only(response.status)
                self.send_header("X-Caddy-Version", "old" if "# OLD CADDY" in runtime.caddy else "new")
                for key, value in response.getheaders():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(response.read())
                connection.close()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.write_shim("docker", f'''import json, urllib.request, sys
request = urllib.request.Request("http://127.0.0.1:{self.port}/command", data=json.dumps(sys.argv[1:]).encode())
code, output = json.load(urllib.request.urlopen(request))
print(output, end="")
sys.exit(code)
''')
        self.write_shim("id", 'print("0")\n')
        self.write_shim("chown", 'pass\n')
        curl = subprocess.check_output(["which", "curl"], text=True).strip()
        self.write_shim("curl", f'''import os, sys
args = [arg.replace("http://127.0.0.1", "http://127.0.0.1:{self.port}") if arg.startswith("http://127.0.0.1/") else arg for arg in sys.argv[1:]]
os.execv({curl!r}, ["curl", *args])
''')
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("DEV_LANDING_PASSWORD", None)

    def write_shim(self, name, code):
        path = self.bin / name
        path.write_text("#!" + sys.executable + "\n" + code)
        path.chmod(0o755)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.runtime.close()
        self.temp.cleanup()

    def previous(self, secrets=True):
        for name in ("dev-astforum/auth", "dev-astforum/landing", "dev-landing-auth", "secrets"):
            (self.app / name).mkdir(parents=True, exist_ok=True)
        (self.app / "dev-astforum/auth/index.html").write_text("OLD LOGIN")
        (self.app / "dev-astforum/landing/index.html").write_text("OLD LANDING")
        (self.app / "dev-landing-auth/forum_dev_auth.py").write_text(GATEWAY.replace('server_version = "ForumDevAuth"', 'server_version = "OldGateway"'))
        self.compose = self.compose.replace("secrets:\n", "  dev_landing_auth:\n    image: python\nsecrets:\n")
        (self.app / "docker-compose.yml").write_text(self.compose)
        self.caddy = ":80 {\n    # astforum-dev-landing:start\n    # OLD CADDY\n    @dev_astforum host dev.astforum.ru\n    # astforum-dev-landing:end\n    respond 404\n}\n"
        (self.app / "Caddyfile").write_text(self.caddy)
        if secrets:
            (self.app / "secrets/dev_landing_password").write_text("old-password\n")
            (self.app / "secrets/dev_landing_session_secret").write_text("old-session\n")
            (self.app / "secrets/dev_landing_password").chmod(0o600)
            (self.app / "secrets/dev_landing_session_secret").chmod(0o640)
            self.runtime.recreate()
            self.runtime.caddy = self.caddy

    def request(self, password=None, cookie=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port)
        headers = {"Cookie": cookie} if cookie else {}
        connection.request("POST" if password is not None else "GET", "/auth/login" if password is not None else "/", urlencode({"password": password}) if password is not None else None, headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read().decode()
        connection.close()
        return result

    def deploy(self, password=None):
        if password is None:
            result = subprocess.run(["sh", str(self.script)], env=self.env, capture_output=True, text=True, timeout=20)
            output = result.stdout + result.stderr
            code = result.returncode
        else:
            master, slave = pty.openpty()
            process = subprocess.Popen(["sh", str(self.script), "--set-password"], env=self.env, stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            os.close(slave)
            output = ""
            deadline = time.monotonic() + 10
            while "Shared dev landing password:" not in output:
                self.assertLess(time.monotonic(), deadline)
                if select.select([process.stderr], [], [], 0.2)[0]:
                    output += os.read(process.stderr.fileno(), 4096).decode()
            # Wait until stty disabled echo before supplying terminal input.
            import termios
            while termios.tcgetattr(master)[3] & termios.ECHO:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            os.write(master, (password + "\n").encode())
            stdout, stderr = process.communicate(timeout=20)
            output += stdout.decode() + stderr.decode()
            code = process.returncode
            os.close(master)
        self.assertNotEqual(code, 0, output)
        self.assertIn("Checking origin correct-password flow", output)
        for value in ("old-password", "replacement-password", "old-session"):
            self.assertNotIn(value, output)
        self.assertEqual((self.app / "docker-compose.yml").read_text(), self.compose)
        self.assertEqual((self.app / "Caddyfile").read_text(), self.caddy)
        return output

    def test_late_failure_restores_served_gateway_site_and_set_password(self):
        self.previous()
        unrelated = self.runtime.unrelated
        old_cookie = self.request(password="old-password")[1]["Set-Cookie"].split(";", 1)[0]
        self.deploy("replacement-password")
        self.assertIs(self.runtime.unrelated, unrelated)
        self.assertEqual(self.request()[2], "OLD LOGIN")
        status, headers, body = self.request(cookie=old_cookie)
        self.assertEqual((status, headers.get("Server", "").strip(), body), (200, "OldGateway", "OLD LANDING"))
        self.assertEqual(headers["X-Caddy-Version"], "old")
        restored_cookie = self.request(password="old-password")[1]["Set-Cookie"].split(";", 1)[0]
        self.assertEqual(self.request(cookie=restored_cookie)[2], "OLD LANDING")
        self.assertIn("Max-Age=0", self.request(password="replacement-password")[1]["Set-Cookie"])
        self.assertTrue((self.app / "secrets/dev_landing_password").read_bytes() == b"old-password\n", "previous password bytes were not restored")
        self.assertTrue((self.app / "secrets/dev_landing_session_secret").read_bytes() == b"old-session\n", "previous session secret bytes were not restored")
        self.assertEqual((self.app / "secrets/dev_landing_password").stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.app / "secrets/dev_landing_session_secret").stat().st_mode & 0o777, 0o640)

    def test_first_deployment_failure_removes_gateway_and_generated_state(self):
        unrelated = self.runtime.unrelated
        self.deploy()
        self.assertIsNone(self.runtime.gateway)
        self.assertIs(self.runtime.unrelated, unrelated)
        for name in ("dev-astforum", "dev-landing-auth", "secrets/dev_landing_password", "secrets/dev_landing_session_secret"):
            self.assertFalse((self.app / name).exists(), name)
        self.assertEqual(self.request()[0], 503)

    def test_existing_deployment_missing_secrets_rolls_back_generated_files(self):
        self.previous(secrets=False)
        self.deploy()
        self.assertEqual((self.app / "dev-astforum/landing/index.html").read_text(), "OLD LANDING")
        for name in ("dev_landing_password", "dev_landing_session_secret"):
            self.assertFalse((self.app / "secrets" / name).exists())

    def test_failed_gateway_restoration_is_reported_as_rollback_failure(self):
        self.previous()
        self.runtime.fail_rollback = True
        output = self.deploy()
        self.assertIn("Rollback failed", output)
        self.assertNotIn("restored successfully", output)

    def test_first_deployment_set_password_failure_removes_new_secret(self):
        self.deploy("replacement-password")
        self.assertIsNone(self.runtime.gateway)
        self.assertFalse((self.app / "secrets/dev_landing_password").exists())
        self.assertFalse((self.app / "secrets/dev_landing_session_secret").exists())

    def test_empty_previous_secrets_restore_existence_bytes_and_modes(self):
        self.previous(secrets=False)
        for name in ("dev_landing_password", "dev_landing_session_secret"):
            path = self.app / "secrets" / name
            path.write_bytes(b"")
            path.chmod(0o640)
        self.deploy()
        for name in ("dev_landing_password", "dev_landing_session_secret"):
            path = self.app / "secrets" / name
            self.assertEqual(path.stat().st_size, 0)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_failed_caddy_restoration_is_reported_as_rollback_failure(self):
        self.previous()
        self.runtime.fail_caddy_rollback = True
        output = self.deploy()
        self.assertIn("Rollback failed", output)
        self.assertEqual(self.request()[1]["X-Caddy-Version"], "new")

    def reject_unsafe_secret(self, name, kind, set_password=False):
        self.previous()
        path = self.app / "secrets" / name
        path.unlink()
        referent = self.root / "server-owned-secret"
        if kind == "symlink":
            referent.write_bytes(b"previous fixture secret\n")
            referent.chmod(0o640)
            path.symlink_to(referent)
        elif kind == "broken-symlink":
            path.symlink_to(referent)
        elif kind == "directory":
            path.mkdir()
        else:
            raise AssertionError("unknown secret fixture kind")

        def snapshot(root):
            # lstat also captures broken links; bytes stay out of failure output.
            result = {}
            for item in (root, *sorted(root.rglob("*"))):
                info = item.lstat()
                payload = os.readlink(item) if item.is_symlink() else item.read_bytes() if item.is_file() else None
                result[str(item.relative_to(root))] = (info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_mtime_ns, payload)
            return result

        before = snapshot(self.app)
        referent_before = referent.read_bytes() if referent.exists() else None
        gateway = self.runtime.gateway
        env = dict(self.env, DEV_LANDING_PASSWORD="replacement-password")
        if set_password:
            master, slave = pty.openpty()
            process = subprocess.Popen(["sh", str(self.script), "--set-password"], env=env, stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            os.close(slave)
            output = ""
            deadline = time.monotonic() + 10
            try:
                while process.poll() is None and "Shared dev landing password:" not in output:
                    self.assertLess(time.monotonic(), deadline)
                    if select.select([process.stderr], [], [], 0.2)[0]:
                        output += os.read(process.stderr.fileno(), 4096).decode()
                if "Shared dev landing password:" in output:
                    import termios
                    while termios.tcgetattr(master)[3] & termios.ECHO:
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(0.01)
                    os.write(master, b"replacement-password\n")
                stdout, stderr = process.communicate(timeout=20)
                output += stdout.decode() + stderr.decode()
                code = process.returncode
            finally:
                os.close(master)
        else:
            result = subprocess.run(["sh", str(self.script)], env=env, capture_output=True, text=True, timeout=20)
            output = result.stdout + result.stderr
            code = result.returncode
        self.assertNotEqual(code, 0)
        self.assertTrue((referent.read_bytes() if referent.exists() else None) == referent_before, "unsafe secret path changed its referent")
        self.assertTrue(snapshot(self.app) == before, "unsafe secret path changed deployment files or metadata")
        self.assertIs(self.runtime.gateway, gateway)
        self.assertEqual((self.runtime.starts, self.runtime.caddy_starts), (0, 0))
        self.assertIn("Secret path must be a regular file", output)
        self.assertIn(str(path), output)
        self.assertNotIn("replacement-password", output)
        self.assertNotIn("previous fixture secret", output)
        self.assertEqual(self.request()[2], "OLD LOGIN")
        self.assertFalse((self.app / "backups").exists())

    def test_symlink_password_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_password", "symlink")

    def test_symlink_session_secret_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_session_secret", "symlink")

    def test_broken_symlink_password_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_password", "broken-symlink")

    def test_broken_symlink_session_secret_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_session_secret", "broken-symlink")

    def test_directory_password_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_password", "directory")

    def test_directory_session_secret_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_session_secret", "directory")

    def test_symlink_password_set_password_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_password", "symlink", set_password=True)

    def test_broken_session_link_set_password_is_rejected_before_deployment_mutation(self):
        self.reject_unsafe_secret("dev_landing_session_secret", "broken-symlink", set_password=True)


if __name__ == "__main__":
    unittest.main()
