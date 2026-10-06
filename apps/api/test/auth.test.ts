import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {providerFixture} from './provider-fixture.js';

let pool: Pool;
let provider: Awaited<ReturnType<typeof providerFixture>>;
let app: NestFastifyApplication;

before(async () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test';
  if (!new URL(connectionString).pathname.endsWith('_test')) throw new Error('Use a dedicated database ending in _test');
  pool = new Pool({connectionString});
  await migrate(pool);
  provider = await providerFixture();
  app = await createApp({publicOrigin: 'https://forum.example', databaseUrl: connectionString,
    secureCookies: true, sessionTtlSeconds: 3600, sber: provider.sber}, pool);
});

beforeEach(async () => {
  await pool.query('TRUNCATE iam.authorization_attempts, iam.sessions, iam.role_assignments, iam.external_identities, iam.users, party.participants, audit.audit_events, integration.outbox_events');
  provider.calls.length = 0;
  Object.assign(provider.faults, {tokenStatus: 200, profileStatus: 200, completionStatus: 204});
});

after(async () => { await app?.close(); await provider?.close(); await pool?.end(); });

async function begin(intent = 'register') {
  const response = await app.inject({method: 'GET', url: `/auth/sber-id/start?intent=${intent}&subject=individual`});
  assert.equal(response.statusCode, 303, response.body);
  const url = new URL(response.headers.location!);
  const cookie = response.cookies.find(c => c.name.includes('sber_attempt'))!;
  assert.ok(cookie, 'browser-bound authorization cookie');
  return {url, cookie: `${cookie.name}=${cookie.value}`, state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!};
}

async function finish(attempt: Awaited<ReturnType<typeof begin>>, claims = {}, profile = {}) {
  const code = randomUUID();
  provider.authorize(code, attempt.nonce, claims, profile);
  return app.inject({method: 'GET', url: `/auth/sber-id/callback?${new URLSearchParams({state: attempt.state, code})}`,
    headers: {cookie: attempt.cookie}});
}

function sessionCookie(response: Awaited<ReturnType<typeof finish>>) {
  const cookie = response.cookies.find(c => c.name.includes('forum_session') && c.value);
  assert.ok(cookie, response.body);
  return `${cookie.name}=${cookie.value}`;
}

async function userCount() { return Number((await pool.query('SELECT count(*) FROM iam.users')).rows[0].count); }

test('Sber start reports unavailable until partner credentials are configured', async () => {
  const app = await createApp();
  try {
    const response = await app.inject({method: 'GET', url: '/auth/sber-id/start?intent=register&subject=individual'});
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'sber_unavailable');
  } finally { await app.close(); }
});

test('authorization uses unpredictable browser-bound state, nonce and S256 PKCE', async () => {
  const one = await begin();
  const two = await begin();
  assert.notEqual(one.state, two.state);
  assert.notEqual(one.nonce, two.nonce);
  assert.equal(one.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(one.url.searchParams.get('code_challenge')!, /^[\w-]{43}$/);
  assert.equal(one.url.searchParams.get('response_type'), 'code');
  assert.equal(one.url.searchParams.get('redirect_uri'), provider.sber.redirectUri);
  assert.equal(one.url.searchParams.get('scope'), 'openid name email mobile');
  assert.equal(one.url.searchParams.has('client_secret'), false);
  assert.equal(await userCount(), 0);
});

test('unconfigured browser login redirects back to the landing with a controlled error', async () => {
  const disabled = await createApp();
  try {
    const response = await disabled.inject({method: 'GET', url: '/auth/sber-id/start?intent=login', headers: {accept: 'text/html'}});
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, '/?auth_error=sber_unavailable');
  } finally { await disabled.close(); }
});

