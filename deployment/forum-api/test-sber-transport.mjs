// Run inside the existing dev API image. No auth code or account is required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lookup} from 'node:dns/promises';
import {Agent, request} from 'node:https';
import {loadConfig} from '/app/dist/config.js';

test('Sber backchannel resolves through container DNS and authenticates TLS', {timeout:20000}, async t => {
  const {sber:c}=loadConfig();
  assert.ok(c, 'Sber must already be configured');
  const host=new URL(c.apiOrigin).hostname;
  const resolved=await lookup(host,{family:c.addressFamily});
  assert.equal(resolved.family,4);
  t.diagnostic(JSON.stringify({host,dnsResolved:true}));
  const agent=new Agent({family:c.addressFamily,cert:c.cert,key:c.key,ca:c.ca,
    passphrase:c.passphrase,rejectUnauthorized:true,minVersion:'TLSv1.2'});
  try {
    const result=await new Promise((resolve,reject) => {
      // A parameterless GET is deliberately invalid; it tests transport only.
      const req=request(new URL('/ru/prod/tokens/v2/oidc',c.apiOrigin),{method:'GET',agent},res => {
        const result={status:res.statusCode,tlsAuthorized:res.socket.authorized,
          tlsProtocol:res.socket.getProtocol()};
        res.resume(); res.once('end',()=>resolve(result)); res.once('error',reject);
      });
      const timer=setTimeout(()=>req.destroy(new Error('Transport probe timeout')),12000);
      req.once('close',()=>clearTimeout(timer)); req.once('error',reject); req.end();
    });
    assert.equal(result.tlsAuthorized,true);
    assert.equal(result.status,400);
    t.diagnostic(JSON.stringify(result));
  } finally {agent.destroy();}
});
