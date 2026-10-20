import type {Pool} from 'pg';
import {AuthError} from '../iam/auth-error.js';

export type VerificationMethod='diadoc'|'kep';
export type VerificationStatus='checking'|'connection_required'|'signature_required'|'access_confirmed'|'access_denied'|'unavailable'|'selection_required';
export type VerificationSource='unconfigured'|'diadoc_staging'|'diadoc_production'|'simulation';
export type TechnicalEvidence={
 requisites?:{inn:string;name:string;orgId:string;boxId:string;kpp?:string;ogrn?:string};
 permissions?:{isAdministrator:boolean;canSignDocuments:boolean;documentAccessLevel:string};
};
export type VerificationResult={status:Exclude<VerificationStatus,'checking'>;source:VerificationSource;reason:string; evidence?:TechnicalEvidence};
export type VerificationProvider=(userId:string,inn:string,method:VerificationMethod)=>Promise<VerificationResult>;
type Row={id:string;inn:string;method:VerificationMethod;status:VerificationStatus;source:VerificationSource;reason:string|null;evidence:TechnicalEvidence;created_at:Date;checked_at:Date|null;expires_at:Date};
function dto(row:Row){
 const stale=row.expires_at.getTime()<=Date.now();
 return {id:row.id,inn:row.inn,method:row.method,status:stale?'unavailable':row.status,source:row.source,
  reason:stale?'expired':row.reason,createdAt:row.created_at.toISOString(),checkedAt:row.checked_at?.toISOString()??null,
  expiresAt:row.expires_at.toISOString(),evidence:stale?{}:row.evidence,
  legalPermissions:{registerCompany:false,submitTender:false}};
}
function safeResult(value:VerificationResult,inn:string):VerificationResult{
 if(!value||!['connection_required','signature_required','access_confirmed','access_denied','unavailable','selection_required'].includes(value.status)
  ||!['unconfigured','diadoc_staging','diadoc_production','simulation'].includes(value.source)
  ||typeof value.reason!=='string'||!/^\w{1,64}$/.test(value.reason))throw new Error('Invalid provider result');
 const evidence:TechnicalEvidence={};
 if(value.status==='access_confirmed'){
  const r=value.evidence?.requisites,p=value.evidence?.permissions;
  if(!r||r.inn!==inn||!p||typeof p.isAdministrator!=='boolean'||typeof p.canSignDocuments!=='boolean'
   ||typeof p.documentAccessLevel!=='string'||p.documentAccessLevel.length>64)throw new Error('Invalid evidence');
  for(const key of ['name','orgId','boxId'] as const)if(typeof r[key]!=='string'||!r[key].trim()||r[key].length>512)throw new Error('Invalid requisites');
  if((r.kpp!==undefined&&!/^\d{9}$/.test(r.kpp))||(r.ogrn!==undefined&&!/^\d{13,15}$/.test(r.ogrn)))throw new Error('Invalid requisites');
  evidence.requisites={inn,name:r.name,orgId:r.orgId,boxId:r.boxId,...(r.kpp?{kpp:r.kpp}:{}),...(r.ogrn?{ogrn:r.ogrn}:{})};
  evidence.permissions={isAdministrator:p.isAdministrator,canSignDocuments:p.canSignDocuments,documentAccessLevel:p.documentAccessLevel};
 }
 return {status:value.status,source:value.source,reason:value.reason,evidence};
}
export class VerificationStore {
 constructor(private readonly pool:Pool,private readonly provider?:VerificationProvider){}
 private async own(userId:string,inn:string){
  if(!(await this.pool.query('SELECT 1 FROM public.organization_additions WHERE user_id=$1 AND inn=$2',[userId,inn])).rowCount)throw new AuthError('not_found',404);
 }
 async latest(userId:string,inn:string){
  await this.own(userId,inn);
  const row=(await this.pool.query<Row>('SELECT * FROM public.organization_verifications WHERE user_id=$1 AND inn=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[userId,inn])).rows[0];
  return row?dto(row):null;
 }
 async start(userId:string,inn:string,method:VerificationMethod,requestId:string){
  const client=await this.pool.connect();let row:Row,created=false;
  try{
   await client.query('BEGIN');
   // The composite FK enforces ownership at INSERT. Runtime cannot update/delete additions.
   if(!(await client.query('SELECT 1 FROM public.organization_additions WHERE user_id=$1 AND inn=$2',[userId,inn])).rowCount)throw new AuthError('not_found',404);
   const inserted=await client.query<Row>(`INSERT INTO public.organization_verifications(user_id,inn,method,request_id)
    VALUES($1,$2,$3,$4) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING *`,[userId,inn,method,requestId]);
   created=Boolean(inserted.rowCount);
   row=created?inserted.rows[0]:(await client.query<Row>('SELECT * FROM public.organization_verifications WHERE user_id=$1 AND request_id=$2',[userId,requestId])).rows[0];
   if(row.inn!==inn||row.method!==method)throw new AuthError('request_conflict',409);
   if(created)await client.query(`INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES(gen_random_uuid(),$1,'OrganizationVerificationStarted',jsonb_build_object('verificationId',$2::text,'method',$3::text))`,[userId,row.id,method]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  if(!created)return {created,item:dto(row!)};
  let result:VerificationResult;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   result=safeResult(this.provider?await Promise.race([this.provider(userId,inn,method),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timeout')),12_000)})]):
    {status:method==='diadoc'?'connection_required':'signature_required',source:'unconfigured',reason:'not_connected'},inn);
  }catch{result={status:'unavailable',source:'unconfigured',reason:'provider_unavailable',evidence:{}}}
  finally{if(timer)clearTimeout(timer)}
  const completion=await this.pool.connect();
  try{
   await completion.query('BEGIN');
   const updated=await completion.query<Row>(`UPDATE public.organization_verifications SET status=$3,source=$4,reason=$5,evidence=$6,checked_at=clock_timestamp()
    WHERE id=$1 AND user_id=$2 AND status='checking' RETURNING *`,[row!.id,userId,result.status,result.source,result.reason,result.evidence??{}]);
   if(updated.rowCount){row=updated.rows[0];await completion.query(`INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES(gen_random_uuid(),$1,'OrganizationVerificationCompleted',jsonb_build_object('verificationId',$2::text,'status',$3::text))`,[userId,row.id,row.status])}
   await completion.query('COMMIT');
  }catch(error){await completion.query('ROLLBACK');throw error}finally{completion.release()}
  return {created,item:dto(row!)};
 }
}
