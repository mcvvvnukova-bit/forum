#!/usr/bin/env python3
from __future__ import annotations

import sys
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


def main() -> int:
    if len(sys.argv) != 5:
        print(
            "Usage: check_origin_login.py BASE_URL HOST PASSWORD_FILE EXPECTED_TEXT",
            file=sys.stderr,
        )
        return 2

    base_url, host, password_file, expected_text = sys.argv[1:]
    password = Path(password_file).read_text(encoding="utf-8").strip()

    try:
        login_response = _request(
            base_url.rstrip("/") + "/auth/login",
            host=host,
            data=urlencode({"password": password}).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            follow_redirects=False,
        )
    except (HTTPError, URLError) as error:
        print(f"origin login request failed: {error}", file=sys.stderr)
        return 1

    login_status, login_headers, _ = login_response
    if login_status != 303:
        print(f"origin login returned {login_status}, expected 303", file=sys.stderr)
        return 1

    if login_headers.get("Location") != "/":
        print(
            f"origin login redirected to {login_headers.get('Location')!r}, expected '/'",
            file=sys.stderr,
        )
        return 1

    cookie_header = _cookie_header(login_headers.get_all("Set-Cookie", []))
    if not cookie_header:
        print("origin login did not return a session cookie", file=sys.stderr)
        return 1

    try:
        landing_status, _, landing_payload = _request(
            base_url.rstrip("/") + "/",
            host=host,
            headers={"Cookie": cookie_header},
        )
    except (HTTPError, URLError) as error:
        print(f"origin landing request failed: {error}", file=sys.stderr)
        return 1

    if landing_status != 200:
        print(f"origin landing returned {landing_status}, expected 200", file=sys.stderr)
        return 1

    if expected_text not in landing_payload.decode("utf-8", errors="replace"):
        print("origin landing did not include the expected authenticated content", file=sys.stderr)
        return 1

    print("PASS: origin correct-password flow returns the landing page")
    return 0


def _request(
    url: str,
    *,
    host: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    follow_redirects: bool = True,
):
    request_headers = {"Host": host, **(headers or {})}
    request = Request(url, data=data, headers=request_headers, method="POST" if data else "GET")
    opener = build_opener(_NoRedirectHandler) if not follow_redirects else None
    open_request = opener.open if opener else urlopen
    try:
        with open_request(request, timeout=20) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        if not follow_redirects and 300 <= error.code < 400:
            return error.code, error.headers, error.read()
        raise


def _cookie_header(set_cookie_headers: list[str]) -> str:
    cookie = SimpleCookie()
    for header in set_cookie_headers:
        cookie.load(header)

    return "; ".join(f"{key}={morsel.value}" for key, morsel in cookie.items())


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
