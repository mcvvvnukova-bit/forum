"""Public deployment contracts; no credentials or invitation emails are used."""

import json
import unittest
import urllib.parse
import urllib.request

BASE = "https://vks.mvpspace.ru"


def fetch(path):
    request = urllib.request.Request(BASE + path, headers={"User-Agent": "PROJ-213-deployment-check"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.status, urllib.parse.urlsplit(response.url), response.read().decode()


class PublicDeploymentTest(unittest.TestCase):
    def test_portal_assets_are_actual_stylesheets_and_scripts(self):
        _, _, body = fetch("/admin/build/entrypoints.json")
        app = json.loads(body)["entrypoints"]["app"]
        paths = set(app["js"] + app["css"])
        self.assertGreater(len(paths), 1, "No portal assets found in the pinned bundle manifest")
        for path in paths:
            with self.subTest(path=path):
                with urllib.request.urlopen(BASE + path, timeout=25) as response:
                    expected = "css" if path.endswith(".css") else "javascript"
                    self.assertIn(expected, response.headers.get("Content-Type", ""))
                    self.assertNotIn(b"<html", response.read(500).lower())

    def test_keycloak_discovery_uses_the_approved_prefix(self):
        status, url, body = fetch("/admin/auth/realms/vks/.well-known/openid-configuration")
        self.assertEqual(status, 200)
        self.assertTrue(body.lstrip().startswith("{"), "Identity discovery still resolves to a meeting page")
        data = json.loads(body)
        self.assertEqual(data["issuer"], BASE + "/admin/auth/realms/vks")
        self.assertEqual(urllib.parse.urlsplit(data["authorization_endpoint"]).netloc, "vks.mvpspace.ru")
        self.assertEqual(url.path, "/admin/auth/realms/vks/.well-known/openid-configuration")

    def test_portal_login_stays_under_admin(self):
        status, url, body = fetch("/admin/login")
        self.assertEqual(status, 200)
        self.assertEqual(url.netloc, "vks.mvpspace.ru")
        self.assertTrue(url.path.startswith("/admin/auth/"), "Portal login did not reach its identity provider")
        self.assertIn('name="username"', body)
        self.assertIn('name="password"', body)
        self.assertNotIn('name="firstName"', body)

    def test_unrelated_callback_state_cannot_open_a_staff_session(self):
        status, url, body = fetch("/admin/login/keycloak_login/check?code=invalid&state=unrelated")
        self.assertEqual(status, 200)
        self.assertTrue(url.path.startswith("/admin/auth/"))
        self.assertIn('name="username"', body)
        self.assertNotIn("jwt=", urllib.parse.urlunsplit(url))

    def test_existing_meeting_homepage_is_preserved(self):
        status, url, body = fetch("/")
        self.assertEqual(status, 200)
        self.assertEqual(url.path, "/")
        self.assertIn("Jitsi Meet", body)
        self.assertIn("config.js", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
