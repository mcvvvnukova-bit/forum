from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import mimetypes
import os
import posixpath
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlencode, urlsplit


@dataclass(frozen=True)
class GatewayConfig:
    static_root: Path
    login_index: Path
    landing_root: Path
    password_file: Path
    session_secret_file: Path
    public_host: str
    cookie_name: str = "forum_dev_auth"
    session_ttl_seconds: int = 86400
    api_origin: str | None = None

    @classmethod
    def from_env(cls) -> "GatewayConfig":
        static_root = Path(os.environ.get("STATIC_ROOT", "/srv/dev-astforum"))
        return cls(
            static_root=static_root,
            login_index=Path(os.environ.get("LOGIN_INDEX", str(static_root / "auth" / "index.html"))),
            landing_root=Path(os.environ.get("LANDING_ROOT", str(static_root / "landing"))),
            password_file=Path(os.environ.get("PASSWORD_FILE", "/run/secrets/dev_landing_password")),
            session_secret_file=Path(os.environ.get("SESSION_SECRET_FILE", "/run/secrets/dev_landing_session_secret")),
            public_host=os.environ.get("PUBLIC_HOST", "dev.astforum.ru"),
            cookie_name=os.environ.get("COOKIE_NAME", "forum_dev_auth"),
            session_ttl_seconds=int(os.environ.get("SESSION_TTL_SECONDS", "86400")),
            api_origin=os.environ.get("FORUM_API_ORIGIN") or None,
        )


