import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/config.js';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('configuration fails closed for insecure public origins or missing partner secrets', () => {
  assert.throws(() => loadConfig({PUBLIC_ORIGIN: 'http://public.example'}), /HTTPS/);
  assert.throws(() => loadConfig({PUBLIC_ORIGIN: 'http://localhost', NODE_ENV: 'production'}), /HTTPS/);
  assert.throws(() => loadConfig({SBER_ID_ENABLED: 'true'}), /SBER_ID_REDIRECT_URI/);
  assert.throws(() => loadConfig({SESSION_TTL_SECONDS: 'NaN'}), /SESSION_TTL/);
  assert.equal(loadConfig({}).sber, undefined);
  assert.equal(loadConfig({PUBLIC_ORIGIN: 'https://forum.example'}).secureCookies, true);
});

test('cross-origin callbacks require an explicit HTTPS relay origin and the /authorization path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-relay-config-'));
  const fixture = join(dir, 'fixture');
  writeFileSync(fixture, 'synthetic-test-material');
  const env = {
    PUBLIC_ORIGIN: 'https://dev.forum.example', DATABASE_URL: 'postgres://localhost/forum_test',
    SBER_ID_ENABLED: 'true', SBER_ID_ENVIRONMENT: 'test',
    SBER_ID_CLIENT_ID: 'test-client', SBER_ID_CLIENT_SECRET: 'synthetic-secret',
    SBER_ID_REDIRECT_URI: 'https://forum.example/authorization',
    SBER_ID_CALLBACK_RELAY_ORIGIN: 'https://forum.example',
    SBER_ID_AUTHORIZE_URL: 'https://id-sb.sber.ru/CSAFront/oidc/authorize.do',
    SBER_ID_ISSUER: 'synthetic-issuer', SBER_ID_TOKEN_SIGNING_ALG: 'none',
    SBER_ID_CERT_FILE: fixture, SBER_ID_KEY_FILE: fixture,
  };
  try {
    const config = loadConfig(env);
    assert.equal(config.publicOrigin, 'https://dev.forum.example');
    assert.equal(config.sber?.redirectUri, 'https://forum.example/authorization');
    assert.equal(config.secureCookies, true);
    assert.throws(() => loadConfig({...env, SBER_ID_CALLBACK_RELAY_ORIGIN: ''}), /SBER_ID_REDIRECT_URI/);
    for (const redirect of ['https://other.example/authorization', 'https://forum.example/',
      'https://forum.example/auth/sber-id/callback', 'https://forum.example/authorization/',
      'https://forum.example/authorization?next=x', 'https://forum.example/authorization#fragment']) {
      assert.throws(() => loadConfig({...env, SBER_ID_REDIRECT_URI: redirect}), /SBER_ID_REDIRECT_URI/);
    }
    for (const relay of ['http://forum.example', 'https://user:password@forum.example',
      'https://forum.example/authorization', 'https://forum.example/?next=x',
      'https://forum.example/#fragment', 'https://dev.forum.example']) {
      assert.throws(() => loadConfig({...env, SBER_ID_CALLBACK_RELAY_ORIGIN: relay}));
    }
    assert.throws(() => loadConfig({...env, PUBLIC_ORIGIN: 'http://localhost'}));
  } finally { rmSync(dir, {recursive: true}); }
});

test('sandbox configuration routes credentials only to the documented Cloud sandbox', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-config-'));
  const fixture = join(dir, 'fixture');
  writeFileSync(fixture, 'synthetic-test-material');
  const env = {
    PUBLIC_ORIGIN: 'https://forum.example', DATABASE_URL: 'postgres://localhost/forum_test',
    SBER_ID_ENABLED: 'true', SBER_ID_ENVIRONMENT: 'test',
    SBER_ID_CLIENT_ID: 'test-client', SBER_ID_CLIENT_SECRET: 'synthetic-secret',
    SBER_ID_REDIRECT_URI: 'https://forum.example/auth/sber-id/callback',
    SBER_ID_AUTHORIZE_URL: 'https://id-sb.sber.ru/CSAFront/oidc/authorize.do',
    SBER_ID_ISSUER: 'id-sb.sber.ru', SBER_ID_TOKEN_SIGNING_ALG: 'none',
    SBER_ID_CERT_FILE: fixture, SBER_ID_KEY_FILE: fixture,
  };
  try {
    assert.equal(loadConfig(env).sber?.apiOrigin, 'https://oauth-sb.sber.ru:6443');
    assert.equal(loadConfig(env).sber?.addressFamily, 4);
    assert.equal(loadConfig({...env, SBER_ID_ENVIRONMENT: 'production'}).sber?.apiOrigin, 'https://oauth.sber.ru');
    assert.equal(loadConfig({...env, SBER_ID_ENVIRONMENT: 'production'}).sber?.addressFamily, undefined);
    for (const redirectUri of ['https://forum.example', 'https://forum.example/', 'https://forum.example/authorization']) {
      assert.equal(loadConfig({...env, SBER_ID_REDIRECT_URI: redirectUri}).sber?.redirectUri, redirectUri);
    }
    for (const redirectUri of ['https://other.example', 'https://forum.example/unhandled', 'https://forum.example/?next=x',
      'https://forum.example/authorization/', 'https://other.example/authorization', 'https://forum.example/authorization?next=x']) {
      assert.throws(() => loadConfig({...env, SBER_ID_REDIRECT_URI: redirectUri}), /SBER_ID_REDIRECT_URI/);
    }
  } finally { rmSync(dir, {recursive: true}); }
});
