import {Pool} from 'pg';
import {testDatabaseUrl} from './test-database.js';

// Authentication migration tests deliberately reset their layout. Reference tests own
// a different disposable database so their tables cannot interfere with those resets.
export async function referenceTestDatabase():Promise<{pool:Pool;url:string;close:()=>Promise<void>}> {
  const base=testDatabaseUrl(process.env.TEST_DATABASE_URL),parsed=new URL(base);
  const name=`forum_okved_${process.pid}_test`;
  const control=new Pool({connectionString:base});
  await control.query(`CREATE DATABASE "${name}"`);
  parsed.pathname='/'+name;const url=testDatabaseUrl(parsed.href),pool=new Pool({connectionString:url});
  return {pool,url,close:async()=>{
    try {await pool.end();await control.query(`DROP DATABASE "${name}"`);}
    finally {await control.end();}
  }};
}
