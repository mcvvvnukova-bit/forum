import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {migrate} from '../src/migrate.js';

test('legacy migrator refuses consolidated installations without recreating iam', async () => {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return {rows: sql.includes('to_regclass') ? [{ledger: 'schema_migrations'}] : []};
    },
    release() { released = true; },
  };
  const pool = {async connect() { return client; }} as unknown as Pool;
  await assert.rejects(migrate(pool), /legacy Sandbox migrator cannot modify/);
  assert.equal(queries[0], 'BEGIN');
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(queries.every(sql => !/CREATE|ALTER|INSERT|COMMIT/.test(sql)));
  assert.equal(released, true);
});