def create_handler(config: GatewayConfig) -> type[BaseHTTPRequestHandler]:
    class ForumDevAuthHandler(BaseHTTPRequestHandler):
        server_version = "ForumDevAuth"
        sys_version = ""

        def do_GET(self) -> None:
            self._handle_get(send_body=True)

        def do_HEAD(self) -> None:
            self._handle_get(send_body=False)

        def _handle_get(self, *, send_body: bool) -> None:
            path = urlsplit(self.path).path

            if path in {"/auth/sber-id/start", "/auth/sber-id/callback", "/authorization", "/api/auth/session", "/api/profile"}:
                self._proxy_api(send_body=send_body)
                return

            if path == "/_landing_health":
                self._send_text(HTTPStatus.OK, "ok", send_body=send_body)
                return

            if path == "/api/demo-request":
                self._send_text(
                    HTTPStatus.NOT_IMPLEMENTED,
                    "Demo request endpoint is reserved for the Bitrix24 integration service.",
                    send_body=send_body,
                )
                return

            if path == "/robots.txt":
                self._serve_public_file(config.static_root / "robots.txt", send_body=send_body)
                return

            if path.startswith("/auth-assets/"):
                self._serve_public_file(config.login_index.parent / path.removeprefix("/"), send_body=send_body)
                return

            if path in {"/favicon.png", "/forum-logo-square.svg"}:
                self._serve_public_file(config.static_root / path.removeprefix("/"), send_body=send_body)
                return

            if not self._is_authenticated():
                self._serve_login(send_body=send_body)
                return

            self._serve_landing(path, send_body=send_body)

        def do_POST(self) -> None:
            path = urlsplit(self.path).path

            if path == "/api/auth/logout":
                self._proxy_api(send_body=True)
                return

            if path == "/auth/login":
                self._handle_login()
                return

            if path == "/auth/logout":
                self._redirect("/", clear_cookie=True)
                return

            self._send_text(HTTPStatus.NOT_FOUND, "Not found")

        def log_message(self, format: str, *args: object) -> None:
            print("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))

        def log_request(self, code="-", size="-") -> None:
            self.log_message('"%s %s" %s %s', self.command, urlsplit(self.path).path, code, size)

        def _proxy_api(self, *, send_body: bool) -> None:
            if not config.api_origin:
                if "text/html" in self.headers.get("Accept", ""):
                    self._redirect("/?auth_error=sber_unavailable")
                else:
                    self._send_text(HTTPStatus.SERVICE_UNAVAILABLE, '{"code":"sber_unavailable"}', send_body=send_body)
                return

            origin = urlsplit(config.api_origin)
            if origin.scheme not in {"http", "https"} or not origin.hostname or origin.username or origin.password or origin.path not in {"", "/"}:
                self._send_text(HTTPStatus.SERVICE_UNAVAILABLE, "Invalid API configuration", send_body=send_body)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 4096 or self.headers.get("Transfer-Encoding"):
                    self._send_text(HTTPStatus.BAD_REQUEST, "Invalid request body", send_body=send_body)
                    return
            except ValueError:
                self._send_text(HTTPStatus.BAD_REQUEST, "Invalid request body", send_body=send_body)
                return
            connection_type = http.client.HTTPSConnection if origin.scheme == "https" else http.client.HTTPConnection
            connection = connection_type(origin.hostname, origin.port, timeout=45)
            headers = {key: self.headers[key] for key in ("Cookie", "Origin", "Accept", "Content-Type") if key in self.headers}
            headers["X-Forwarded-For"] = self.client_address[0]
            try:
                connection.request(self.command, self.path, body=self.rfile.read(length) if length else None, headers=headers)
                response = connection.getresponse()
                payload = response.read(65537)
                if len(payload) > 65536:
                    raise ValueError("Oversized API response")
                self.send_response(response.status)
                for key, value in response.getheaders():
                    if key.lower() in {"set-cookie", "location", "content-type", "retry-after"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                if send_body:
                    self.wfile.write(payload)
            except (OSError, ValueError, http.client.HTTPException):
                if "text/html" in self.headers.get("Accept", ""):
                    self._redirect("/?auth_error=temporarily_unavailable")
                else:
                    self._send_text(HTTPStatus.BAD_GATEWAY, '{"code":"temporarily_unavailable"}', send_body=send_body)
            finally:
                connection.close()

        def _handle_login(self) -> None:
            password = self._read_form_password()
            expected_password = _read_secret(config.password_file)

            if hmac.compare_digest(password, expected_password):
                self._redirect("/", session_cookie=self._make_session_cookie())
                return

            self._redirect("/?error=1", clear_cookie=True)

        def _read_form_password(self) -> str:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(min(content_length, 4096)).decode("utf-8", errors="replace")
            fields = parse_qs(body, keep_blank_values=True)
            return fields.get("password", [""])[0]

        def _is_authenticated(self) -> bool:
            cookie_header = self.headers.get("Cookie", "")
            cookie = SimpleCookie(cookie_header)
            morsel = cookie.get(config.cookie_name)
            if morsel is None:
                return False

            try:
                expires_raw, signature = morsel.value.split(".", 1)
                expires = int(expires_raw)
            except ValueError:
                return False

            if expires <= int(time.time()):
                return False

            expected_signature = _sign(expires_raw, _read_secret(config.session_secret_file))
            return hmac.compare_digest(signature, expected_signature)

        def _make_session_cookie(self) -> str:
            expires = str(int(time.time()) + config.session_ttl_seconds)
            return f"{expires}.{_sign(expires, _read_secret(config.session_secret_file))}"

        def _redirect(self, location: str, *, session_cookie: str | None = None, clear_cookie: bool = False) -> None:
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", location)
            self._send_security_headers(cache_control="no-store")

            if session_cookie is not None:
                self.send_header(
                    "Set-Cookie",
                    _cookie_header(config.cookie_name, session_cookie, config.session_ttl_seconds),
                )
            elif clear_cookie:
                self.send_header("Set-Cookie", _cookie_header(config.cookie_name, "", 0))

            self.end_headers()

        def _serve_login(self, *, send_body: bool = True) -> None:
            self._serve_file(config.login_index, cache_control="no-store", send_body=send_body)

        def _serve_landing(self, request_path: str, *, send_body: bool = True) -> None:
            # File ownership switches atomically with the web release. An older
            # rollback that restores register/index.html keeps its old routing.
            if (request_path.rstrip('/') in {'/register', '/register/index.html'}
                    and (config.landing_root / 'login/index.html').is_file()
                    and not (config.landing_root / 'register/index.html').exists()):
                error = parse_qs(urlsplit(self.path).query).get('auth_error', [''])[0]
                self._redirect('/login' + ('?' + urlencode({'auth_error': error}) if error else ''))
                return
            target = _safe_static_target(config.landing_root, request_path)
            if target is None:
                target = config.landing_root / "index.html"

            if target.is_dir():
                target = target / "index.html"

            if not target.exists() or not target.is_file():
                target = config.landing_root / "index.html"

            self._serve_file(target, cache_control="no-store", send_body=send_body)

        def _serve_public_file(self, target: Path, *, send_body: bool = True) -> None:
            self._serve_file(target, cache_control="no-store", send_body=send_body)

        def _serve_file(self, target: Path, *, cache_control: str, send_body: bool = True) -> None:
            if not target.exists() or not target.is_file():
                self._send_text(HTTPStatus.NOT_FOUND, "Not found", send_body=send_body)
                return

            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            payload = target.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self._send_security_headers(cache_control=cache_control)
            self.end_headers()
            if send_body:
                self.wfile.write(payload)

        def _send_text(self, status: HTTPStatus, payload: str, *, send_body: bool = True) -> None:
            encoded = payload.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self._send_security_headers(cache_control="no-store")
            self.end_headers()
            if send_body:
                self.wfile.write(encoded)

        def _send_security_headers(self, *, cache_control: str) -> None:
            self.send_header("Cache-Control", cache_control)
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
                "img-src 'self' data: blob:; script-src 'self' https://cal.astforum.ru; "
                "style-src 'self' 'unsafe-inline'; font-src 'self'; "
                "connect-src 'self' https://cal.astforum.ru; frame-src 'self' https://cal.astforum.ru; "
                "form-action 'self'; upgrade-insecure-requests",
            )
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header("Strict-Transport-Security", "max-age=31536000")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")

    return ForumDevAuthHandler


def _read_secret(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _sign(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _cookie_header(name: str, value: str, max_age: int) -> str:
    return f"{name}={value}; Max-Age={max_age}; Path=/; HttpOnly; Secure; SameSite=Lax"


def _safe_static_target(root: Path, request_path: str) -> Path | None:
    normalized = posixpath.normpath(urlsplit(request_path).path).lstrip("/")
    if normalized in {"", "."}:
        return root / "index.html"

    target = (root / normalized).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target


def main() -> None:
    config = GatewayConfig.from_env()
    port = int(os.environ.get("PORT", "8080"))
    handler = create_handler(config)
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        print(f"Forum dev auth gateway listening on :{port} for {config.public_host}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
