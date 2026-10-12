import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {referenceTestDatabase} from './reference-test-database.js';
import {migrate} from '../src/migrate.js';
import {normalizeSnapshot,snapshotHash} from '../src/references/okved-model.js';
import {migrateReferences} from '../src/references/migrate.js';
import {OkvedSync} from '../src/references/okved-sync.js';

let pool:Pool;
let database:Awaited<ReturnType<typeof referenceTestDatabase>>;
const snapshot=(name='Child',includeLeaf=true)=>normalizeSnapshot({okveds:[
  {code:'01',group:'A',name:'Root',selectable:false},
  {code:'01.1',group:'A',name:'Parent',selectable:false},
  {code:'01.11',group:'A',name,selectable:true},
  ...(includeLeaf?[{code:'01.11.1',group:'A',name:'Leaf',selectable:true}]:[]),
]},{groups:[{code:'A',name:'Agriculture',size:includeLeaf?2:1}]});

before(async()=>{
  database=await referenceTestDatabase();pool=database.pool;
  await migrate(pool);
  await migrateReferences(pool);await migrateReferences(pool);
  await pool.query('CREATE TABLE IF NOT EXISTS public.okved_test_links (code varchar(8) REFERENCES public.okveds(okved))');
});
beforeEach(async()=>{
  await pool.query('TRUNCATE public.okved_test_links,public.okveds,public.okved_groups,public.okved_imports,public.okved_reference_state RESTART IDENTITY');
  await pool.query("INSERT INTO public.okved_reference_state(id,revision) VALUES ('okved2',0)");
});
after(async()=>{await database?.close();});

test('first import publishes atomically; repeated data leaves timestamps and revision unchanged',async()=>{
  const sync=new OkvedSync(pool,async()=>snapshot());
  assert.equal((await sync.run()).status,'published');
  const before=(await pool.query('SELECT okved,updated_at FROM public.okveds ORDER BY okved')).rows;
  assert.equal((await sync.run()).status,'unchanged');
  assert.deepEqual((await pool.query('SELECT okved,updated_at FROM public.okveds ORDER BY okved')).rows,before);
  assert.equal((await pool.query('SELECT revision FROM public.okved_reference_state')).rows[0].revision,'1');
});

test('removal waits for review; accepting retires the code while retaining company links and internal fields',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  await pool.query("INSERT INTO public.business_segments(code,name) VALUES ('segment','Segment') ON CONFLICT DO NOTHING");
  await pool.query("UPDATE public.okveds SET business_segment_code='segment' WHERE okved='01.11.1'");
  await pool.query("INSERT INTO public.okved_test_links(code) VALUES ('01.11.1')");
  const sync=new OkvedSync(pool,async()=>snapshot('Child',false)),r=await sync.run();
  assert.equal(r.status,'pending_review');
  assert.equal((await pool.query("SELECT is_active FROM public.okveds WHERE okved='01.11.1'")).rows[0].is_active,true);
  await assert.rejects(sync.decide(r.id!,'approve','wrong-hash','admin:8'),/hash/i);
  assert.equal((await sync.decide(r.id!,'approve',snapshotHash(snapshot('Child',false)),'admin:8')).status,'published');
  const row=(await pool.query("SELECT is_active,business_segment_code FROM public.okveds WHERE okved='01.11.1'")).rows[0];
  assert.deepEqual(row,{is_active:false,business_segment_code:'segment'});
  assert.equal((await pool.query('SELECT count(*) FROM public.okved_test_links')).rows[0].count,'1');
});

test('rejected version stays rejected when the identical snapshot arrives again',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  const sync=new OkvedSync(pool,async()=>snapshot('Child',false)),r=await sync.run();
  await sync.decide(r.id!,'reject',r.hash!,'admin:8','Unconfirmed removal');
  assert.equal((await sync.run()).status,'rejected');
  assert.equal((await pool.query('SELECT count(*) FROM public.okveds WHERE is_active')).rows[0].count,'4');
});

