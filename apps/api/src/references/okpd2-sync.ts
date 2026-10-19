import type {Pool,PoolClient} from 'pg';
import {loadRosstatSnapshot} from './okpd2-source.js';
import {normalizeSnapshot,reviewReasons,snapshotDiff,snapshotHash,type OkpdSnapshot} from './okpd2-model.js';

export interface ImportResult {id?:string;status:string;hash?:string;reasons?:string[]}
const LOCK="SELECT pg_try_advisory_lock(hashtext('forum-okpd2-sync')) AS locked";
const UNLOCK="SELECT pg_advisory_unlock(hashtext('forum-okpd2-sync'))";

function failureCode(error:unknown):string {
  if(error instanceof Error) {
    const http=/^Rosstat HTTP (\d{3})$/.exec(error.message);if(http)return `rosstat_http_${http[1]}`;
    if(['TimeoutError','AbortError'].includes(error.name))return 'rosstat_timeout';
    if(error instanceof TypeError)return 'rosstat_transport';
    if(/^(Invalid|Duplicate|Missing|Incomplete|Empty|Rosstat .* (expected|required|large))/.test(error.message))return 'rosstat_contract';
  }
  if(error && typeof error==='object' && 'code' in error && typeof error.code==='string' && /^[A-Z0-9]{5}$/.test(error.code))return `database_${error.code}`;
  return 'import_failed';
}

async function current(client:PoolClient):Promise<{snapshot:OkpdSnapshot;inactive:Set<string>;revision:string}> {
 const codes=(await client.query('SELECT okpd,section,name,parent_code,level,is_active FROM public.okpds ORDER BY okpd')).rows;
 const sections=(await client.query('SELECT code,name FROM public.okpd_sections WHERE is_active ORDER BY code')).rows;
 const state=(await client.query("SELECT revision,source_metadata FROM public.okpd_reference_state WHERE id='okpd2' FOR UPDATE")).rows[0];
 if(!state)throw new Error('Reference migrations required');
 return {revision:state.revision,inactive:new Set(codes.filter(r=>!r.is_active).map(r=>r.okpd)),snapshot:{
  edition:state.source_metadata?.edition??'',publishedDate:state.source_metadata?.publishedDate??'',url:'https://rosstat.gov.ru/storage/mediabank/OKPD2.rar',archiveHash:state.source_metadata?.archiveHash??'',sections,
  items:codes.filter(r=>r.is_active).map(r=>({code:r.okpd,section:r.section,name:r.name,parentCode:r.parent_code,level:r.level}))}};
}

async function publish(client:PoolClient,snapshot:OkpdSnapshot,hash:string,id:string):Promise<void> {
 await client.query('UPDATE public.okpd_sections SET is_active=false,updated_at=now() WHERE is_active AND NOT(code=ANY($1::text[]))',[snapshot.sections.map(s=>s.code)]);
 await client.query(`INSERT INTO public.okpd_sections(code,name,is_active) SELECT code,name,true FROM jsonb_to_recordset($1::jsonb) x(code text,name text)
 ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,is_active=true,updated_at=now()
 WHERE (okpd_sections.name,okpd_sections.is_active) IS DISTINCT FROM (EXCLUDED.name,true)`,[JSON.stringify(snapshot.sections)]);
 await client.query('UPDATE public.okpds SET is_active=false,updated_at=now() WHERE is_active AND NOT(okpd=ANY($1::text[]))',[snapshot.items.map(r=>r.code)]);
 await client.query(`INSERT INTO public.okpds(okpd,parent_code,level,section,name,is_active)
 SELECT code,"parentCode",level,section,name,true FROM jsonb_to_recordset($1::jsonb) x(code text,"parentCode" text,level smallint,section text,name text) ORDER BY level,code
 ON CONFLICT(okpd) DO UPDATE SET parent_code=EXCLUDED.parent_code,level=EXCLUDED.level,section=EXCLUDED.section,name=EXCLUDED.name,is_active=true,updated_at=now()
 WHERE (okpds.parent_code,okpds.level,okpds.section,okpds.name,okpds.is_active) IS DISTINCT FROM (EXCLUDED.parent_code,EXCLUDED.level,EXCLUDED.section,EXCLUDED.name,true)`,[JSON.stringify(snapshot.items)]);
 const {edition,publishedDate,url,archiveHash}=snapshot;
 await client.query("UPDATE public.okpd_reference_state SET revision=revision+1,published_hash=$1,published_at=now(),source_metadata=$2::jsonb WHERE id='okpd2'",[hash,JSON.stringify({edition,publishedDate,url,archiveHash})]);
 await client.query("UPDATE public.okpd_imports SET status='published',finished_at=now() WHERE id=$1",[id]);
 await client.query("UPDATE public.okpd_imports SET status='superseded',finished_at=now() WHERE status='pending_review' AND id<>$1",[id]);
}

export class OkpdSync {
  constructor(private readonly pool:Pool,private readonly source:()=>Promise<OkpdSnapshot>=loadRosstatSnapshot) {}

