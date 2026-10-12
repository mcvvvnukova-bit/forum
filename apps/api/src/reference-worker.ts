import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {referenceDatabaseUrl} from './references/config.js';
import {OkvedSync} from './references/okved-sync.js';
import {configureOkvedSchedule,registerOkvedWorker,REFERENCE_JOBS_SCHEMA,OKVED_CRON,OKVED_TIMEZONE,OKVED_QUEUE} from './references/okved-worker.js';

export async function startReferenceWorker():Promise<()=>Promise<void>> {
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
    const state=(await pool.query("SELECT revision FROM public.okved_reference_state WHERE id='okved2'")).rows[0];
    if(!state)throw new Error('Reference state missing');
    await boss.start();await configureOkvedSchedule(boss);await registerOkvedWorker(boss,new OkvedSync(pool));
    if(state.revision==='0')await boss.send(OKVED_QUEUE,null,{singletonKey:'okved2'});
    console.log(JSON.stringify({event:'okved_worker_started',cron:OKVED_CRON,timezone:OKVED_TIMEZONE}));
    return stop;
  } catch(error) {await stop();throw error;}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const stop=await startReferenceWorker();
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().catch(()=>{process.exitCode=1;});});
  } catch {console.error(JSON.stringify({event:'reference_worker_start_failed',hint:'Check migrations and database access'}));process.exitCode=1;}
}
