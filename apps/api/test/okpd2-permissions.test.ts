import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {okpdTestDatabase} from './okpd2-test-database.js';
import {migrate} from '../src/migrate.js';
import {migrateOkpd} from '../src/references/okpd2-migrate.js';
import {bootstrapOkpdQueue,configureOkpdSchedule,OKPD_QUEUE} from '../src/references/okpd2-worker.js';
import {OkpdSync} from '../src/references/okpd2-sync.js';
import {normalizeSnapshot} from '../src/references/okpd2-model.js';
import {fixture} from './okpd2-fixture.js';
test('worker publishes and schedules with only its private queue ownership and narrow classifier grants',async()=>{
 const db=await okpdTestDatabase(),url=new URL(db.url),container=process.env.TEST_DATABASE_CONTAINER;let restricted:Pool|undefined,boss:PgBoss|undefined;
 try{
  assert.ok(container&&/^[\w.-]+$/.test(container));
  await migrate(db.pool);await migrateOkpd(db.pool);await bootstrapOkpdQueue(db.url);
  await db.pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forum_okpd2_worker_test') THEN CREATE ROLE forum_okpd2_worker_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$");
  const script=await readFile('../../deployment/okpd2/grant-worker.sql','utf8');
  const grant=spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'psql','-X','-h','127.0.0.1','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-v','ON_ERROR_STOP=1','-v','worker_role=forum_okpd2_worker_test'],{input:script,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}});assert.equal(grant.status,0,grant.stderr);
  restricted=new Pool({connectionString:db.url,options:'-c role=forum_okpd2_worker_test'});
  assert.equal((await new OkpdSync(restricted,async()=>normalizeSnapshot(fixture())).run()).status,'published');
  for(const sql of ['SELECT id FROM public.users','UPDATE public.iam_role_assignments SET version=version+1','CREATE TABLE public.okpd_forbidden(id int)','DELETE FROM public.okpds',"UPDATE public.okpds SET okpd='99'"])await assert.rejects(restricted.query(sql),{code:'42501'});
  boss=new PgBoss({connectionString:db.url+'?options='+encodeURIComponent('-c role=forum_okpd2_worker_test'),schema:'forum_okpd2_jobs',migrate:false,reindex:false,schedule:false,supervise:false});boss.on('error',()=>{});
  await boss.start();await configureOkpdSchedule(boss);assert.equal((await boss.getSchedules(OKPD_QUEUE)).length,1);assert.ok(await boss.send(OKPD_QUEUE,null,{singletonKey:'okpd2'}));
 }finally{await boss?.stop();await restricted?.end();await db.close()}
});
test('explicit reference rollback preserves core IAM migrations and allows clean reinstall',async()=>{
 const db=await okpdTestDatabase();try{
  await migrate(db.pool);await migrateOkpd(db.pool);await migrateOkpd(db.pool);
  await db.pool.query(await readFile('migrations/references/001_okpd2_rosstat.down.sql','utf8'));
  assert.equal((await db.pool.query("SELECT count(*) FROM public.schema_migrations WHERE name='008_iam_roles'")).rows[0].count,'1');
  assert.equal((await db.pool.query("SELECT to_regclass('public.okpds') AS relation")).rows[0].relation,null);
  await migrateOkpd(db.pool);assert.equal((await db.pool.query("SELECT revision FROM public.okpd_reference_state WHERE id='okpd2'")).rows[0].revision,'0');
 }finally{await db.close()}
});