test('a snapshot prepared against an older published revision cannot overwrite a newer one',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  const sync=new OkvedSync(pool,async()=>snapshot('Old proposal')),r=await sync.run();
  const latest=new OkvedSync(pool,async()=>snapshot('New proposal')),n=await latest.run();
  await latest.decide(n.id!,'approve',n.hash!,'admin:8');
  await assert.rejects(sync.decide(r.id!,'approve',r.hash!,'admin:8'),/stale/i);
  assert.equal((await pool.query("SELECT name FROM public.okveds WHERE okved='01.11'")).rows[0].name,'New proposal');
});

test('publication SQL failure rolls back every row and records a failed run',async()=>{
  await pool.query("ALTER TABLE public.okveds ADD CONSTRAINT reject_leaf_test CHECK (okved <> '01.11.1')");
  try {
    await assert.rejects(new OkvedSync(pool,async()=>snapshot()).run());
    assert.equal((await pool.query('SELECT count(*) FROM public.okveds')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT status FROM public.okved_imports')).rows[0].status,'failed');
  } finally {await pool.query('ALTER TABLE public.okveds DROP CONSTRAINT reject_leaf_test');}
});

test('network failure retains the published dictionary and produces a failed audit record',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  await assert.rejects(new OkvedSync(pool,async()=>{throw new Error('FNS HTTP 503');}).run());
  assert.equal((await pool.query('SELECT count(*) FROM public.okveds')).rows[0].count,'4');
  assert.equal((await pool.query('SELECT status FROM public.okved_imports ORDER BY id DESC LIMIT 1')).rows[0].status,'failed');
});

test('concurrent sync does not download or publish while another run owns the lock',async()=>{
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  const first=new OkvedSync(pool,async()=>{entered();await wait;return snapshot();}).run();
  await ready;
  try {
    const second=await new OkvedSync(pool,async()=>{throw new Error('Must not fetch');}).run();
    assert.equal(second.status,'busy');
  } finally {release();await first;}
  assert.equal((await pool.query('SELECT count(*) FROM public.okved_imports')).rows[0].count,'1');
});

test('manual drift of source-owned columns also invalidates a pending approval',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  const sync=new OkvedSync(pool,async()=>snapshot('Proposal')),r=await sync.run();
  await pool.query("UPDATE public.okveds SET name='Manual correction' WHERE okved='01'");
  await assert.rejects(sync.decide(r.id!,'approve',r.hash!,'admin:8'),/stale/i);
});

test('a source that returns to the published content supersedes its previous pending candidate',async()=>{
  await new OkvedSync(pool,async()=>snapshot()).run();
  const sync=new OkvedSync(pool,async()=>snapshot('Proposal')),candidate=await sync.run();
  assert.equal(candidate.status,'pending_review');
  assert.equal((await new OkvedSync(pool,async()=>snapshot()).run()).status,'unchanged');
  await assert.rejects(sync.decide(candidate.id!,'approve',candidate.hash!,'admin:8'),/stale/i);
});

test('a previously rejected snapshot still requires review after the baseline changes',async()=>{
  const many=(name:string,withLast=true)=>normalizeSnapshot({okveds:Array.from({length:20},(_,i)=>({
    code:String(i+1).padStart(2,'0'),group:'A',name:i===0?name:'Code '+(i+1),selectable:true,
  })).filter(x=>withLast || x.code!=='20')},{groups:[{code:'A',name:'A',size:withLast?20:19}]});
  await new OkvedSync(pool,async()=>many('First')).run();
  const sync=new OkvedSync(pool,async()=>many('First',false)),rejected=await sync.run();
  await sync.decide(rejected.id!,'reject',rejected.hash!,'admin:8','Unconfirmed deletion');
  const other=new OkvedSync(pool,async()=>many('Second',false)),candidate=await other.run();
  await other.decide(candidate.id!,'approve',candidate.hash!,'admin:8');
  const retried=await sync.run();
  assert.equal(retried.status,'pending_review');
  assert.ok(retried.reasons?.includes('previously_rejected'));
});
