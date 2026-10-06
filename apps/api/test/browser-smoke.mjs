import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {access, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import {Pool} from 'pg';
import {createApp} from '../.test-build/src/app.js';
import {migrate} from '../.test-build/src/migrate.js';
import {testDatabaseUrl} from '../.test-build/test/test-database.js';
import {providerFixture} from '../.test-build/test/provider-fixture.js';

const connectionString = testDatabaseUrl(process.env.TEST_DATABASE_URL);

// The API owns the runner; the existing landing remains a separately installed composition.
const landingRoot = fileURLToPath(new URL('../../../deployment/dev-landing/', import.meta.url));
try {
  for (const file of ['package.json', 'vite.landing.config.ts', 'landing.html', 'src/landing/LandingApp.tsx']) {
    await access(join(landingRoot, file));
  }
  const landingRequire = createRequire(join(landingRoot, 'package.json'));
  for (const dependency of ['react', 'react-dom', '@primer/react', '@vitejs/plugin-react', 'vite']) {
    landingRequire.resolve(dependency);
  }
} catch (cause) {
  throw new Error('Browser acceptance requires tracked deployment/dev-landing sources and its own dependencies. Run npm ci --prefix deployment/dev-landing from the repository root.', {cause});
}
const screenshots = await mkdtemp(join(tmpdir(), 'forum-sber-browser-'));
const pool = new Pool({connectionString});
const provider = await providerFixture();
const config = {publicOrigin: 'http://127.0.0.1', databaseUrl: connectionString, secureCookies: false,
  sessionTtlSeconds: 3600, sber: provider.sber};
const api = await createApp(config, pool);
let vite;
let browser;
const previousApiOrigin = process.env.FORUM_API_ORIGIN;
try {
  // Only migration 001 is needed by this unchanged legacy Sandbox runtime.
  await migrate(pool);
  await api.listen(0, '127.0.0.1');
  const target = await api.getUrl();
  process.env.FORUM_API_ORIGIN = target;
  vite = await createServer({root: landingRoot, configFile: join(landingRoot, 'vite.landing.config.ts'),
    server: {host: '127.0.0.1', port: 0}});
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  config.publicOrigin = origin;
  provider.sber.redirectUri = `${origin}/authorization`;
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 900}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/landing.html`);
    await page.getByRole('link', {name: 'Регистрация', exact: true}).click();
    await page.getByRole('link', {name: 'Зарегистрироваться по Сбер ID'}).click();
    await expect(page.getByText('Иванова Анна', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Выйти'})).toBeVisible();
    const authenticated = await page.request.get(`${origin}/api/auth/session`);
    assert.equal(authenticated.status(), 200);
    const identity = await authenticated.json();
    assert.equal(identity.user.displayName, 'Иванова Анна');
    assert.equal((await pool.query('SELECT count(*) FROM iam.external_identities')).rows[0].count, '1');
    assert.equal((await pool.query('SELECT count(*) FROM iam.users')).rows[0].count, '1');
    assert.ok(provider.calls.some(call => call.path.endsWith('/tokens/v2/oidc')));
    assert.ok(provider.calls.some(call => call.path.endsWith('/userinfo')));
    assert.ok(provider.calls.some(call => call.path.endsWith('/auth/completed')));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await expect(page.getByRole('button', {name: 'Выйти'})).toBeVisible();
    await expect(page.getByText('Иванова Анна', {exact: true})).toBeVisible();
    const reloaded = await page.request.get(`${origin}/api/auth/session`);
    assert.equal(reloaded.status(), 200);
    assert.equal((await reloaded.json()).user.id, identity.user.id);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: join(screenshots, `session-${width}.png`)});
    await page.getByRole('button', {name: 'Выйти'}).click();
    await expect(page.getByRole('link', {name: 'Регистрация', exact: true})).toBeVisible();
    const session = await page.request.get(`${origin}/api/auth/session`);
    assert.equal(session.status(), 401);
    assert.equal((await pool.query('SELECT count(*) FROM iam.sessions WHERE revoked_at IS NULL')).rows[0].count, '0');
    // Exercise provider cancellation through start/state/callback, not a hand-written error URL.
    provider.faults.authorizationError = 'access_denied';
    const callsBeforeCancel = provider.calls.length;
    const cancellation = page.waitForResponse(response => new URL(response.url()).pathname === '/authorization' && response.status() === 303);
    await page.getByRole('link', {name: 'Регистрация', exact: true}).click();
    await page.getByRole('link', {name: 'Зарегистрироваться по Сбер ID'}).click();
    await expect(page.getByRole('alert')).toContainText('Вы отменили вход через Сбер ID');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal((await cancellation).headers().location, '/?auth_error=access_denied');
    assert.equal((await page.request.get(`${origin}/api/auth/session`)).status(), 401);
    assert.equal(provider.calls.length, callsBeforeCancel, 'Cancellation must not exchange a token');
    assert.equal((await pool.query('SELECT count(*) FROM iam.authorization_attempts')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM iam.users')).rows[0].count, '1');
    provider.faults.authorizationError = '';
    await page.screenshot({path: join(screenshots, `cancel-${width}.png`)});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({width, registration: 'passed', reload: 'passed', logout: 'passed', cancellation: 'passed', noPageErrors: 'passed', noOverflow: 'passed'}));
    await context.close();
  }
  console.log(JSON.stringify({screenshots}));
} finally {
  await browser?.close();
  await vite?.close();
  await api.close();
  await provider.close();
  await pool.end();
  if (previousApiOrigin === undefined) delete process.env.FORUM_API_ORIGIN;
  else process.env.FORUM_API_ORIGIN = previousApiOrigin;
}
