import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {testDatabaseUrl} from './test-database.js';

const sensitive = 'private-test-password';
const local = `postgres://postgres:${sensitive}@127.0.0.1:55439/forum_browser_test`;
const invalid = [
  `${local}?host=external.example`, `${local}?dbname=forum`, `${local}?port=5432`, `${local}?sslmode=require`,
  `${local}#fragment`, local.replace('postgres:', 'https:'), local.replace('127.0.0.1', 'external.example'),
  local.replace('forum_browser_test', 'forum'), local.replace('forum_browser_test', '%2Fforum_test'),
  local.replace('forum_browser_test', 'forum%00_test'), 'not a URL', undefined,
];
for (const [index, value] of invalid.entries()) {
  test(`invalid test database URL ${index} is rejected without exposing credentials`, () => {
    assert.throws(() => testDatabaseUrl(value), error => error instanceof Error &&
      error.message.includes('dedicated local PostgreSQL') && !error.message.includes(sensitive) && !error.message.includes('external.example'));
  });
}

test('valid local dedicated database names support postgres and postgresql plus decoded names', () => {
  for (const url of [local, local.replace('postgres:', 'postgresql:'), local.replace('127.0.0.1', 'localhost'),
    local.replace('127.0.0.1', '[::1]'), local.replace('forum_browser_test', 'forum_browser_%74est')]) {
    assert.equal(testDatabaseUrl(url), url);
  }
});

test('browser and destructive API suite reject query overrides before resources or network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-database-guard-'));
  try {
    const requireFromApi = pathToFileURL(resolve('package.json')).href;
    const sentinel = join(dir, 'sentinel.mjs');
    writeFileSync(sentinel, `import {createRequire, syncBuiltinESMExports} from 'node:module';
      import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns';
      const forbidden = () => { throw new Error('RESOURCE_INVOKED_BEFORE_VALIDATION'); };
      const pg = createRequire(${JSON.stringify(requireFromApi)})('pg'); pg.Pool = class {constructor() {forbidden();}};
      net.connect = forbidden; net.createConnection = forbidden; net.Server.prototype.listen = forbidden;
      tls.connect = forbidden; dns.lookup = forbidden; syncBuiltinESMExports();`);
    for (const script of ['test/browser-smoke.mjs', '.test-build/test/auth.test.js']) {
      const result = spawnSync(process.execPath, ['--import', sentinel, script], {
        encoding: 'utf8', timeout: 15000,
        env: {...process.env, TEST_DATABASE_URL: `${local}?host=external.example`},
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes('dedicated local PostgreSQL'), `${script}: expected validation failure`);
      assert.ok(!output.includes('RESOURCE_INVOKED_BEFORE_VALIDATION'), `${script}: resources invoked`);
      assert.ok(!output.includes(sensitive), `${script}: credential disclosed`);
    }
  } finally {rmSync(dir, {recursive: true, force: true});}
});