test('registration persists identity, provider role, outbox and an opaque session after mTLS exchange', async () => {
  const response = await finish(await begin());
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, '/?auth=success');
  const cookie = sessionCookie(response);
  const me = await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie}});
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.displayName, 'Иванова Анна');
  assert.equal(me.json().user.emailConfirmed, true);
  assert.equal(me.json().participant.legalStatus, 'individual_person');
  assert.equal(await userCount(), 1);
  assert.equal((await pool.query('SELECT role FROM iam.role_assignments')).rows[0].role, 'provider');
  assert.equal((await pool.query('SELECT event_type FROM integration.outbox_events')).rows[0].event_type, 'ParticipantRegistered');
  assert.equal((await pool.query('SELECT count(*) FROM iam.authorization_attempts')).rows[0].count, '0');
  const tokenCall = provider.calls.find(c => c.path.endsWith('/oidc'))!;
  assert.equal(tokenCall.form.get('client_secret'), 'synthetic-secret');
  assert.equal(tokenCall.form.get('redirect_uri'), provider.sber.redirectUri);
  assert.match(tokenCall.form.get('code_verifier')!, /^[\w-]{43}$/);
  assert.match(String(tokenCall.headers.rquid), /^[a-f0-9]{32}$/);
  assert.ok(provider.calls.some(c => c.path === '/api/v2/auth/completed'));
  assert.doesNotMatch(JSON.stringify(me.json()), /test-access|id_token|nonce|synthetic-secret/);
  const stored = (await pool.query('SELECT token_hash FROM iam.sessions')).rows[0].token_hash;
  assert.notEqual(stored, cookie.split('=')[1]);
  assert.match(String(response.headers['set-cookie']), /HttpOnly/);
  assert.match(String(response.headers['set-cookie']), /Secure/);
  assert.match(String(response.headers['set-cookie']), /SameSite=Lax/);
});

test('returning login and repeated registration reuse the account and rotate the session', async () => {
  const first = await finish(await begin());
  const oldCookie = sessionCookie(first);
  const next = await begin('login');
  const code = randomUUID();
  provider.authorize(code, next.nonce);
  const second = await app.inject({method: 'GET', url: `/auth/sber-id/callback?state=${next.state}&code=${code}`,
    headers: {cookie: `${next.cookie}; ${oldCookie}`}});
  assert.notEqual(sessionCookie(second), oldCookie);
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie: oldCookie}})).statusCode, 401);
  await finish(await begin());
  assert.equal(await userCount(), 1);
  assert.equal((await pool.query('SELECT count(*) FROM party.participants')).rows[0].count, '1');
});

test('each authentication keeps one rquid across token, userinfo and completion retries', async () => {
  provider.faults.completionStatus = 503;
  const response = await finish(await begin());
  assert.equal(response.headers.location, '/?auth=success');
  const token = provider.calls.find(c => c.path.endsWith('/oidc'))!;
  const profile = provider.calls.find(c => c.path.endsWith('/userinfo'))!;
  const completion = provider.calls.filter(c => c.path === '/api/v2/auth/completed');
  assert.match(String(token.headers.rquid), /^[a-f0-9]{32}$/);
  assert.equal(profile.headers['x-introspect-rquid'], token.headers.rquid);
  assert.equal(completion.length, 2);
  for (const call of completion) assert.equal(call.headers.rquid, token.headers.rquid);
  const firstRquid = token.headers.rquid;
  provider.calls.length = 0;
  await finish(await begin('login'));
  assert.notEqual(provider.calls[0].headers.rquid, firstRquid);
});

test('a registered root callback authenticates without treating ordinary homepage visits as callbacks', async () => {
  const rootApp = await createApp({publicOrigin: 'https://forum.example', databaseUrl: '',
    secureCookies: true, sessionTtlSeconds: 3600,
    sber: {...provider.sber, redirectUri: 'https://forum.example'}}, pool);
  try {
    const start = await rootApp.inject({method: 'GET', url: '/auth/sber-id/start?intent=register'});
    const authorize = new URL(start.headers.location!);
    assert.equal(authorize.searchParams.get('redirect_uri'), 'https://forum.example');
    const browser = start.cookies.find(c => c.name.includes('sber_attempt'))!;
    const headers = {cookie: `${browser.name}=${browser.value}`};
    for (const url of ['/', '/?auth=success', '/auth/sber-id/callback?state=wrong', '/?state=only']) {
      const page = await rootApp.inject({method: 'GET', url, headers});
      assert.equal(page.statusCode, 404);
      assert.equal(page.headers['set-cookie'], undefined);
    }
    const code = randomUUID();
    provider.authorize(code, authorize.searchParams.get('nonce')!);
    const url = `/?${new URLSearchParams({code, state: authorize.searchParams.get('state')!})}`;
    assert.equal((await rootApp.inject({method: 'HEAD', url, headers})).statusCode, 405);
    const response = await rootApp.inject({method: 'GET', url, headers});
    assert.equal(response.headers.location, '/?auth=success');
    assert.equal(provider.calls[0].form.get('redirect_uri'), 'https://forum.example');
    const cookie = response.cookies.find(c => c.name.includes('forum_session'))!;
    assert.ok(cookie);
    assert.equal((await rootApp.inject({method: 'GET', url: '/api/auth/session',
      headers: {cookie: `${cookie.name}=${cookie.value}`}})).statusCode, 200);
  } finally { await rootApp.close(); }
});

