import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {loadConfig} from './config.js';

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-auth-migrations'))");
    const publicLedger = await client.query("SELECT to_regclass('public.schema_migrations') AS ledger");
    if (publicLedger.rows[0]?.ledger) {
      throw new Error('This legacy Sandbox migrator cannot modify a public-schema installation. Use deployment/forum-db/apply-public.psql.');
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS iam');
    await client.query('CREATE TABLE IF NOT EXISTS iam.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    // Profile/public-schema migrations belong to their separate deployment task.
    for (const name of ['001_sber_identity', '004_individual_role']) {
      const applied = await client.query('SELECT name FROM iam.schema_migrations WHERE name = $1', [name]);
      if (!applied.rowCount) {
        const sql = await readFile(resolve(`migrations/${name}.sql`), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO iam.schema_migrations(name) VALUES ($1)', [name]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig({...process.env, SBER_ID_ENABLED: 'false'});
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({connectionString: config.databaseUrl});
  try { await migrate(pool); console.log('Identity migrations applied'); }
  finally { await pool.end(); }
}
