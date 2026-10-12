import type {Pool,PoolClient} from 'pg';
import {FNS_BASE,loadFnsSnapshot} from './fns-source.js';
import {normalizeSnapshot,reviewReasons,snapshotDiff,snapshotHash,type OkvedSnapshot} from './okved-model.js';

export interface ImportResult {id?:string;status:string;hash?:string;reasons?:string[]}
const LOCK="SELECT pg_try_advisory_lock(hashtext('forum-okved2-sync')) AS locked";
const UNLOCK="SELECT pg_advisory_unlock(hashtext('forum-okved2-sync'))";

function failureCode(error:unknown):string {
  if(error instanceof Error) {
    const http=/^FNS HTTP (\d{3})$/.exec(error.message);if(http)return `fns_http_${http[1]}`;
    if(['TimeoutError','AbortError'].includes(error.name))return 'fns_timeout';
    if(error instanceof TypeError)return 'fns_transport';
    if(/^(Invalid|Duplicate|Missing|Incomplete|Empty|FNS .* (expected|required|large))/.test(error.message))return 'fns_contract';
  }
  if(error && typeof error==='object' && 'code' in error && typeof error.code==='string' && /^[A-Z0-9]{5}$/.test(error.code))return `database_${error.code}`;
  return 'import_failed';
}

async function current(client:PoolClient):Promise<{snapshot:OkvedSnapshot;inactive:Set<string>;revision:string}> {
  const codes=(await client.query('SELECT okved,section,name,description,selectable,parent_code,level,is_active FROM public.okveds ORDER BY okved')).rows;
  const groups=(await client.query('SELECT code,name,size FROM public.okved_groups WHERE is_active ORDER BY code')).rows;
  const revision=(await client.query("SELECT revision FROM public.okved_reference_state WHERE id='okved2' FOR UPDATE")).rows[0]?.revision;
  if (revision===undefined) throw new Error('Reference migrations required');
  return {revision,inactive:new Set(codes.filter(r=>!r.is_active).map(r=>r.okved)),snapshot:{
    groups:groups.map(g=>({code:g.code,name:g.name,size:g.size})),
    okveds:codes.filter(r=>r.is_active).map(r=>({code:r.okved,group:r.section,name:r.name,description:r.description,
      selectable:r.selectable,parentCode:r.parent_code,level:r.level})),
  }};
}

async function publish(client:PoolClient,snapshot:OkvedSnapshot,hash:string,id:string):Promise<void> {
  await client.query('UPDATE public.okved_groups SET is_active=false,updated_at=now() WHERE is_active AND NOT (code=ANY($1::text[]))',[snapshot.groups.map(g=>g.code)]);
  await client.query(`INSERT INTO public.okved_groups(code,name,size,is_active)
    SELECT code,name,size,true FROM jsonb_to_recordset($1::jsonb) AS x(code text,name text,size integer)
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,size=EXCLUDED.size,is_active=true,updated_at=now()
    WHERE (okved_groups.name,okved_groups.size,okved_groups.is_active) IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.size,true)`,[JSON.stringify(snapshot.groups)]);
  await client.query('UPDATE public.okveds SET is_active=false,updated_at=now() WHERE is_active AND NOT (okved=ANY($1::text[]))',[snapshot.okveds.map(r=>r.code)]);
  await client.query(`INSERT INTO public.okveds(okved,parent_code,level,section,name,description,selectable,is_active)
    SELECT code,"parentCode",level,"group",name,description,selectable,true
    FROM jsonb_to_recordset($1::jsonb) AS x(code text,"parentCode" text,level smallint,"group" text,name text,description text,selectable boolean)
    ORDER BY level,code
    ON CONFLICT(okved) DO UPDATE SET parent_code=EXCLUDED.parent_code,level=EXCLUDED.level,section=EXCLUDED.section,
      name=EXCLUDED.name,description=EXCLUDED.description,selectable=EXCLUDED.selectable,is_active=true,updated_at=now()
    WHERE (okveds.parent_code,okveds.level,okveds.section,okveds.name,okveds.description,okveds.selectable,okveds.is_active)
      IS DISTINCT FROM (EXCLUDED.parent_code,EXCLUDED.level,EXCLUDED.section,EXCLUDED.name,EXCLUDED.description,EXCLUDED.selectable,true)`,[JSON.stringify(snapshot.okveds)]);
  await client.query("UPDATE public.okved_reference_state SET revision=revision+1,published_hash=$1,published_at=now() WHERE id='okved2'",[hash]);
  await client.query("UPDATE public.okved_imports SET status='published',finished_at=now() WHERE id=$1",[id]);
  await client.query("UPDATE public.okved_imports SET status='superseded',finished_at=now() WHERE status='pending_review' AND id<>$1",[id]);
}

export class OkvedSync {
  constructor(private readonly pool:Pool,private readonly source:()=>Promise<OkvedSnapshot>=loadFnsSnapshot) {}

