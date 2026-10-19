import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {referenceDatabaseUrl} from './references/okpd2-config.js';
import {loadRosstatSnapshot} from './references/okpd2-source.js';
import {snapshotHash} from './references/okpd2-model.js';
import {migrateOkpd} from './references/okpd2-migrate.js';
import {OkpdSync} from './references/okpd2-sync.js';
import {bootstrapOkpdQueue} from './references/okpd2-worker.js';

export async function okpdCommand(args:string[]):Promise<unknown> {
  const [command,id,hash,actor,...reason]=args;
  if(command==='preview') {
    const snapshot=await loadRosstatSnapshot();
    return {hash:snapshotHash(snapshot),codes:snapshot.items.length,sections:snapshot.sections.length,edition:snapshot.edition,publishedDate:snapshot.publishedDate,archiveHash:snapshot.archiveHash};
  }
  if(!['migrate','sync','list','show','approve','reject'].includes(command??'')) {
    throw new Error('Usage: reference-cli preview | migrate | sync | list | show ID | approve ID HASH OPERATOR | reject ID HASH OPERATOR REASON');
  }
  if(['show','approve','reject'].includes(command) && !/^[1-9]\d*$/.test(id??''))throw new Error('Positive import ID required');
  if(['approve','reject'].includes(command) && (!/^[a-f0-9]{64}$/.test(hash??'') || !actor?.trim()))throw new Error('Expected SHA-256 hash and operator required');
  const databaseUrl=referenceDatabaseUrl();
  const pool=new Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:10_000,statement_timeout:60_000});
  try {
    if(command==='migrate') {await migrateOkpd(pool);await bootstrapOkpdQueue(databaseUrl);return {status:'migrated'};}
    if(command==='sync')return new OkpdSync(pool).run();
    if(command==='list')return (await pool.query(`SELECT id,status,started_at,finished_at,snapshot_hash,review_reasons,error,decided_by,decision_reason
      FROM public.okpd_imports ORDER BY id DESC LIMIT 50`)).rows;
    if(command==='show')return (await pool.query('SELECT id,status,started_at,finished_at,snapshot_hash,base_revision,diff,review_reasons,error,decided_by,decided_at,decision_reason FROM public.okpd_imports WHERE id=$1',[id])).rows[0]??null;
    return await new OkpdSync(pool).decide(id!,command==='approve'?'approve':'reject',hash!,actor!,reason.join(' '));
  } finally {await pool.end();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await okpdCommand(process.argv.slice(2)),null,2));}
  catch {console.error('OKPD2 command failed; check migration, source and operator inputs');process.exitCode=1;}
}
