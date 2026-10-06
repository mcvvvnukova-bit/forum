import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {providerFixture} from '../.test-build/test/provider-fixture.js';
import {beginProbe, completeProbe} from './issuer-probe.mjs';

async function fixture(run) {
  const provider = await providerFixture();
  const dir = mkdtempSync(join(tmpdir(), 'forum-issuer-test-'));
  const config = {publicOrigin: 'https://dev.forum.example', sber: {
    ...provider.sber, redirectUri: 'https://forum.example/authorization', scope: 'openid',
  }};
  try { await run({provider, dir, config}); }
  finally { await provider.close(); rmSync(dir, {recursive: true}); }
}

function callback(start, code, state = new URL(start.authorizationUrl).searchParams.get('state')) {
  return `https://dev.forum.example/authorization?${new URLSearchParams({code, state})}`;
}

test('probe reports only the observed issuer and exchanges a browser-bound code once', () => fixture(async ({provider, dir, config}) => {
  const start = beginProbe(config, dir);
  const authorize = new URL(start.authorizationUrl);
  assert.equal(authorize.searchParams.get('redirect_uri'), 'https://forum.example/authorization');
  assert.equal(authorize.searchParams.get('scope'), 'openid');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorize.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  const pending = join(start.attemptDirectory, 'pending.json');
  assert.equal(statSync(pending).mode & 0o777, 0o600);
  assert.equal(statSync(start.attemptDirectory).mode & 0o777, 0o700);
  const code = randomUUID();
  provider.authorize(code, authorize.searchParams.get('nonce'), {iss: 'observed.sandbox.example'});
  await assert.rejects(completeProbe(config, start.attemptDirectory, callback(start, code, 'wrong')), /invalid_callback/);
  assert.equal(provider.calls.length, 0);
  const result = await completeProbe(config, start.attemptDirectory, callback(start, code));
  assert.deepEqual(result, {issuer: 'observed.sandbox.example', purpose: 'diagnostic_only', sessionCreated: false});
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].path, '/ru/prod/tokens/v2/oidc');
  assert.equal(provider.calls[0].form.get('redirect_uri'), 'https://forum.example/authorization');
  assert.match(provider.calls[0].form.get('code_verifier'), /^[\w-]{43}$/);
  assert.equal(existsSync(pending), false);
  await assert.rejects(completeProbe(config, start.attemptDirectory, callback(start, code)), /attempt_unavailable/);
  assert.equal(provider.calls.length, 1);
}));

for (const [name, claims] of [
  ['nonce', {nonce: 'wrong'}], ['audience', {aud: 'wrong'}], ['expired token', {exp: 1}],
  ['missing issuer', {iss: null}], ['unsafe issuer', {iss: 'untrusted\nvalue'}],
]) {
  test(`probe rejects ${name} without exposing a token`, () => fixture(async ({provider, dir, config}) => {
    const start = beginProbe(config, dir);
    const code = randomUUID();
    provider.authorize(code, new URL(start.authorizationUrl).searchParams.get('nonce'), claims);
    await assert.rejects(completeProbe(config, start.attemptDirectory, callback(start, code)), /^Error: invalid_token$/);
    assert.equal(provider.calls.length, 1);
    assert.equal(existsSync(join(start.attemptDirectory, 'pending.json')), false);
  }));
}

test('expired probes and unexpected callback hosts never contact the provider', () => fixture(async ({provider, dir, config}) => {
  const start = beginProbe(config, dir);
  await assert.rejects(completeProbe(config, start.attemptDirectory,
    callback(start, 'unused').replace('dev.forum.example', 'other.example')), /invalid_callback/);
  const path = join(start.attemptDirectory, 'pending.json');
  const attempt = JSON.parse(readFileSync(path));
  writeFileSync(path, JSON.stringify({...attempt, expiresAt: Date.now() - 1}));
  await assert.rejects(completeProbe(config, start.attemptDirectory, callback(start, 'unused')), /attempt_expired/);
  assert.equal(provider.calls.length, 0);
}));

test('probe refuses an untrusted TLS endpoint and never follows provider redirects', () => fixture(async ({provider, dir, config}) => {
  let start = beginProbe(config, dir);
  await assert.rejects(completeProbe({...config, sber: {...config.sber, ca: undefined}},
    start.attemptDirectory, callback(start, 'unused')), /tls_or_network_error/);
  assert.equal(provider.calls.length, 0);
  start = beginProbe(config, dir);
  provider.faults.tokenStatus = 302;
  await assert.rejects(completeProbe(config, start.attemptDirectory, callback(start, 'unused')), /token_endpoint_http_302/);
  assert.equal(provider.calls.length, 1);
}));
