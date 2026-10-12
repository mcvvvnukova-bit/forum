import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';

export async function migrateReferences(pool:Pool):Promise<void> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-reference-migrations'))");
    const ledger=(await client.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0]?.ledger;
    if (!ledger || !(await client.query("SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema'")).rowCount) {
      throw new Error('Run core migrations before reference migrations');
    }
    await client.query('CREATE TABLE IF NOT EXISTS public.okved_schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const name='001_okved_fns';
    if (!(await client.query('SELECT 1 FROM public.okved_schema_migrations WHERE name=$1',[name])).rowCount) {
      await client.query(await readFile(resolve(`reference-migrations/${name}.sql`),'utf8'));
      await client.query('INSERT INTO public.okved_schema_migrations(name) VALUES ($1)',[name]);
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
