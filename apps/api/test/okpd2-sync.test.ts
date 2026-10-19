import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {okpdTestDatabase} from './okpd2-test-database.js';
import {migrate} from '../src/migrate.js';
import {fixture} from './okpd2-fixture.js';
import {normalizeSnapshot} from '../src/references/okpd2-model.js';
let database:Awaited<ReturnType<typeof okpdTestDatabase>>,Sync:any;
const syncPath='../src/references/okpd2-sync.js',migrationPath='../src/references/okpd2-migrate.js';
before(async()=>{database=await okpdTestDatabase();await migrate(database.pool);const m=await import(migrationPath).catch(()=>({}));if(m.migrateOkpd)await m.migrateOkpd(database.pool);Sync=(await import(syncPath).catch(()=>({}))).OkpdSync});
beforeEach(async()=>{if(Sync){await database.pool.query('TRUNCATE public.okpds,public.okpd_sections,public.okpd_imports,public.okpd_reference_state RESTART IDENTITY CASCADE');await database.pool.query("INSERT INTO public.okpd_reference_state(id) VALUES ('okpd2')")}});
after(async()=>{await database?.close()});
function service(source=async()=>normalizeSnapshot(fixture())){assert.equal(typeof Sync,'function','OKPD2 transactional publisher is missing');return new Sync(database.pool,source)}
const pool=()=>database.pool;
test('first import publishes source metadata; repeated snapshot leaves rows and revision unchanged',async()=>{
 const s=service();assert.equal((await s.run()).status,'published');const rows=(await pool().query('SELECT okpd,updated_at FROM public.okpds ORDER BY okpd')).rows;
 assert.equal((await s.run()).status,'unchanged');assert.deepEqual((await pool().query('SELECT okpd,updated_at FROM public.okpds ORDER BY okpd')).rows,rows);
 const state=(await pool().query('SELECT revision,source_metadata,last_checked_at FROM public.okpd_reference_state')).rows[0];assert.equal(state.revision,'1');assert.equal(state.source_metadata.edition,'148/2026');assert.ok(state.last_checked_at);
});
test('removal requires review and approval retires the code without deleting foreign-key links',async()=>{
 await service().run();await pool().query('CREATE TABLE IF NOT EXISTS public.okpd_test_links(code varchar(12) REFERENCES public.okpds(okpd))');await pool().query("INSERT INTO public.okpd_test_links VALUES ('01.1')");
 const s=service(async()=>normalizeSnapshot(fixture('Root',false))),r=await s.run();assert.equal(r.status,'pending_review');
 await assert.rejects(s.decide(r.id,'approve','wrong','admin:8','Verified deletion'),/hash/i);
 assert.equal((await s.decide(r.id,'approve',r.hash,'admin:8','Verified source')).status,'published');assert.equal((await pool().query("SELECT is_active FROM public.okpds WHERE okpd='01.1'")).rows[0].is_active,false);
 assert.equal((await pool().query('SELECT count(*) FROM public.okpd_test_links')).rows[0].count,'1');
});
test('rejection is remembered and unchanged replay never bypasses administrator decision',async()=>{
 await service().run();const s=service(async()=>normalizeSnapshot(fixture('Root',false))),r=await s.run();await s.decide(r.id,'reject',r.hash,'admin:8','Unconfirmed deletion');assert.equal((await s.run()).status,'rejected');assert.equal((await pool().query('SELECT count(*) FROM public.okpds WHERE is_active')).rows[0].count,'2');
});
test('approval requires a reason and preserves the pending candidate when it is missing',async()=>{
 await service().run();const s=service(async()=>normalizeSnapshot(fixture('Root',false))),r=await s.run();
 await assert.rejects(s.decide(r.id,'approve',r.hash,'admin:8','  '),/reason/i);
 const row=(await pool().query('SELECT status,decided_by,decision_reason FROM public.okpd_imports WHERE id=$1',[r.id])).rows[0];
 assert.deepEqual(row,{status:'pending_review',decided_by:null,decision_reason:null});
 assert.equal((await pool().query('SELECT count(*) FROM public.okpds WHERE is_active')).rows[0].count,'2');
});
test('stale candidate cannot overwrite a newer publication or manual drift',async()=>{
 await service().run();const a=service(async()=>normalizeSnapshot(fixture('Proposal'))),r=await a.run();const b=service(async()=>normalizeSnapshot(fixture('Latest'))),n=await b.run();await b.decide(n.id,'approve',n.hash,'admin:8','Verified source');await assert.rejects(a.decide(r.id,'approve',r.hash,'admin:8','Verified source'),/stale/i);
 const c=await a.run();await pool().query("UPDATE public.okpds SET name='Manual' WHERE okpd='01'");await assert.rejects(a.decide(c.id,'approve',c.hash,'admin:8','Verified source'),/stale/i);
});
test('SQL failure rolls back every row and records sanitized failure',async()=>{
 const s=service();await pool().query("ALTER TABLE public.okpds ADD CONSTRAINT reject_child CHECK(okpd<>'01.1')");try{await assert.rejects(s.run());assert.equal((await pool().query('SELECT count(*) FROM public.okpds')).rows[0].count,'0');assert.equal((await pool().query('SELECT status FROM public.okpd_imports')).rows[0].status,'failed')}finally{await pool().query('ALTER TABLE public.okpds DROP CONSTRAINT reject_child')}
});
test('network or invalid source keeps the previous publication',async()=>{
 await service().run();await assert.rejects(service(async()=>{throw new TypeError('private transport details')}).run());assert.equal((await pool().query('SELECT count(*) FROM public.okpds')).rows[0].count,'2');const r=(await pool().query('SELECT status,error FROM public.okpd_imports ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(r.status,'failed');assert.doesNotMatch(r.error,/private/);
});
test('concurrent run returns busy before accessing the source',async()=>{
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const first=service(async()=>{entered();await wait;return normalizeSnapshot(fixture())}).run();await ready;
 try{assert.equal((await service(async()=>{throw new Error('Must not fetch')}).run()).status,'busy')}finally{release();await first}
});
test('lower source edition with identical rows waits for review',async()=>{
 await service().run();const r=await service(async()=>normalizeSnapshot({...fixture(),edition:'147/2026'})).run();assert.equal(r.status,'pending_review');assert.ok(r.reasons.includes('older_edition'));
});
test('unchanged data retains the new archive receipt without changing publication revision',async()=>{
 await service().run();assert.equal((await service(async()=>normalizeSnapshot({...fixture(),archiveHash:'b'.repeat(64)})).run()).status,'unchanged');
 const r=(await pool().query('SELECT source_metadata FROM public.okpd_imports ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(r.source_metadata.archiveHash,'b'.repeat(64));
});
test('manual approval does not claim a newer check of the official source',async()=>{
 await service().run();const s=service(async()=>normalizeSnapshot(fixture('Root',false))),r=await s.run();await pool().query("UPDATE public.okpd_reference_state SET last_checked_at='2026-10-01T00:00:00Z'");await s.decide(r.id,'approve',r.hash,'admin:8','Verified source');
 assert.equal((await pool().query('SELECT last_checked_at FROM public.okpd_reference_state')).rows[0].last_checked_at.toISOString(),'2026-10-01T00:00:00.000Z');
});
