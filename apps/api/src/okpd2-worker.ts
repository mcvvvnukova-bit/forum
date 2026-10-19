import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {referenceDatabaseUrl} from './references/okpd2-config.js';
import {OkpdSync} from './references/okpd2-sync.js';
import {configureOkpdSchedule,registerOkpdWorker,REFERENCE_JOBS_SCHEMA,OKPD_CRON,OKPD_TIMEZONE,OKPD_QUEUE} from './references/okpd2-worker.js';

export async function startOkpdWorker():Promise<()=>Promise<void>> {
  const databaseUrl=referenceDatabaseUrl();
  const pool=new Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:10_000,statement_timeout:60_000});
  const boss=new PgBoss({connectionString:databaseUrl,schema:REFERENCE_JOBS_SCHEMA,migrate:false,reindex:false});
  boss.on('error',()=>console.error(JSON.stringify({event:'reference_queue_error'})));
  let stopped=false;
  const stop=async()=>{
    if(stopped)return;stopped=true;
    try {await boss.stop({graceful:true,timeout:60_000});} finally {await pool.end();}
  };
  try {
    const state=(await pool.query("SELECT revision FROM public.okpd_reference_state WHERE id='okpd2'")).rows[0];
    if(!state)throw new Error('Reference state missing');
    await boss.start();await configureOkpdSchedule(boss);await registerOkpdWorker(boss,new OkpdSync(pool));
    if(state.revision==='0')await boss.send(OKPD_QUEUE,null,{singletonKey:'okpd2'});
    console.log(JSON.stringify({event:'okpd_worker_started',cron:OKPD_CRON,timezone:OKPD_TIMEZONE}));
    return stop;
  } catch(error) {await stop();throw error;}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const stop=await startOkpdWorker();
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().catch(()=>{process.exitCode=1;});});
  } catch {console.error(JSON.stringify({event:'reference_worker_start_failed',hint:'Check migrations and database access'}));process.exitCode=1;}
}
