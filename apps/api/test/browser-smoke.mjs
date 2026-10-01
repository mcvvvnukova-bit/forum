import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {createApp} from '../.test-build/src/app.js';
import {providerFixture} from '../.test-build/test/provider-fixture.js';

const landingRequire = createRequire(new URL('../../../deployment/dev-landing/package.json', import.meta.url));
const {chromium, expect} = landingRequire('@playwright/test');
const {createServer} = await import(pathToFileURL(landingRequire.resolve('vite')).href);
const connectionString = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test';
assert.ok(new URL(connectionString).pathname.endsWith('_test'));
const pool = new Pool({connectionString});
const provider = await providerFixture();
const config = {publicOrigin: 'http://127.0.0.1', databaseUrl: connectionString, secureCookies: false,
  sessionTtlSeconds: 3600, sber: provider.sber};
const api = await createApp(config, pool);
let vite;
let browser;
const previousApiOrigin = process.env.FORUM_API_ORIGIN;
try {
  await api.listen(0, '127.0.0.1');
  const target = await api.getUrl();
  process.env.FORUM_API_ORIGIN = target;
  const landingRoot = fileURLToPath(new URL('../../../deployment/dev-landing/', import.meta.url));
  vite = await createServer({root: landingRoot, configFile: `${landingRoot}vite.landing.config.ts`,
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
    await page.reload();
    await expect(page.getByRole('button', {name: 'Выйти'})).toBeVisible();
    await page.screenshot({path: `/private/tmp/forum-sber-session-${width}.png`});
    await page.getByRole('button', {name: 'Выйти'}).click();
    await expect(page.getByRole('link', {name: 'Регистрация', exact: true})).toBeVisible();
    const session = await page.request.get(`${origin}/api/auth/session`);
    assert.equal(session.status(), 401);
    await page.goto(`${origin}/?auth_error=access_denied`);
    await expect(page.getByRole('alert')).toContainText('Вы отменили вход через Сбер ID');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: `/private/tmp/forum-sber-error-${width}.png`});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({width, registration: 'passed', reload: 'passed', logout: 'passed', error: 'passed'}));
    await context.close();
  }
} finally {
  await browser?.close();
  await vite?.close();
  await api.close();
  await provider.close();
  await pool.end();
  if (previousApiOrigin === undefined) delete process.env.FORUM_API_ORIGIN;
  else process.env.FORUM_API_ORIGIN = previousApiOrigin;
}
