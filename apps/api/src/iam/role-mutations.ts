import type {Pool,PoolClient} from 'pg';
import {AuthError} from './auth-error.js';
import {assignmentColumns,authorizationContext,effectiveRoles,projectMember,roleActor,type PlatformAssignment,type RoleActor} from './role-store.js';
import {requireAll,type RoleCode} from './role-catalog.js';

export type MutationRequest={token:string;contextKey:string;csrfToken:string;idempotencyKey:string;requestHash:string;version?:number};
export type MutationResult={status:200|201;body:{item:unknown}};
export async function lockIamScope(client:PoolClient,organizationId?:string):Promise<void>{
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[
  organizationId?`forum-iam-organization:${organizationId}`:'forum-iam-platform']);
}
export async function auditIam(client:PoolClient,actorId:string,action:string,data:Record<string,unknown>):Promise<void>{
 await client.query('INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES(gen_random_uuid(),$1,$2,$3)',[actorId,action,data]);
}
export async function bumpAccess(client:PoolClient,userId:string):Promise<void>{
 await client.query('UPDATE public.users SET access_version=access_version+1 WHERE id=$1',[userId]);
}
export class RoleMutations {
 constructor(private readonly pool:Pool){}
 private async run(request:MutationRequest,organizationId:string|undefined,operation:(client:PoolClient,authorize:()=>Promise<RoleActor>)=>Promise<MutationResult>):Promise<MutationResult>{
  const client=await this.pool.connect();try{
   await client.query('BEGIN');
   // Lock scope, actor/key, then target rows; reauthorize after each blocking stage.
   await lockIamScope(client,organizationId);
   let actor=await roleActor(client,request.token);
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`forum-iam-idempotency:${actor.id}:${request.idempotencyKey}`]);
   const authorize=async()=>{
    const current=await roleActor(client,request.token);
    if(current.csrfToken!==request.csrfToken)throw new AuthError('invalid_csrf',403);
    const expectedContext=organizationId?`organization:${organizationId}`:'platform';
    if(request.contextKey!==expectedContext)throw new AuthError('forbidden',403);
    requireAll((await authorizationContext(client,current,expectedContext)).permissions,
     [organizationId?'organization.members.manage':'platform.roles.manage']);
    return current;
   };
   actor=await authorize();
   // Replay only after current authorization, even with the old valid cookie.
   const replay=(await client.query(`SELECT request_hash,response_status,response_body FROM public.iam_idempotency
    WHERE actor_user_id=$1 AND idempotency_key=$2`,[actor.id,request.idempotencyKey])).rows[0];
   if(replay){
    if(replay.request_hash!==request.requestHash)throw new AuthError('idempotency_conflict',409);
    await client.query('COMMIT');return {status:replay.response_status,body:replay.response_body};
   }
   const result=await operation(client,authorize);
   await client.query(`INSERT INTO public.iam_idempotency(actor_user_id,idempotency_key,request_hash,response_status,response_body)
    VALUES($1,$2,$3,$4,$5)`,[actor.id,request.idempotencyKey,request.requestHash,result.status,result.body]);
   await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async grant(request:MutationRequest,input:{targetUserId:string;roleCode:RoleCode;reason:string}):Promise<MutationResult>{
  return this.run(request,undefined,async(client,authorize)=>{
   const target=await client.query(`SELECT u.id FROM public.users u WHERE u.id=$1 AND u.status='active' AND EXISTS(
    SELECT 1 FROM public.external_identities e JOIN public.identity_profiles p ON p.identity_id=e.id AND p.user_id=e.user_id
    WHERE e.user_id=u.id AND p.identified_at IS NOT NULL) FOR UPDATE OF u`,[input.targetUserId]);
   if(!target.rowCount)throw new AuthError('not_found',404);
   const existing=(await client.query<PlatformAssignment>(`SELECT ${assignmentColumns} FROM public.iam_role_assignments
    WHERE user_id=$1 AND scope_type='platform' AND role_code=$2 FOR UPDATE`,[input.targetUserId,input.roleCode])).rows[0];
   const actor=await authorize();
   if(existing?.status==='active')return {status:200,body:{item:existing}};
   if(existing){
    if(request.version===undefined)throw new AuthError('invalid_request');
    if(existing.version!==request.version)throw new AuthError('stale_version',412);
   }
   const row=(await client.query<PlatformAssignment>(existing?
    `UPDATE public.iam_role_assignments SET status='active',revoked_at=NULL,effective_from=now(),effective_until=NULL,
      reason=$2,version=version+1 WHERE id=$1 RETURNING ${assignmentColumns}`:
    `INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason)
      VALUES($1,'platform',$2,$3,$4) RETURNING ${assignmentColumns}`,
    existing?[existing.id,input.reason]:[input.targetUserId,input.roleCode,actor.id,input.reason])).rows[0];
   await bumpAccess(client,input.targetUserId);
   await auditIam(client,actor.id,'IAMPlatformRoleGranted',{assignmentId:row.id,targetUserId:row.userId,roleCode:row.roleCode,reason:input.reason});
   return {status:existing?200:201,body:{item:row}};
  });
 }
 async updatePlatform(request:MutationRequest,id:string,input:{status:'active'|'revoked';reason:string}):Promise<MutationResult>{
  return this.run(request,undefined,async(client,authorize)=>{
   const current=(await client.query<PlatformAssignment>(`SELECT r.id,r.user_id AS "userId",r.role_code AS "roleCode",r.status,r.version
    FROM public.iam_role_assignments r JOIN public.users u ON u.id=r.user_id
    WHERE r.id=$1 AND r.scope_type='platform' FOR UPDATE OF r,u`,[id])).rows[0];
   const actor=await authorize();
   if(!current)throw new AuthError('not_found',404);
   if(current.version!==request.version)throw new AuthError('stale_version',412);
   if(input.status==='active'&&!(await client.query(`SELECT 1 FROM public.users u WHERE u.id=$1 AND u.status='active'
    AND EXISTS(SELECT 1 FROM public.external_identities e JOIN public.identity_profiles p ON p.identity_id=e.id
     AND p.user_id=e.user_id WHERE e.user_id=u.id AND p.identified_at IS NOT NULL)`,[current.userId])).rowCount)throw new AuthError('not_found',404);
   if(input.status==='revoked'&&current.roleCode==='platform_admin'&&(await effectiveRoles(client,current.userId)).includes('platform_admin')){
    const others=await client.query(`SELECT 1 FROM public.users u WHERE u.id<>$1
     AND EXISTS(SELECT 1 FROM public.effective_iam_roles(u.id,NULL) r WHERE r.role_code='platform_admin') LIMIT 1`,[current.userId]);
    if(!others.rowCount)throw new AuthError('last_admin',409);
   }
   const row=(await client.query<PlatformAssignment>(`UPDATE public.iam_role_assignments SET status=$2,reason=$3,
    revoked_at=CASE WHEN $2='revoked' THEN now() ELSE NULL END,version=version+1 WHERE id=$1 RETURNING ${assignmentColumns}`,
    [id,input.status,input.reason])).rows[0];
   await bumpAccess(client,current.userId);
   await auditIam(client,actor.id,'IAMPlatformRoleUpdated',{assignmentId:id,targetUserId:current.userId,roleCode:current.roleCode,status:input.status,reason:input.reason});
   return {status:200,body:{item:row}};
  });
 }
 async updateMember(request:MutationRequest,organizationId:string,membershipId:string,input:{roles:RoleCode[];status:'active'|'revoked';reason:string}):Promise<MutationResult>{
  return this.run(request,organizationId,async(client,authorize)=>{
   const m=(await client.query(`SELECT m.id,m.user_id,m.status,m.version,m.effective_from,m.effective_until,m.basis_type,
    m.approved_by_user_id,u.status AS user_status,u.display_name AS "displayName" FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
    WHERE m.id=$1 AND m.organization_id=$2 FOR UPDATE OF m,u`,[membershipId,organizationId])).rows[0];
   if(!m)throw new AuthError('not_found',404);
   await client.query('SELECT id FROM public.iam_role_assignments WHERE membership_id=$1 FOR UPDATE',[membershipId]);
   const actor=await authorize();
   const now=(await client.query('SELECT statement_timestamp() AS now')).rows[0].now as Date;
   if(m.version!==request.version)throw new AuthError('stale_version',412);
   // This endpoint cannot approve a pending invitation or fabricate external evidence.
   if(input.status==='active'&&(m.user_status!=='active'||!m.effective_from||
    (new Date(m.effective_from)>now)||(m.effective_until&&new Date(m.effective_until)<=now)||(!m.approved_by_user_id&&m.basis_type!=='legacy')))throw new AuthError('forbidden',403);
   if((input.status==='revoked'||!input.roles.includes('organization_admin'))&&
    (await effectiveRoles(client,m.user_id,organizationId)).includes('organization_admin')){
    const other=await client.query(`SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=$1 AND m.user_id<>$2
     AND EXISTS(SELECT 1 FROM public.effective_iam_roles(m.user_id,$1) r WHERE r.role_code='organization_admin') LIMIT 1`,[organizationId,m.user_id]);
    if(!other.rowCount)throw new AuthError('last_admin',409);
   }
   await client.query(`UPDATE public.organization_memberships SET status=$2,revoked_at=CASE WHEN $2='revoked' THEN now() ELSE NULL END,
    version=version+1 WHERE id=$1`,[membershipId,input.status]);
   const desired=input.status==='active'?input.roles:[];
   await client.query(`UPDATE public.iam_role_assignments SET status='revoked',revoked_at=now(),version=version+1,reason=$3
    WHERE membership_id=$1 AND status='active' AND NOT(role_code=ANY($2::text[]))`,[membershipId,desired,input.reason]);
   for(const role of desired){
    const existing=(await client.query(`SELECT id,status FROM public.iam_role_assignments WHERE membership_id=$1 AND role_code=$2`,[membershipId,role])).rows[0];
    if(existing){
     if(existing.status==='revoked')await client.query(`UPDATE public.iam_role_assignments SET status='active',revoked_at=NULL,
      reason=$2,version=version+1 WHERE id=$1`,[existing.id,input.reason]);
    }else await client.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason)
     VALUES($1,'organization',$2,$3,$4,$5,$6)`,[m.user_id,organizationId,membershipId,role,actor.id,input.reason]);
   }
   await bumpAccess(client,m.user_id);
   await auditIam(client,actor.id,'IAMOrganizationMemberUpdated',{organizationId,membershipId,targetUserId:m.user_id,roles:desired,status:input.status,reason:input.reason});
   const item=await projectMember(client,organizationId,{id:membershipId,userId:m.user_id,displayName:m.displayName,status:input.status,version:m.version+1});
   return {status:200,body:{item}};
  });
 }
}
