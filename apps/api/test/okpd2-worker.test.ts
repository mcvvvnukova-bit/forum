import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PgBoss,TestClock} from 'pg-boss';
import {okpdTestDatabase as referenceTestDatabase} from './okpd2-test-database.js';
import {migrateOkpd as migrateReferences} from '../src/references/okpd2-migrate.js';
import {migrate} from '../src/migrate.js';
import {normalizeSnapshot} from '../src/references/okpd2-model.js';
import {fixture} from './okpd2-fixture.js';
import {OkpdSync as OkvedSync} from '../src/references/okpd2-sync.js';
const workerPath='../src/references/okpd2-worker.js';
async function worker(){const m=await import(workerPath).catch(()=>({}));assert.equal(typeof m.configureOkpdSchedule,'function','OKPD2 durable worker is missing');return m;}

test('durable queue runs the import; schedule is idempotent and fires Saturday at 01:00 Moscow',async()=>{
  const {bootstrapOkpdQueue:bootstrapReferenceQueue,configureOkpdSchedule:configureOkvedSchedule,registerOkpdWorker:registerOkvedWorker,OKPD_QUEUE:OKVED_QUEUE}=await worker();
  const database=await referenceTestDatabase(),connectionString=database.url,pool=database.pool;
  await migrate(pool);
  await migrateReferences(pool);
  await bootstrapReferenceQueue(connectionString);
  const boss=new PgBoss({connectionString,schema:'forum_okpd2_jobs',migrate:false,schedule:false,supervise:false});
  boss.on('error',()=>{});
  try {
    await boss.start();await boss.deleteAllJobs(OKVED_QUEUE);
    await configureOkvedSchedule(boss);await configureOkvedSchedule(boss);
    const schedules=await boss.getSchedules(OKVED_QUEUE);
    assert.equal(schedules.length,1);
    const next=boss.previewSchedule(schedules[0].cron,{tz:schedules[0].timezone,from:new Date('2026-10-12T00:00:00Z'),count:2});
    assert.deepEqual(next.map((x:Date)=>x.toISOString()),['2026-10-16T22:00:00.000Z','2026-10-23T22:00:00.000Z']);
    assert.equal(schedules[0].options?.missed,'once');
    await pool.query('TRUNCATE public.okpds,public.okpd_sections,public.okpd_imports,public.okpd_reference_state RESTART IDENTITY');
    await pool.query("INSERT INTO public.okpd_reference_state(id) VALUES ('okpd2')");
    let completed!:(status:string)=>void;
    const done=new Promise<string>(r=>completed=r);
    const sync=new OkvedSync(pool,async()=>normalizeSnapshot(fixture('Root',false)));
    await registerOkvedWorker(boss,sync,(r:{status:string})=>completed(r.status));
    await boss.send(OKVED_QUEUE);
    assert.equal(await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Worker timed out')),8000).unref())]),'published');
    assert.equal((await pool.query('SELECT count(*) FROM public.okpds')).rows[0].count,'1');
  } finally {await boss.stop({graceful:true,timeout:10_000});await database.close();}
});

test('after two missed Saturdays the scheduler enqueues one catch-up import',async()=>{
  const {bootstrapOkpdQueue:bootstrapReferenceQueue,configureOkpdSchedule:configureOkvedSchedule,registerOkpdWorker:registerOkvedWorker,OKPD_QUEUE:OKVED_QUEUE}=await worker();
  const database=await referenceTestDatabase(),clock=new TestClock('2026-10-12T00:00:00Z');
  const boss=new PgBoss({connectionString:database.url,schema:'forum_okpd2_jobs',migrate:false,supervise:false,clock});
  boss.on('error',()=>{});
  try {
    await migrate(database.pool);await migrateReferences(database.pool);await bootstrapReferenceQueue(database.url);
    await boss.start();await configureOkvedSchedule(boss);await clock.tick(60_000);
    assert.equal((await boss.findJobs(OKVED_QUEUE)).length,0);
    await clock.setTime('2026-10-25T00:00:00Z');await clock.tick(60_000);
    for(let i=0;i<5 && !(await boss.findJobs(OKVED_QUEUE)).length;i++)await clock.tick(1000);
    assert.equal((await boss.findJobs(OKVED_QUEUE)).length,1);
    await clock.tick(60_000);assert.equal((await boss.findJobs(OKVED_QUEUE)).length,1);
  } finally {await boss.stop({graceful:true,timeout:10_000});await database.close();}
});
