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
    const layout = (await client.query(`SELECT to_regclass('public.schema_migrations') AS public_ledger,
      to_regclass('iam.schema_migrations') AS legacy_ledger`)).rows[0];
    if (layout?.legacy_ledger) throw new Error('Legacy installation requires the reviewed consolidation transfer, not an in-place profile migration');
    if (layout?.public_ledger) {
      const marker = await client.query("SELECT name FROM public.schema_migrations WHERE name='003_public_schema'");
      if (!marker.rowCount) throw new Error('Public installation is missing migration003');
      const oldSchemas=await client.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('iam','profiles','audit','integration','party')");
      if(oldSchemas.rowCount) throw new Error('Legacy schemas remain despite consolidation marker');
    } else {
      const oldSchemas=await client.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('iam','profiles','audit','integration','party')");
      if(oldSchemas.rowCount) throw new Error('Legacy schemas require the reviewed consolidation transfer');
      await client.query('CREATE SCHEMA iam');
      await client.query('CREATE TABLE iam.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const name of ['001_sber_identity','002_profiles','003_public_schema']) {
        await client.query(await readFile(resolve(`migrations/${name}.sql`), 'utf8'));
        const ledger = name === '003_public_schema' ? 'public' : 'iam';
        await client.query(`INSERT INTO ${ledger}.schema_migrations(name) VALUES ($1)`, [name]);
      }
    }
    for (const name of ['005_public_individual_role','006_person_memberships','007_my_organizations']) {
      const applied = await client.query('SELECT name FROM public.schema_migrations WHERE name = $1', [name]);
      if (!applied.rowCount) {
        const sql = await readFile(resolve(`migrations/${name}.sql`), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations(name) VALUES ($1)', [name]);
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
