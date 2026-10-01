from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlencode


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHECK_SCRIPT = PROJECT_ROOT / "scripts" / "check_origin_login.py"
sys.path.insert(0, str(PROJECT_ROOT / "tests"))

from test_auth_gateway import GatewayServer, load_gateway_module


class OriginLoginCheckTest(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        root = Path(self.workspace.name)
        self.static_root = root / "site"
        self.auth_root = self.static_root / "auth"
        self.landing_root = self.static_root / "landing"
        self.secrets_root = root / "secrets"
        self.auth_root.mkdir(parents=True)
        self.landing_root.mkdir(parents=True)
        self.secrets_root.mkdir(parents=True)
        (self.auth_root / "index.html").write_text("Введите пароль", encoding="utf-8")
        (self.landing_root / "index.html").write_text("Площадка для лендинга готова", encoding="utf-8")
        (self.static_root / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
        (self.static_root / "forum-logo-square.svg").write_text("<svg></svg>", encoding="utf-8")
        self.password_path = self.secrets_root / "password"
        self.session_path = self.secrets_root / "session"
        self.password_path.write_text("correct horse battery staple\n", encoding="utf-8")
        self.session_path.write_text("session-secret-for-tests\n", encoding="utf-8")

    def tearDown(self):
        self.workspace.cleanup()

    def make_handler(self):
        module = load_gateway_module()
        config = module.GatewayConfig(
            static_root=self.static_root,
            login_index=self.auth_root / "index.html",
            landing_root=self.landing_root,
            password_file=self.password_path,
            session_secret_file=self.session_path,
            public_host="dev.astforum.ru",
            cookie_name="forum_dev_auth",
            session_ttl_seconds=3600,
        )
        return module.create_handler(config)

    def test_origin_login_check_replays_secure_cookie_over_http_origin(self):
        with GatewayServer(self.make_handler()) as server:
            result = subprocess.run(
                [
                    sys.executable,
                    str(CHECK_SCRIPT),
                    f"http://127.0.0.1:{server.port}",
                    "dev.astforum.ru",
                    str(self.password_path),
                    "Площадка для лендинга готова",
                ],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_curl_cookie_jar_does_not_send_secure_cookie_over_http_origin(self):
        body = urlencode({"password": "correct horse battery staple"}).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        with GatewayServer(self.make_handler()) as server:
            status, response_headers, _ = server.request("POST", "/auth/login", body, headers)
            self.assertEqual(status, 303)
            self.assertIn("Secure", response_headers["set-cookie"])
            landing_status, _, landing_payload = server.request("GET", "/")

        self.assertEqual(landing_status, 200)
        self.assertIn("Введите пароль", landing_payload)
        self.assertNotIn("Площадка для лендинга готова", landing_payload)


if __name__ == "__main__":
    unittest.main()
