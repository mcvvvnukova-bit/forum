import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';
export async function migrateOkpd(pool:Pool):Promise<void>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-okpd2-migrations'))");
  if(!(await client.query("SELECT 1 FROM public.schema_migrations WHERE name='008_iam_roles'")).rowCount)throw new Error('Core migrations required');
  await client.query('CREATE TABLE IF NOT EXISTS public.okpd_schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  const name='001_okpd2_rosstat';
  if(!(await client.query('SELECT 1 FROM public.okpd_schema_migrations WHERE name=$1',[name])).rowCount){await client.query(await readFile(resolve('migrations/references/'+name+'.sql'),'utf8'));await client.query('INSERT INTO public.okpd_schema_migrations(name) VALUES ($1)',[name])}
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
