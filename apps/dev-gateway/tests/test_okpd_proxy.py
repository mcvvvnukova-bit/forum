import json
import unittest
from http.server import BaseHTTPRequestHandler

import test_auth_gateway as helpers


class OkpdProxyTest(unittest.TestCase):
    def setUp(self):
        self.fixture = helpers.AuthGatewayTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def upstream(self, calls, status=200):
        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append((self.path, self.headers.get('Cookie')))
                body = json.dumps({'items': [], 'total': 0} if status == 200 else {'code': 'unauthenticated'}).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass
        return helpers.GatewayServer(Upstream)

    def test_directory_get_preserves_filters_and_forum_session(self):
        calls = []
        with self.upstream(calls) as api:
            with helpers.GatewayServer(self.fixture.make_handler(f'http://127.0.0.1:{api.port}')) as gateway:
                path = '/api/references/okpd?code=43&name=%D0%BC%D0%BE%D0%BD%D1%82%D0%B0%D0%B6&page=2'
                status, headers, body = gateway.request('GET', path, headers={'Cookie': 'forum_session=existing'})
        self.assertEqual(status, 200)
        self.assertEqual(calls, [(path, 'forum_session=existing')])
        self.assertEqual(headers['content-type'], 'application/json')
        self.assertEqual(headers['cache-control'], 'no-store')
        self.assertEqual(json.loads(body)['total'], 0)

    def test_anonymous_directory_request_preserves_api_401(self):
        calls = []
        with self.upstream(calls, 401) as api:
            with helpers.GatewayServer(self.fixture.make_handler(f'http://127.0.0.1:{api.port}')) as gateway:
                status, headers, body = gateway.request('GET', '/api/references/okpd')
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body), {'code': 'unauthenticated'})
        self.assertEqual(headers['cache-control'], 'no-store')

    def test_only_exact_read_route_reaches_api(self):
        calls = []
        with self.upstream(calls) as api:
            with helpers.GatewayServer(self.fixture.make_handler(f'http://127.0.0.1:{api.port}')) as gateway:
                for method, path in [('GET', '/api/references/okpd/'), ('GET', '/api/references/okpd/extra'),
                                     ('GET', '/api/references/unknown'), ('HEAD', '/api/references/okpd'),
                                     ('POST', '/api/references/okpd'), ('PUT', '/api/references/okpd'),
                                     ('PATCH', '/api/references/okpd'), ('DELETE', '/api/references/okpd')]:
                    with self.subTest(method=method, path=path):
                        status, _, _ = gateway.request(method, path)
                        self.assertEqual(status, 404)
        self.assertEqual(calls, [])
