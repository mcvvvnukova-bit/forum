import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'forum-caddy-relay-'));
const fragment = readFileSync(new URL('./sber-callback-relay.caddy', import.meta.url), 'utf8');
writeFileSync(join(dir, 'Caddyfile'), `{
  admin off
}
:80 {
  @main host astforum.ru
  handle @main {
    header Referrer-Policy strict-origin-when-cross-origin
    ${fragment}
    @home path /
    respond @home "unchanged-placeholder" 200
    respond 404
  }
  respond "unrelated-host" 404
}
`);
let container;
try {
  container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::80',
    '--mount', `type=bind,src=${dir},dst=/etc/caddy,readonly`, 'caddy:2.10-alpine'], {encoding: 'utf8'}).trim();
  const address = execFileSync('docker', ['port', container, '80/tcp'], {encoding: 'utf8'}).trim();
  const origin = `http://${address}`;
  const get = (path, method = 'GET', host = 'astforum.ru') => new Promise((resolve, reject) => {
    const req = request(`${origin}${path}`, {method, headers: {Host: host}, timeout: 5000}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve(new Response(Buffer.concat(chunks),
        {status: response.statusCode, headers: response.headers})));
    });
    req.once('timeout', () => req.destroy(new Error('Caddy request timed out')));
    req.once('error', reject);
    req.end();
  });
  for (let i = 0; ; i++) {
    try { const response = await get('/'); await response.body?.cancel(); break; }
    catch (error) { if (i === 30) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  for (const query of ['', '?code=a%2Bb%2Fc%3D&state=test-state',
    '?error=access_denied&state=test-state&error_description=Not+allowed',
    '?code=x&state=y&next=https%3A%2F%2Fother.example']) {
    const response = await get(`/authorization${query}`);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `https://dev.astforum.ru/authorization${query}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('set-cookie'), null);
    await response.body?.cancel();
  }
  const homepage = await get('/');
  assert.equal(homepage.status, 200);
  assert.equal(await homepage.text(), 'unchanged-placeholder');
  for (const [path, method, host] of [
    ['/authorization', 'HEAD', 'astforum.ru'], ['/authorization', 'POST', 'astforum.ru'],
    ['/authorization/', 'GET', 'astforum.ru'], ['/auth/sber-id/start', 'GET', 'astforum.ru'],
    ['/api/auth/session', 'GET', 'astforum.ru'], ['/authorization', 'GET', 'dev.astforum.ru'],
    ['/authorization', 'GET', 'docs.astforum.ru'],
  ]) {
    const response = await get(path, method, host);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    await response.body?.cancel();
  }
  console.log('PASS: fixed callback destination, exact query, no-store/no-referrer, and unchanged unrelated routes.');
} finally {
  if (container) execFileSync('docker', ['rm', '-f', container], {stdio: 'ignore'});
  rmSync(dir, {recursive: true});
}