  async run():Promise<ImportResult> {
    const client=await this.pool.connect();let locked=false,id:string|undefined;
    try {
      locked=(await client.query(LOCK)).rows[0].locked;
      if (!locked) return {status:'busy'};
      await client.query("UPDATE public.okved_imports SET status='failed',finished_at=now(),error='Interrupted before completion' WHERE status='running'");
      id=(await client.query("INSERT INTO public.okved_imports(status,source_url) VALUES ('running',$1) RETURNING id",[FNS_BASE+'okveds'])).rows[0].id;
      const fetched=await this.source();
      const snapshot=normalizeSnapshot({okveds:fetched.okveds},{groups:fetched.groups}),hash=snapshotHash(snapshot);
      await client.query('BEGIN');
      const baseline=await current(client),baselineHash=snapshotHash(baseline.snapshot),diff=snapshotDiff(baseline.snapshot,snapshot);
      await client.query('UPDATE public.okved_imports SET snapshot_hash=$2,base_revision=$3,baseline_hash=$4,diff=$5::jsonb WHERE id=$1',
        [id,hash,baseline.revision,baselineHash,JSON.stringify(diff)]);
      await client.query("UPDATE public.okved_imports SET status='superseded',finished_at=now(),decision_reason='Newer FNS snapshot observed' WHERE status='pending_review' AND snapshot_hash<>$1",[hash]);
      if (baselineHash===hash) {
        await client.query("UPDATE public.okved_imports SET status='unchanged',finished_at=now() WHERE id=$1",[id]);
        await client.query('COMMIT');return {id,status:'unchanged',hash};
      }
      const prior=(await client.query(`SELECT id,status FROM public.okved_imports WHERE id<>$1 AND snapshot_hash=$2
        AND base_revision=$3 AND baseline_hash=$4 AND snapshot IS NOT NULL AND status IN ('rejected','pending_review') ORDER BY id DESC LIMIT 1`,[id,hash,baseline.revision,baselineHash])).rows[0];
      if (prior) {
        await client.query("UPDATE public.okved_imports SET status=$2,finished_at=now(),decision_reason=$3 WHERE id=$1",[id,prior.status==='pending_review'?'unchanged':'rejected',`Same candidate as import ${prior.id}`]);
        await client.query('COMMIT');return {id:prior.id,status:prior.status,hash};
      }
      const reasons=reviewReasons(diff,baseline.snapshot,baseline.inactive);
      const rejected=(await client.query("SELECT 1 FROM public.okved_imports WHERE snapshot_hash=$1 AND status='rejected' LIMIT 1",[hash])).rowCount;
      if(rejected)reasons.push('previously_rejected');
      await client.query('UPDATE public.okved_imports SET snapshot=$2::jsonb,review_reasons=$3::jsonb WHERE id=$1',[id,JSON.stringify(snapshot),JSON.stringify(reasons)]);
      if (reasons.length) await client.query("UPDATE public.okved_imports SET status='pending_review',finished_at=now() WHERE id=$1",[id]);
      else await publish(client,snapshot,hash,id!);
      await client.query('COMMIT');return {id,status:reasons.length?'pending_review':'published',hash,reasons};
    } catch(error) {
      await client.query('ROLLBACK');
      if (id) await client.query("UPDATE public.okved_imports SET status='failed',finished_at=now(),error=$2 WHERE id=$1",[id,failureCode(error)]);
      throw error;
    } finally {try {if(locked)await client.query(UNLOCK);} finally {client.release();}}
  }

  async decide(id:string,decision:'approve'|'reject',expectedHash:string,actor:string,reason?:string):Promise<ImportResult> {
    if (!/^[1-9]\d*$/.test(id) || !actor.trim() || actor.length>200) throw new Error('Import ID and operator are required');
    if (decision==='reject' && !reason?.trim()) throw new Error('Rejection reason required');
    const client=await this.pool.connect();let locked=false;
    try {
      locked=(await client.query(LOCK)).rows[0].locked;if(!locked)throw new Error('Import busy; retry later');
      await client.query('BEGIN');
      const candidate=(await client.query('SELECT * FROM public.okved_imports WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!candidate || candidate.status!=='pending_review' || !candidate.snapshot) throw new Error('Candidate is stale or not pending review');
      if (candidate.snapshot_hash!==expectedHash) throw new Error('Snapshot hash mismatch');
      const baseline=await current(client);
      if (candidate.base_revision!==baseline.revision || candidate.baseline_hash!==snapshotHash(baseline.snapshot)) throw new Error('Candidate is stale; run a new import');
      await client.query('UPDATE public.okved_imports SET decided_by=$2,decided_at=now(),decision_reason=$3 WHERE id=$1',[id,actor,reason??null]);
      if (decision==='approve') {
        const s=normalizeSnapshot({okveds:candidate.snapshot.okveds},{groups:candidate.snapshot.groups});
        if(snapshotHash(s)!==expectedHash)throw new Error('Stored snapshot hash mismatch');
        await publish(client,s,expectedHash,id);
      } else await client.query("UPDATE public.okved_imports SET status='rejected',finished_at=now() WHERE id=$1",[id]);
      await client.query('COMMIT');return {id,status:decision==='approve'?'published':'rejected',hash:expectedHash};
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {try {if(locked)await client.query(UNLOCK);} finally {client.release();}}
  }
}