test('non-configured callback aliases do not consume attempts', async () => {
  const attempt = await begin();
  for (const path of ['/', '/authorization']) {
    const response = await app.inject({method: 'GET', url: `${path}?code=unused&state=${attempt.state}`, headers: {cookie: attempt.cookie}});
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal((await finish(attempt)).headers.location, '/?auth=success');
});

test('the registered /authorization callback supports registration and login with one-use browser-bound state', async () => {
  const registered = await createApp({publicOrigin: 'https://forum.example', databaseUrl: '',
    secureCookies: true, sessionTtlSeconds: 3600,
    sber: {...provider.sber, redirectUri: 'https://forum.example/authorization'}}, pool);
  try {
    for (const intent of ['register', 'login']) {
      const start = await registered.inject({method: 'GET', url: `/auth/sber-id/start?intent=${intent}`});
      const authorize = new URL(start.headers.location!);
      assert.equal(authorize.searchParams.get('redirect_uri'), 'https://forum.example/authorization');
      const attempt = start.cookies.find(c => c.name.includes('sber_attempt'))!;
      const headers = {cookie: `${attempt.name}=${attempt.value}`};
      const code = randomUUID();
      provider.authorize(code, authorize.searchParams.get('nonce')!);
      const query = new URLSearchParams({code, state: authorize.searchParams.get('state')!});
      const url = `/authorization?${query}`;
      assert.equal((await registered.inject({method: 'GET', url})).headers.location, '/?auth_error=invalid_state');
      assert.equal((await registered.inject({method: 'HEAD', url, headers})).statusCode, 405);
      assert.equal((await registered.inject({method: 'GET', url: `/auth/sber-id/callback?${query}`, headers})).statusCode, 404);
      const response = await registered.inject({method: 'GET', url, headers});
      assert.equal(response.headers.location, '/?auth=success');
      const cookie = response.cookies.find(c => c.name.includes('forum_session'))!;
      assert.ok(cookie);
      assert.equal((await registered.inject({method: 'GET', url: '/api/auth/session',
        headers: {cookie: `${cookie.name}=${cookie.value}`}})).statusCode, 200);
      assert.equal((await registered.inject({method: 'GET', url, headers})).headers.location, '/?auth_error=invalid_state');
    }
    assert.equal(await userCount(), 1);
    for (const call of provider.calls.filter(c => c.path.endsWith('/oidc'))) {
      assert.equal(call.form.get('redirect_uri'), 'https://forum.example/authorization');
    }
  } finally { await registered.close(); }
});

test('a dev callback retains the main registered URI, host-only cookies and one-use browser binding', async () => {
  const registeredUri = 'https://forum.example/authorization';
  const dev = await createApp({publicOrigin: 'https://dev.forum.example', databaseUrl: '',
    secureCookies: true, sessionTtlSeconds: 3600,
    sber: {...provider.sber, redirectUri: registeredUri}}, pool);
  try {
    for (const intent of ['register', 'login']) {
      const start = await dev.inject({method: 'GET', url: `/auth/sber-id/start?intent=${intent}`});
      const authorize = new URL(start.headers.location!);
      assert.equal(authorize.searchParams.get('redirect_uri'), registeredUri);
      const attempt = start.cookies.find(c => c.name === '__Host-sber_attempt')!;
      assert.ok(attempt);
      assert.doesNotMatch(String(start.headers['set-cookie']), /Domain=/i);
      const code = randomUUID();
      provider.authorize(code, authorize.searchParams.get('nonce')!);
      const url = `/authorization?${new URLSearchParams({code, state: authorize.searchParams.get('state')!})}`;
      const headers = {cookie: `${attempt.name}=${attempt.value}`};
      assert.equal((await dev.inject({method: 'GET', url})).headers.location, '/?auth_error=invalid_state');
      const response = await dev.inject({method: 'GET', url, headers});
      assert.equal(response.headers.location, '/?auth=success');
      assert.doesNotMatch(String(response.headers['set-cookie']), /Domain=/i);
      const cookie = response.cookies.find(c => c.name === '__Host-forum_session')!;
      assert.ok(cookie?.value);
      assert.equal((await dev.inject({method: 'GET', url: '/api/auth/session',
        headers: {cookie: `${cookie.name}=${cookie.value}`}})).statusCode, 200);
      assert.equal((await dev.inject({method: 'GET', url, headers})).headers.location, '/?auth_error=invalid_state');
    }
    assert.equal(await userCount(), 1);
    for (const call of provider.calls.filter(c => c.path.endsWith('/oidc'))) {
      assert.equal(call.form.get('redirect_uri'), registeredUri);
    }
  } finally { await dev.close(); }
});

test('unknown login does not silently register an account', async () => {
  const response = await finish(await begin('login'));
  assert.equal(response.headers.location, '/?auth_error=registration_required');
  assert.equal(await userCount(), 0);
});

test('callback is one-use and bound to the initiating browser', async () => {
  const attempt = await begin();
  const wrong = await app.inject({method: 'GET', url: `/auth/sber-id/callback?state=${attempt.state}&code=stolen`});
  assert.equal(wrong.headers.location, '/?auth_error=invalid_state');
  assert.equal(provider.calls.length, 0);
  const success = await finish(attempt);
  assert.equal(success.headers.location, '/?auth=success');
  const replay = await finish(attempt);
  assert.equal(replay.headers.location, '/?auth_error=invalid_state');
  assert.equal(await userCount(), 1);
});

test('expired authorization attempts and declined consent create no account', async () => {
  const expired = await begin();
  await pool.query("UPDATE iam.authorization_attempts SET expires_at = now() - interval '1 second'");
  assert.equal((await finish(expired)).headers.location, '/?auth_error=invalid_state');
  const denied = await begin();
  const response = await app.inject({method: 'GET', url: `/auth/sber-id/callback?state=${denied.state}&error=access_denied`,
    headers: {cookie: denied.cookie}});
  assert.equal(response.headers.location, '/?auth_error=access_denied');
  assert.equal(provider.calls.length, 0);
  assert.equal(await userCount(), 0);
});

for (const [label, claims, profile] of [
  ['nonce', {nonce: 'wrong'}, {}], ['audience', {aud: 'other-client'}, {}],
  ['issuer', {iss: 'attacker'}, {}], ['expiry', {exp: 1}, {}],
  ['missing expiry', {exp: null}, {}], ['future issuance', {iat: 9999999999}, {}],
  ['authorized party', {azp: 'other-client'}, {}], ['subject', {sub: ''}, {}],
  ['userinfo subject', {}, {sub: 'another-person'}],
] as const) {
  test(`rejects invalid ${label} before creating an account`, async () => {
    const response = await finish(await begin(), claims, profile);
    assert.equal(response.headers.location, '/?auth_error=invalid_provider_response');
    assert.equal(await userCount(), 0);
    assert.equal((await pool.query('SELECT count(*) FROM iam.sessions')).rows[0].count, '0');
  });
}

test('provider failures return a recoverable error without leaking the upstream response', async () => {
  provider.faults.tokenStatus = 500;
  const response = await finish(await begin());
  assert.equal(response.headers.location, '/?auth_error=provider_unavailable');
  assert.equal(await userCount(), 0);
  assert.doesNotMatch(response.body, /synthetic-secret|test-access/);
});

test('alternate Sber subjects match the same account without matching by email', async () => {
  await finish(await begin());
  const response = await finish(await begin('login'), {sub: 'sber-new-sub', sub_alt: ['sber-person-1']});
  assert.equal(response.headers.location, '/?auth=success');
  assert.equal(await userCount(), 1);
  const collision = await finish(await begin(), {sub: 'unrelated-person'});
  assert.equal(collision.headers.location, '/?auth_error=account_conflict');
  assert.equal(await userCount(), 1);
});

test('concurrent registration creates one identity and participant', async () => {
  const one = await begin();
  const two = await begin();
  const responses = await Promise.all([finish(one), finish(two)]);
  for (const response of responses) assert.equal(response.headers.location, '/?auth=success');
  assert.equal(await userCount(), 1);
  assert.equal((await pool.query('SELECT count(*) FROM party.participants')).rows[0].count, '1');
});

test('session endpoint rejects missing, expired and deactivated sessions; logout enforces origin', async () => {
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session'})).statusCode, 401);
  const cookie = sessionCookie(await finish(await begin()));
  const crossSite = await app.inject({method: 'POST', url: '/api/auth/logout', headers: {cookie, origin: 'https://attacker.test'}});
  assert.equal(crossSite.statusCode, 403);
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie}})).statusCode, 200);
  await pool.query("UPDATE iam.users SET status = 'deactivated'");
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie}})).statusCode, 401);
  await pool.query("UPDATE iam.users SET status = 'active'");
  await pool.query("UPDATE iam.sessions SET expires_at = now() - interval '1 second'");
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie}})).statusCode, 401);
  const fresh = sessionCookie(await finish(await begin('login')));
  const logout = await app.inject({method: 'POST', url: '/api/auth/logout', headers: {cookie: fresh, origin: 'https://forum.example'}});
  assert.equal(logout.statusCode, 204);
  assert.equal((await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie: fresh}})).statusCode, 401);
});

