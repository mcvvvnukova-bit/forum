import {PgBoss} from 'pg-boss';
import type {ImportResult,OkvedSync} from './okved-sync.js';

export const OKVED_QUEUE='forum.okved2.sync';
export const REFERENCE_JOBS_SCHEMA='forum_reference_jobs';
export const OKVED_CRON='0 1 * * 6';
export const OKVED_TIMEZONE='Europe/Moscow';
const QUEUE_OPTIONS={policy:'exclusive' as const,retryLimit:3,retryDelay:60,retryBackoff:true,retryDelayMax:600,expireInSeconds:300,retentionSeconds:30*86400};

/** Run only with the schema owner's connection, outside the worker process. */
export async function bootstrapReferenceQueue(connectionString:string):Promise<void> {
  const boss=new PgBoss({connectionString,schema:REFERENCE_JOBS_SCHEMA,migrate:true,schedule:false,supervise:false});
  boss.on('error',()=>console.error(JSON.stringify({event:'reference_queue_error'})));
  try {
    await boss.start();await boss.createQueue(OKVED_QUEUE,QUEUE_OPTIONS);
    const {policy:_,...mutable}=QUEUE_OPTIONS;
    await boss.updateQueue(OKVED_QUEUE,mutable);
  } finally {await boss.stop();}
}

export async function configureOkvedSchedule(boss:PgBoss):Promise<void> {
  await boss.schedule(OKVED_QUEUE,OKVED_CRON,null,{tz:OKVED_TIMEZONE,missed:'once',singletonKey:'okved2'});
}

export async function registerOkvedWorker(boss:PgBoss,sync:OkvedSync,
  report:(result:ImportResult)=>void=r=>console.log(JSON.stringify({event:'okved_import',...r}))):Promise<void> {
  await boss.work(OKVED_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async()=>{
    const result=await sync.run();
    if(result.status==='busy')throw new Error('OKVED import busy');
    report(result);return result;
  });
}