  async run():Promise<ImportResult> {
    const client=await this.pool.connect();let locked=false,id:string|undefined;
    try {
      locked=(await client.query(LOCK)).rows[0].locked;
      if (!locked) return {status:'busy'};
      await client.query("UPDATE public.okpd_imports SET status='failed',finished_at=now(),error='Interrupted before completion' WHERE status='running'");
      id=(await client.query("INSERT INTO public.okpd_imports(status,source_url) VALUES ('running',$1) RETURNING id",['https://rosstat.gov.ru/storage/mediabank/OKPD2.rar'])).rows[0].id;
      const fetched=await this.source();
      const snapshot=normalizeSnapshot(fetched),hash=snapshotHash(snapshot);
      await client.query('BEGIN');
      await client.query("UPDATE public.okpd_reference_state SET last_checked_at=now() WHERE id='okpd2'");
      const baseline=await current(client),baselineHash=snapshotHash(baseline.snapshot),diff=snapshotDiff(baseline.snapshot,snapshot);
      await client.query('UPDATE public.okpd_imports SET snapshot_hash=$2,base_revision=$3,baseline_hash=$4,diff=$5::jsonb,source_metadata=$6::jsonb WHERE id=$1',
        [id,hash,baseline.revision,baselineHash,JSON.stringify(diff),JSON.stringify({edition:snapshot.edition,publishedDate:snapshot.publishedDate,url:snapshot.url,archiveHash:snapshot.archiveHash})]);
      await client.query("UPDATE public.okpd_imports SET status='superseded',finished_at=now(),decision_reason='Newer Rosstat snapshot observed' WHERE status='pending_review' AND snapshot_hash<>$1",[hash]);
      if (baselineHash===hash) {
        await client.query("UPDATE public.okpd_imports SET status='unchanged',finished_at=now() WHERE id=$1",[id]);
        await client.query('COMMIT');return {id,status:'unchanged',hash};
      }
      const prior=(await client.query(`SELECT id,status FROM public.okpd_imports WHERE id<>$1 AND snapshot_hash=$2
        AND base_revision=$3 AND baseline_hash=$4 AND snapshot IS NOT NULL AND status IN ('rejected','pending_review') ORDER BY id DESC LIMIT 1`,[id,hash,baseline.revision,baselineHash])).rows[0];
      if (prior) {
        await client.query("UPDATE public.okpd_imports SET status=$2,finished_at=now(),decision_reason=$3 WHERE id=$1",[id,prior.status==='pending_review'?'unchanged':'rejected',`Same candidate as import ${prior.id}`]);
        await client.query('COMMIT');return {id:prior.id,status:prior.status,hash};
      }
      const reasons=reviewReasons(diff,baseline.snapshot,baseline.inactive);
      const rejected=(await client.query("SELECT 1 FROM public.okpd_imports WHERE snapshot_hash=$1 AND status='rejected' LIMIT 1",[hash])).rowCount;
      if(rejected)reasons.push('previously_rejected');
      await client.query('UPDATE public.okpd_imports SET snapshot=$2::jsonb,review_reasons=$3::jsonb WHERE id=$1',[id,JSON.stringify(snapshot),JSON.stringify(reasons)]);
      if (reasons.length) await client.query("UPDATE public.okpd_imports SET status='pending_review',finished_at=now() WHERE id=$1",[id]);
      else await publish(client,snapshot,hash,id!);
      await client.query('COMMIT');return {id,status:reasons.length?'pending_review':'published',hash,reasons};
    } catch(error) {
      await client.query('ROLLBACK');
      if (id) await client.query("UPDATE public.okpd_imports SET status='failed',finished_at=now(),error=$2 WHERE id=$1",[id,failureCode(error)]);
      throw error;
    } finally {try {if(locked)await client.query(UNLOCK);} finally {client.release();}}
  }

  async decide(id:string,decision:'approve'|'reject',expectedHash:string,actor:string,reason?:string):Promise<ImportResult> {
    if (!['approve','reject'].includes(decision))throw new Error('Invalid decision');
    if (!/^[1-9]\d*$/.test(id) || !actor.trim() || actor.length>200) throw new Error('Import ID and operator are required');
    if (decision==='reject' && !reason?.trim()) throw new Error('Rejection reason required');
    const client=await this.pool.connect();let locked=false;
    try {
      locked=(await client.query(LOCK)).rows[0].locked;if(!locked)throw new Error('Import busy; retry later');
      await client.query('BEGIN');
      const candidate=(await client.query('SELECT id,status,snapshot,snapshot_hash,base_revision,baseline_hash FROM public.okpd_imports WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!candidate || candidate.status!=='pending_review' || !candidate.snapshot) throw new Error('Candidate is stale or not pending review');
      if (candidate.snapshot_hash!==expectedHash) throw new Error('Snapshot hash mismatch');
      const baseline=await current(client);
      if (candidate.base_revision!==baseline.revision || candidate.baseline_hash!==snapshotHash(baseline.snapshot)) throw new Error('Candidate is stale; run a new import');
      await client.query('UPDATE public.okpd_imports SET decided_by=$2,decided_at=now(),decision_reason=$3 WHERE id=$1',[id,actor,reason??null]);
      if (decision==='approve') {
        const s=normalizeSnapshot(candidate.snapshot);
        if(snapshotHash(s)!==expectedHash)throw new Error('Stored snapshot hash mismatch');
        await publish(client,s,expectedHash,id);
      } else await client.query("UPDATE public.okpd_imports SET status='rejected',finished_at=now() WHERE id=$1",[id]);
      await client.query('COMMIT');return {id,status:decision==='approve'?'published':'rejected',hash:expectedHash};
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {try {if(locked)await client.query(UNLOCK);} finally {client.release();}}
  }
}
