import {PgBoss} from 'pg-boss';
import type {ImportResult,OkpdSync} from './okpd2-sync.js';

export const OKPD_QUEUE='forum.okpd2.sync';
export const REFERENCE_JOBS_SCHEMA='forum_okpd2_jobs';
export const OKPD_CRON='0 1 * * 6';
export const OKPD_TIMEZONE='Europe/Moscow';
const QUEUE_OPTIONS={policy:'exclusive' as const,retryLimit:3,retryDelay:60,retryBackoff:true,retryDelayMax:600,expireInSeconds:300,retentionSeconds:30*86400};

/** Run only with the schema owner's connection, outside the worker process. */
export async function bootstrapOkpdQueue(connectionString:string):Promise<void> {
  const boss=new PgBoss({connectionString,schema:REFERENCE_JOBS_SCHEMA,migrate:true,schedule:false,supervise:false});
  boss.on('error',()=>console.error(JSON.stringify({event:'reference_queue_error'})));
  try {
    await boss.start();await boss.createQueue(OKPD_QUEUE,QUEUE_OPTIONS);
    const {policy:_,...mutable}=QUEUE_OPTIONS;
    await boss.updateQueue(OKPD_QUEUE,mutable);
  } finally {await boss.stop();}
}

export async function configureOkpdSchedule(boss:PgBoss):Promise<void> {
  await boss.schedule(OKPD_QUEUE,OKPD_CRON,null,{tz:OKPD_TIMEZONE,missed:'once',singletonKey:'okpd2'});
}

export async function registerOkpdWorker(boss:PgBoss,sync:OkpdSync,
  report:(result:ImportResult)=>void=r=>console.log(JSON.stringify({event:'okpd_import',...r}))):Promise<void> {
  await boss.work(OKPD_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async()=>{
    const result=await sync.run();
    if(result.status==='busy')throw new Error('OKPD import busy');
    report(result);return result;
  });
}
