import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PgBoss,TestClock} from 'pg-boss';
import {referenceTestDatabase} from './reference-test-database.js';
import {migrateReferences} from '../src/references/migrate.js';
import {migrate} from '../src/migrate.js';
import {normalizeSnapshot} from '../src/references/okved-model.js';
import {OkvedSync} from '../src/references/okved-sync.js';
import {bootstrapReferenceQueue,configureOkvedSchedule,registerOkvedWorker,OKVED_QUEUE} from '../src/references/okved-worker.js';

test('durable queue runs the import; schedule is idempotent and fires Saturday at 01:00 Moscow',async()=>{
  const database=await referenceTestDatabase(),connectionString=database.url,pool=database.pool;
  await migrate(pool);
  await migrateReferences(pool);
  await bootstrapReferenceQueue(connectionString);
  const boss=new PgBoss({connectionString,schema:'forum_reference_jobs',migrate:false,schedule:false,supervise:false});
  boss.on('error',()=>{});
  try {
    await boss.start();await boss.deleteAllJobs(OKVED_QUEUE);
    await configureOkvedSchedule(boss);await configureOkvedSchedule(boss);
    const schedules=await boss.getSchedules(OKVED_QUEUE);
    assert.equal(schedules.length,1);
    const next=boss.previewSchedule(schedules[0].cron,{tz:schedules[0].timezone,from:new Date('2026-10-12T00:00:00Z'),count:2});
    assert.deepEqual(next.map(x=>x.toISOString()),['2026-10-16T22:00:00.000Z','2026-10-23T22:00:00.000Z']);
    assert.equal(schedules[0].options?.missed,'once');
    await pool.query('TRUNCATE public.okveds,public.okved_groups,public.okved_imports,public.okved_reference_state RESTART IDENTITY');
    await pool.query("INSERT INTO public.okved_reference_state(id) VALUES ('okved2')");
    let completed!:(status:string)=>void;
    const done=new Promise<string>(r=>completed=r);
    const sync=new OkvedSync(pool,async()=>normalizeSnapshot({okveds:[{code:'01',group:'A',name:'Root',selectable:true}]},
      {groups:[{code:'A',name:'Agriculture',size:1}]}));
    await registerOkvedWorker(boss,sync,r=>completed(r.status));
    await boss.send(OKVED_QUEUE);
    assert.equal(await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Worker timed out')),8000).unref())]),'published');
    assert.equal((await pool.query('SELECT count(*) FROM public.okveds')).rows[0].count,'1');
  } finally {await boss.stop({graceful:true,timeout:10_000});await database.close();}
});

test('after two missed Saturdays the scheduler enqueues one catch-up import',async()=>{
  const database=await referenceTestDatabase(),clock=new TestClock('2026-10-12T00:00:00Z');
  const boss=new PgBoss({connectionString:database.url,schema:'forum_reference_jobs',migrate:false,supervise:false,clock});
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
