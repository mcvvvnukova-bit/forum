import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {Agent, request} from 'node:https';
import {providerFixture} from './provider-fixture.js';
import {SberClient} from '../src/iam/sber-client.js';

test('provider exchange succeeds over IPv4 when an AAAA lookup times out', async () => {
  const provider = await providerFixture();
  const lookup = mock.method(dns, 'lookup', (hostname: string, options: dns.LookupOptions,
    callback: (...args: unknown[]) => void) => {
    if (options.family !== 4) {
      callback(Object.assign(new Error('AAAA lookup timed out'), {code: 'EAI_AGAIN'}));
    } else if (options.all) {
      callback(null, [{address: '127.0.0.1', family: 4}]);
    } else {
      callback(null, '127.0.0.1', 4);
    }
  });
  const client = new SberClient(Object.assign({...provider.sber,
    apiOrigin: provider.sber.apiOrigin.replace('127.0.0.1', 'localhost')}, {addressFamily: 4}));
  try {
    provider.authorize('ipv4-code', 'ipv4-nonce');
    const result = await client.identify('ipv4-code', 'ipv4-nonce', 'verifier');
    assert.equal(result.identity.subject, 'sber-person-1');
    assert.equal(provider.calls.length, 2);
  } finally { client.close(); lookup.mock.restore(); await provider.close(); }
});

test('provider adapter requires a trusted server certificate and a client certificate', async () => {
  const provider = await providerFixture();
  const client = new SberClient({...provider.sber, ca: undefined});
  try {
    await assert.rejects(client.identify('code', 'nonce', 'verifier'), {code: 'provider_unavailable'});
    const agent = new Agent({ca: provider.sber.ca, rejectUnauthorized: true});
    try {
      await assert.rejects(new Promise((resolve, reject) => {
        const req = request(provider.sber.apiOrigin, {agent}, resolve);
        req.on('error', reject); req.end();
      }));
    } finally { agent.destroy(); }
    assert.equal(provider.calls.length, 0);
  } finally { client.close(); await provider.close(); }
});

test('provider adapter refuses redirects instead of resending credentials', async () => {
  const provider = await providerFixture();
  const client = new SberClient(provider.sber);
  try {
    provider.faults.tokenStatus = 302;
    await assert.rejects(client.identify('code', 'nonce', 'verifier'), {code: 'provider_unavailable'});
    assert.equal(provider.calls.length, 1);
  } finally { client.close(); await provider.close(); }
});
