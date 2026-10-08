from __future__ import annotations

import http.client
import contextlib
import io
import importlib.util
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_PATH = PROJECT_ROOT.parent / "dev-gateway" / "forum_dev_auth.py"


def load_gateway_module():
    spec = importlib.util.spec_from_file_location("forum_dev_auth", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GatewayServer:
    def __init__(self, handler):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    @property
    def port(self):
        return self.server.server_address[1]

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read().decode("utf-8")
        headers = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, headers, payload


class AuthGatewayTest(unittest.TestCase):
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
        (self.landing_root / "index.html").write_text(
            "Одна площадка для всех участников стройки", encoding="utf-8"
        )
        (self.static_root / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
        (self.static_root / "forum-logo-square.svg").write_text("<svg></svg>", encoding="utf-8")
        self.password_path = self.secrets_root / "password"
        self.session_path = self.secrets_root / "session"
        self.password_path.write_text("correct horse battery staple\n", encoding="utf-8")
        self.session_path.write_text("session-secret-for-tests\n", encoding="utf-8")

    def tearDown(self):
        self.workspace.cleanup()

    def make_handler(self, api_origin=None):
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
            api_origin=api_origin,
        )
        return module.create_handler(config)

    def test_unauthenticated_root_request_returns_password_screen(self):
        with GatewayServer(self.make_handler()) as server:
            status, headers, payload = server.request("GET", "/")

        self.assertEqual(status, 200)
        self.assertIn("Введите пароль", payload)
        self.assertNotIn("Одна площадка для всех участников стройки", payload)
        self.assertIn("no-store", headers["cache-control"])
        self.assertEqual(headers["x-robots-tag"], "noindex, nofollow, noarchive")

    def test_unauthenticated_head_request_returns_password_screen_headers_without_body(self):
        with GatewayServer(self.make_handler()) as server:
            status, headers, payload = server.request("HEAD", "/")

        self.assertEqual(status, 200)
        self.assertEqual(payload, "")
        self.assertIn("no-store", headers["cache-control"])
        self.assertEqual(headers["x-robots-tag"], "noindex, nofollow, noarchive")
        self.assertEqual(headers["content-type"], "text/html")

    def test_retired_registration_redirects_to_login_and_rollback_restores_legacy_page(self):
        (self.landing_root / 'login').mkdir()
        (self.landing_root / 'login/index.html').write_text('Canonical login')
        with GatewayServer(self.make_handler()) as server:
            _, response_headers, _ = server.request('POST', '/auth/login',
                urlencode({'password': 'correct horse battery staple'}),
                {'Content-Type': 'application/x-www-form-urlencoded'})
            cookie = response_headers['set-cookie'].split(';', 1)[0]
            for path in ['/register', '/register/', '/register/index.html']:
                for method in ['GET', 'HEAD']:
                    with self.subTest(path=path, method=method):
                        status, headers, body = server.request(method,
                            path+'?auth_error=account_deactivated&returnTo=https://outside.invalid&intent=register',
                            headers={'Cookie': cookie})
                        self.assertEqual(status, 303)
                        self.assertEqual(headers['location'], '/login?auth_error=account_deactivated')
                        self.assertEqual(headers['cache-control'], 'no-store')
                        self.assertEqual(body, '')
                status, headers, _ = server.request('GET', path, headers={'Cookie': cookie})
                self.assertEqual(status, 303)
                self.assertEqual(headers['location'], '/login')
            (self.landing_root / 'register').mkdir()
            (self.landing_root / 'register/index.html').write_text('Legacy rollback page')
            status, _, body = server.request('GET', '/register', headers={'Cookie': cookie})
            self.assertEqual(status, 200)
            self.assertEqual(body, 'Legacy rollback page')

    def test_wrong_password_redirects_back_to_password_screen_without_session_cookie(self):
        body = urlencode({"password": "wrong"}).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        with GatewayServer(self.make_handler()) as server:
            status, response_headers, _ = server.request("POST", "/auth/login", body, headers)
            redirected_status, _, redirected_payload = server.request("GET", response_headers["location"])

        self.assertEqual(status, 303)
        self.assertEqual(response_headers["location"], "/?error=1")
        self.assertIn("Max-Age=0", response_headers["set-cookie"])
        self.assertEqual(redirected_status, 200)
        self.assertIn("Введите пароль", redirected_payload)
        self.assertNotIn("Одна площадка для всех участников стройки", redirected_payload)

    def test_correct_password_sets_secure_session_cookie_and_allows_landing_page(self):
        body = urlencode({"password": "correct horse battery staple"}).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        with GatewayServer(self.make_handler()) as server:
            status, response_headers, _ = server.request("POST", "/auth/login", body, headers)
            cookie = response_headers["set-cookie"].split(";", 1)[0]
            landing_status, landing_headers, landing_payload = server.request("GET", "/", headers={"Cookie": cookie})

        self.assertEqual(status, 303)
        self.assertEqual(response_headers["location"], "/")
        self.assertIn("HttpOnly", response_headers["set-cookie"])
        self.assertIn("Secure", response_headers["set-cookie"])
        self.assertIn("SameSite=Lax", response_headers["set-cookie"])
        self.assertEqual(landing_status, 200)
        self.assertIn("Одна площадка для всех участников стройки", landing_payload)
        self.assertEqual(landing_headers["x-robots-tag"], "noindex, nofollow, noarchive")

    def test_tampered_session_cookie_does_not_open_landing_page(self):
        headers = {"Cookie": "forum_dev_auth=123.invalid-signature"}

        with GatewayServer(self.make_handler()) as server:
            status, _, payload = server.request("GET", "/", headers=headers)

        self.assertEqual(status, 200)
        self.assertIn("Введите пароль", payload)
        self.assertNotIn("Одна площадка для всех участников стройки", payload)

    def test_health_and_reserved_demo_endpoint_are_available_without_authentication(self):
        with GatewayServer(self.make_handler()) as server:
            health_status, _, health_payload = server.request("GET", "/_landing_health")
            demo_status, _, demo_payload = server.request("GET", "/api/demo-request")

        self.assertEqual(health_status, 200)
        self.assertEqual(health_payload, "ok")
        self.assertEqual(demo_status, 501)
        self.assertIn("Bitrix24", demo_payload)

    def test_csp_permits_only_the_self_hosted_cal_diy_embed_origin(self):
        with GatewayServer(self.make_handler()) as server:
            _, headers, _ = server.request("GET", "/")

        csp = headers["content-security-policy"]
        self.assertIn("default-src 'self'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertIn("script-src 'self' https://cal.astforum.ru", csp)
        self.assertIn("frame-src 'self' https://cal.astforum.ru", csp)
        self.assertIn("connect-src 'self' https://cal.astforum.ru", csp)

    def test_sber_routes_without_an_api_return_unavailable_instead_of_the_password_screen(self):
        with GatewayServer(self.make_handler()) as server:
            status, _, payload = server.request("GET", "/auth/sber-id/start?intent=login")
        self.assertEqual(status, 503)
        self.assertIn("sber_unavailable", payload)

    def test_profile_proxy_forwards_only_the_cookie_and_denies_dev_password_only(self):
        requests = []
        class ApiHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                cookie = self.headers.get("Cookie", "")
                requests.append((self.path, cookie))
                authenticated = "forum_session=opaque" in cookie
                self.send_response(200 if authenticated else 401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"userId":"owner","profile":{}}' if authenticated else b'{"code":"unauthorized"}')
            def log_message(self, *_):
                pass
        with GatewayServer(ApiHandler) as api:
            with GatewayServer(self.make_handler(f"http://127.0.0.1:{api.port}")) as gateway:
                for cookie, status in [("forum_dev_auth=synthetic",401),("forum_session=opaque",200)]:
                    connection = http.client.HTTPConnection("127.0.0.1", gateway.port)
                    try:
                        connection.request("GET","/api/profile",headers={"Cookie":cookie,"Accept":"application/json"})
                        response = connection.getresponse()
                        self.assertEqual(response.status,status)
                        self.assertEqual(response.getheader("Cache-Control"),"no-store")
                        response.read()
                    finally:
                        connection.close()
        self.assertEqual(requests,[("/api/profile","forum_dev_auth=synthetic"),("/api/profile","forum_session=opaque")])

    def test_api_proxy_preserves_cookies_and_redirects_without_logging_auth_codes(self):
        requests = []

        class ApiHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Cookie")))
                self.send_response(303)
                self.send_header("Location", "/?auth=success")
                self.send_header("Set-Cookie", "forum_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/")
                self.send_header("Set-Cookie", "sber_attempt=; Max-Age=0; Path=/")
                self.end_headers()

            def log_message(self, *_):
                pass

        logs = io.StringIO()
        callback_paths = ["/auth/sber-id/callback", "/authorization"]
        with contextlib.redirect_stdout(logs), GatewayServer(ApiHandler) as api:
            with GatewayServer(self.make_handler(f"http://127.0.0.1:{api.port}")) as gateway:
                for path in callback_paths:
                    with self.subTest(callback=path):
                        connection = http.client.HTTPConnection("127.0.0.1", gateway.port)
                        try:
                            connection.request("GET", f"{path}?code=private-code&state=state", headers={"Cookie": "sber_attempt=browser"})
                            response = connection.getresponse()
                            headers = response.getheaders()
                            response.read()
                            self.assertEqual(response.status, 303)
                            self.assertEqual(len([value for key, value in headers if key.lower() == "set-cookie"]), 2)
                            self.assertIn(("Location", "/?auth=success"), headers)
                            self.assertIn(("Referrer-Policy", "no-referrer"), headers)
                        finally:
                            connection.close()
        self.assertEqual(requests, [(f"{path}?code=private-code&state=state", "sber_attempt=browser") for path in callback_paths])
        self.assertNotIn("private-code", logs.getvalue())
        self.assertNotIn("sber_attempt=browser", logs.getvalue())


if __name__ == "__main__":
    unittest.main()
