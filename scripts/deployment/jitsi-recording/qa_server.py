"""Loopback-only media test harness; moderator credentials never leave localhost."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private", type=Path, required=True)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--speech", type=Path, required=True)
    parser.add_argument("--port", type=int, default=19782)
    parser.add_argument("--upstream", default="http://127.0.0.1:19783")
    options = parser.parse_args()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, body, content_type, status=200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            paths = {
                "/": (Path(__file__).with_name("qa.html"), "text/html; charset=utf-8"),
                "/settings": (options.private, "application/json"),
                "/lib-jitsi-meet.min.js": (options.library, "application/javascript"),
                "/speech.wav": (options.speech, "audio/wav"),
            }
            item = paths.get(self.path)
            if item is None:
                return self.send(b"Not found", "text/plain", 404)
            self.send(item[0].read_bytes(), item[1])

        def do_POST(self):
            if not self.path.startswith("/http-bind"):
                return self.send(b"Not found", "text/plain", 404)
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1024 * 1024:
                return self.send(b"Too large", "text/plain", 413)
            headers = {"Content-Type": "text/xml; charset=utf-8", "Host": "vks.mvpspace.ru", "Origin": "https://vks.mvpspace.ru"}
            if self.headers.get("Authorization"):
                headers["Authorization"] = self.headers["Authorization"]
            request = urllib.request.Request(options.upstream + self.path, data=self.rfile.read(length), headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=65) as response:
                    self.send(response.read(), response.headers.get("Content-Type", "text/xml"))
            except urllib.error.HTTPError as error:
                self.send(error.read(), "text/xml", error.code)

    print(json.dumps({"url": "http://127.0.0.1:" + str(options.port), "loopbackOnly": True}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", options.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
