import type {Pool,PoolClient} from 'pg';
import {AuthError} from '../iam/auth-error.js';
import {RoleStore,roleActor,effectiveRoles,type RoleActor} from '../iam/role-store.js';
import {lockIamScope,auditIam,type MutationRequest} from '../iam/role-mutations.js';
import {managedReferences,type ManagedKind,type ReferenceInput,type ReferenceQuery,type ReferenceValue} from './managed-model.js';

async function authorize(client:PoolClient,actor:RoleActor,kind:ManagedKind){
 const roles=await effectiveRoles(client,actor.id);
 if(!roles.includes('platform_admin')&&!(kind==='rejection-reasons'&&roles.includes('platform_moderator')))throw new AuthError('forbidden',403);
}
function columns(kind:ManagedKind):string{
 const schema=managedReferences[kind];
 return `${schema.numeric?"lpad(code::text,2,'0')":'code'} AS code,name,${schema.description?'description':'NULL::text AS description'},${schema.symbol?'symbol':'NULL::text AS symbol'},version`;
}
function escapeLike(value:string){return value.replace(/[\\%_]/g,'\\$&')}
export class ManagedReferenceStore{
 constructor(private readonly pool:Pool){}
 async list(token:string,kind:ManagedKind,query:ReferenceQuery){
  return new RoleStore(this.pool).read(token,async(client,actor)=>{
   await authorize(client,actor,kind);const schema=managedReferences[kind],code=schema.numeric?"lpad(code::text,2,'0')":'code';
   const where=`deleted_at IS NULL AND ${code} LIKE $1 ESCAPE '\\' AND name ILIKE $2 ESCAPE '\\'`;
   const args=[escapeLike(query.code)+'%','%'+escapeLike(query.name)+'%'];
   const total=(await client.query(`SELECT count(*)::integer AS total FROM public.${schema.table} WHERE ${where}`,args)).rows[0].total;
   const items=(await client.query<ReferenceValue>(`SELECT ${columns(kind)} FROM public.${schema.table} WHERE ${where} ORDER BY code LIMIT 50 OFFSET $3`,[...args,(query.page-1)*50])).rows;
   return {items,total,page:query.page,pageSize:50};
  });
 }
 async detail(token:string,kind:ManagedKind,code:string){
  return new RoleStore(this.pool).read(token,async(client,actor)=>{
   await authorize(client,actor,kind);
   const item=(await client.query<ReferenceValue>(`SELECT ${columns(kind)} FROM public.${managedReferences[kind].table} WHERE code=$1 AND deleted_at IS NULL`,[code])).rows[0];
   if(!item)throw new AuthError('not_found',404);return {item};
  });
 }
 async change(request:MutationRequest,kind:ManagedKind,operation:'create'|'edit'|'delete',code:string,input?:ReferenceInput){
  const client=await this.pool.connect();try{
   await client.query('BEGIN');await lockIamScope(client);
   const check=async()=>{
    const actor=await roleActor(client,request.token);
    if(actor.csrfToken!==request.csrfToken)throw new AuthError('invalid_csrf',403);
    await authorize(client,actor,kind);return actor;
   };
   const actor=await check();
   const replay=(await client.query('SELECT request_hash,response_status,response_body FROM public.reference_idempotency WHERE actor_user_id=$1 AND idempotency_key=$2',[actor.id,request.idempotencyKey])).rows[0];
   if(replay){
    if(replay.request_hash!==request.requestHash)throw new AuthError('idempotency_conflict',409);
    await client.query('COMMIT');return {status:replay.response_status as number,body:replay.response_body};
   }
   const schema=managedReferences[kind],table='public.'+schema.table;
   let before:ReferenceValue|undefined,version=1;
   if(operation!=='create'){
    before=(await client.query<ReferenceValue>(`SELECT ${columns(kind)} FROM ${table} WHERE code=$1 AND deleted_at IS NULL FOR UPDATE`,[code])).rows[0];
    await check();if(!before)throw new AuthError('not_found',404);
    if(before.version!==request.version)throw new AuthError('stale_version',412);
    version=before.version+1;
   }
   if(operation==='create'){
    const fields=['code','name',...(schema.description?['description']:[]),...(schema.symbol?['symbol']:[])];
    const values=[code,input!.name,...(schema.description?[input!.description??null]:[]),...(schema.symbol?[input!.symbol??null]:[])];
    await client.query(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,values);
   }else if(operation==='edit'){
    const fields=['name',...(schema.description?['description']:[]),...(schema.symbol?['symbol']:[])];
    const values=[code,input!.name,...(schema.description?[input!.description??null]:[]),...(schema.symbol?[input!.symbol??null]:[])];
    await client.query(`UPDATE ${table} SET ${fields.map((field,i)=>field+'=$'+(i+2)).join(',')},version=version+1,updated_at=now() WHERE code=$1`,values);
   }else{
    await client.query(`UPDATE ${table} SET deleted_at=now(),deleted_by=$2,version=version+1,updated_at=now() WHERE code=$1`,[code,actor.id]);
   }
   const after=operation==='delete'?{code,version,deleted:true}:(await client.query<ReferenceValue>(`SELECT ${columns(kind)} FROM ${table} WHERE code=$1`,[code])).rows[0];
   await auditIam(client,actor.id,{create:'ReferenceValueCreated',edit:'ReferenceValueUpdated',delete:'ReferenceValueDeleted'}[operation],{dictionary:kind,code,before:before??null,after});
   // Replay responses carry only keys and version, never previously deleted names.
   const body={item:{code,version,...(operation==='delete'?{deleted:true}:{})}},status=operation==='create'?201:200;
   await client.query('INSERT INTO public.reference_idempotency(actor_user_id,idempotency_key,request_hash,response_status,response_body) VALUES($1,$2,$3,$4,$5)',[actor.id,request.idempotencyKey,request.requestHash,status,body]);
   await client.query('COMMIT');return {status,body};
  }catch(error){
   await client.query('ROLLBACK');
   if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')throw new AuthError('reference_conflict',409);
   throw error;
  }finally{client.release()}
 }
}