test('Sber only accepts the individual subject and does not follow user-provided redirects', async () => {
  for (const query of ['intent=register&subject=legal', 'intent=register&subject=entrepreneur', 'intent=other', 'intent=login&intent=register']) {
    assert.equal((await app.inject({method: 'GET', url: `/auth/sber-id/start?${query}`})).statusCode, 400);
  }
  const response = await app.inject({method: 'GET', url: '/auth/sber-id/start?intent=register&return_to=https://attacker.test'});
  assert.equal(response.statusCode, 400);
});

test('HEAD requests cannot consume attempts or begin authentication', async () => {
  const attempt = await begin();
  assert.equal((await app.inject({method: 'HEAD', url: '/auth/sber-id/start?intent=login'})).statusCode, 405);
  assert.equal((await app.inject({method: 'HEAD', url: `/auth/sber-id/callback?state=${attempt.state}&code=x`,
    headers: {cookie: attempt.cookie}})).statusCode, 405);
  assert.equal((await finish(attempt)).headers.location, '/?auth=success');
});

test('deactivated identities cannot open new sessions and conflicting aliases are not auto-merged', async () => {
  await finish(await begin());
  await pool.query("UPDATE iam.users SET status = 'deactivated'");
  assert.equal((await finish(await begin('login'))).headers.location, '/?auth_error=account_deactivated');
  await pool.query("UPDATE iam.users SET status = 'active'");
  await finish(await begin(), {sub: 'person-2'}, {email: 'second@example.test'});
  const conflict = await finish(await begin('login'), {sub: 'person-2', alt_sub: 'sber-person-1'});
  assert.equal(conflict.headers.location, '/?auth_error=account_conflict');
  assert.equal(await userCount(), 2);
});

