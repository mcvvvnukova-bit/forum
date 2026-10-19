import json
import unittest
from http.server import BaseHTTPRequestHandler
import test_auth_gateway as helpers

class ManagedReferenceProxyTest(unittest.TestCase):
    def setUp(self):
        self.fixture=helpers.AuthGatewayTest();self.fixture.setUp();self.addCleanup(self.fixture.tearDown)
    def test_closed_routes_and_protective_headers(self):
        calls=[]
        class Upstream(BaseHTTPRequestHandler):
            def respond(self):
                body=self.rfile.read(int(self.headers.get('Content-Length','0')))
                calls.append((self.command,self.path,dict(self.headers),body))
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{}')
            do_GET=respond;do_POST=respond;do_PATCH=respond;do_DELETE=respond
            def log_message(self,*_):pass
        headers={'Cookie':'forum_session=existing','Origin':'https://dev.astforum.ru','X-Forum-CSRF':'csrf','Idempotency-Key':'request-key','If-Match':'"3"','Content-Type':'application/json'}
        with helpers.GatewayServer(Upstream) as api:
            with helpers.GatewayServer(self.fixture.make_handler(f'http://127.0.0.1:{api.port}')) as gateway:
                for kind in ['regions','offer-types','business-segments','commercial-roles','units','rejection-reasons','company-statuses']:
                    for method,suffix in [('GET','?code=01'),('GET','/01'),('POST',''),('PATCH','/01'),('DELETE','/01')]:
                        status,h,_=gateway.request(method,'/api/references/managed/'+kind+suffix,headers=headers)
                        self.assertEqual(status,200,(method,kind));self.assertEqual(h['cache-control'],'no-store')
                for method,path in [('GET','units/'),('GET','units/01/extra'),('GET','unknown'),('HEAD','units'),('POST','units/01'),('PATCH','units'),('DELETE','units'),('PUT','units/01'),('GET','units/a%2Fb'),('GET','units/..')]:
                    self.assertEqual(gateway.request(method,'/api/references/managed/'+path,headers=headers)[0],404,(method,path))
        self.assertEqual(len(calls),35)
        for _,_,h,_ in calls:
            for k in ['Cookie','Origin','X-Forum-CSRF','Idempotency-Key','If-Match']:self.assertEqual(h[k],headers[k])