test('missing optional profile data still registers without treating email as confirmed', async () => {
  const response = await finish(await begin(), {}, {email: null, given_name: null, family_name: null});
  const me = await app.inject({method: 'GET', url: '/api/auth/session', headers: {cookie: sessionCookie(response)}});
  assert.equal(me.json().user.email, null);
  assert.equal(me.json().user.emailConfirmed, false);
});

test('userinfo failure creates no account and completion outage does not undo a successful login', async () => {
  provider.faults.profileStatus = 500;
  assert.equal((await finish(await begin())).headers.location, '/?auth_error=provider_unavailable');
  assert.equal(await userCount(), 0);
  provider.faults.profileStatus = 200;
  provider.faults.completionStatus = 500;
  const response = await finish(await begin());
  assert.equal(response.headers.location, '/?auth=success');
  assert.ok(sessionCookie(response));
  assert.equal(provider.calls.filter(c => c.path === '/api/v2/auth/completed').length, 2);
});

test('database failure during registration rolls back the user and participant', async () => {
  await pool.query(`CREATE FUNCTION integration.reject_test_event() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'test storage fault'; END $$;
    CREATE TRIGGER reject_test_event BEFORE INSERT ON integration.outbox_events
    FOR EACH ROW EXECUTE FUNCTION integration.reject_test_event()`);
  try {
    const response = await finish(await begin());
    assert.equal(response.headers.location, '/?auth_error=temporarily_unavailable');
    assert.equal(await userCount(), 0);
    assert.equal((await pool.query('SELECT count(*) FROM party.participants')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM iam.sessions')).rows[0].count, '0');
  } finally {
    await pool.query('DROP TRIGGER reject_test_event ON integration.outbox_events; DROP FUNCTION integration.reject_test_event()');
  }
});
