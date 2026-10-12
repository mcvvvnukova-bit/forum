import {createHmac,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {AuthError} from './auth-error.js';
import {hashToken} from './crypto.js';
import {permissionsFor,requireAll,type AuthorizationContext,type RoleCode} from './role-catalog.js';
import type {PageRequest} from './role-request.js';
import {findIndividualParticipant} from '../party/individual-participant.js';

export type RoleActor={id:string;accessVersion:number;csrfToken:string};
export async function assertIamReady(client:PoolClient):Promise<void>{
 const result=await client.query(`SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='008_iam_roles')
  AND to_regprocedure('public.effective_iam_roles(uuid,uuid)') IS NOT NULL AS ready`);
 if(result.rows[0]?.ready!==true)throw new AuthError('temporarily_unavailable',503);
 // Probe the real typed contract, including empty installations and missing ACLs.
 await client.query(`SELECT u.access_version,s.csrf_token,r.membership_id,r.version,m.version,i.request_hash,a.allowed_actions
  FROM public.users u,public.sessions s,public.iam_role_assignments r,public.organization_memberships m,
   public.iam_idempotency i,public.organization_authorities a LIMIT 0`);
 await client.query('SELECT role_code FROM public.effective_iam_roles(NULL::uuid,NULL::uuid)');
}
export async function roleActor(client:PoolClient,token:string):Promise<RoleActor>{
 const row=(await client.query(`SELECT u.id,u.access_version AS "accessVersion",s.csrf_token AS "csrfToken"
  FROM public.sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND u.status='active'`,[hashToken(token)])).rows[0];
 if(!row)throw new AuthError('unauthenticated',401);
 await assertIamReady(client);return {...row,accessVersion:Number(row.accessVersion)};
}
export async function effectiveRoles(client:PoolClient,userId:string,organizationId:string|null=null):Promise<RoleCode[]>{
 return (await client.query('SELECT role_code FROM public.effective_iam_roles($1,$2)',[userId,organizationId])).rows.map(row=>row.role_code as RoleCode);
}
async function organizationPermissions(client:PoolClient,userId:string,organizationId:string,roles:RoleCode[]):Promise<string[]>{
 const permissions=permissionsFor(roles);
 if(roles.includes('organization_signer')&&(await client.query(`SELECT 1 FROM public.organization_authorities
  WHERE user_id=$1 AND organization_id=$2 AND authority_type='signer' AND status='confirmed' AND revoked_at IS NULL
   AND effective_from<=statement_timestamp() AND (effective_until IS NULL OR effective_until>statement_timestamp())
   AND 'organization.documents.sign'=ANY(allowed_actions)`,[userId,organizationId])).rowCount)permissions.push('organization.documents.sign');
 return permissions;
}
export type MemberSummary={id:string;userId:string;displayName:string;status:'pending'|'active'|'revoked';version:number};
export type OrganizationMemberDto=MemberSummary&{roles:RoleCode[];effectiveRoles:RoleCode[];permissions:string[]};
export async function projectMember(client:PoolClient,organizationId:string,member:MemberSummary):Promise<OrganizationMemberDto>{
 const roles=(await client.query(`SELECT role_code FROM public.iam_role_assignments WHERE membership_id=$1 AND status='active'
  ORDER BY role_code`,[member.id])).rows.map(row=>row.role_code as RoleCode);
 const current=await effectiveRoles(client,member.userId,organizationId);
 return {...member,roles,effectiveRoles:current,permissions:await organizationPermissions(client,member.userId,organizationId,current)};
}
export async function authorizationContext(client:PoolClient,actor:RoleActor,contextKey:string):Promise<AuthorizationContext>{
 let roles:RoleCode[],participantId:string|null=null;
 let permissions:string[];
 if(contextKey===`person:${actor.id}`){
  roles=['individual'];participantId=(await findIndividualParticipant(client,actor.id))?.id??null;permissions=permissionsFor(roles);
 }else if(contextKey==='platform'){
  roles=await effectiveRoles(client,actor.id);if(!roles.length)throw new AuthError('forbidden',403);permissions=permissionsFor(roles);
 }else if(contextKey.startsWith('organization:')){
  const organizationId=contextKey.slice(13);roles=await effectiveRoles(client,actor.id,organizationId);
  if(!roles.length)throw new AuthError('forbidden',403);
  participantId=(await client.query(`SELECT id FROM public.participants WHERE organization_id=$1 AND status='active' ORDER BY role,id LIMIT 1`,[organizationId])).rows[0]?.id??null;
  permissions=await organizationPermissions(client,actor.id,organizationId,roles);
 }else throw new AuthError('forbidden',403);
 return {contextKey,participantId,roles,permissions,accessVersion:actor.accessVersion};
}

function signCursor(actor:RoleActor,value:string):string{return createHmac('sha256',actor.csrfToken).update(value).digest('base64url')}
function afterCursor(actor:RoleActor,kind:string,cursor?:string):string{
 if(!cursor)return '';
 try{
  const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  if(!Array.isArray(decoded)||decoded.length!==2||typeof decoded[0]!=='string'||typeof decoded[1]!=='string')throw new Error();
  const [value,signature]=decoded;const expected=signCursor(actor,value);
  if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error();
  const body=JSON.parse(value);if(body.actor!==actor.id||body.kind!==kind||typeof body.after!=='string')throw new Error();
  return body.after;
 }catch{throw new AuthError('invalid_request')}
}
function nextCursor(actor:RoleActor,kind:string,after:string):string{
 const value=JSON.stringify({actor:actor.id,kind,after});return Buffer.from(JSON.stringify([value,signCursor(actor,value)])).toString('base64url');
}
function page<T>(actor:RoleActor,kind:string,items:T[],limit:number,key:(item:T)=>string){
 return {items:items.slice(0,limit),nextCursor:items.length>limit?nextCursor(actor,kind,key(items[limit-1])):null};
}
export type PlatformAssignment={id:string;userId:string;roleCode:RoleCode;status:'active'|'revoked';version:number};
export type UserAccess={userId:string;displayName:string;status:'active'|'deactivated';version:number};
export const assignmentColumns='id,user_id AS "userId",role_code AS "roleCode",status,version';
export class RoleStore {
 constructor(private readonly pool:Pool){}
 async read<T>(token:string,operation:(client:PoolClient,actor:RoleActor)=>Promise<T>):Promise<T>{
  const client=await this.pool.connect();try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result=await operation(client,await roleActor(client,token));await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async resolve(token:string,key:string){return this.read(token,(client,actor)=>authorizationContext(client,actor,key))}
 async contexts(token:string,query:PageRequest){
  return this.read(token,async(client,actor)=>{
   const kind='contexts',after=afterCursor(actor,kind,query.cursor);
   const keys=(await client.query(`SELECT context_key FROM (
    SELECT 'person:'||$1::text AS context_key
    UNION SELECT 'organization:'||m.organization_id::text FROM public.organization_memberships m WHERE m.user_id=$1::uuid
     AND EXISTS(SELECT 1 FROM public.effective_iam_roles($1::uuid,m.organization_id))
    UNION SELECT 'platform' WHERE EXISTS(SELECT 1 FROM public.effective_iam_roles($1::uuid,NULL))
   ) contexts WHERE context_key>$2 ORDER BY context_key LIMIT $3`,[actor.id,after,query.limit+1])).rows;
   const items=[];for(const row of keys)items.push(await authorizationContext(client,actor,row.context_key));
   return page(actor,kind,items,query.limit,item=>item.contextKey);
  });
 }
 async platformUsers(token:string,key:string,query:PageRequest){
  return this.read(token,async(client,actor)=>{
   requireAll((await authorizationContext(client,actor,key)).permissions,['platform.roles.manage']);
   const kind='platform-users',after=afterCursor(actor,kind,query.cursor);
   const users=(await client.query(`SELECT u.id AS "userId",u.display_name AS "displayName" FROM public.users u
    WHERE u.status='active' AND u.id::text>$1 AND EXISTS(SELECT 1 FROM public.external_identities e
     JOIN public.identity_profiles p ON p.identity_id=e.id AND p.user_id=e.user_id WHERE e.user_id=u.id AND p.identified_at IS NOT NULL)
    ORDER BY u.id LIMIT $2`,[after,query.limit+1])).rows;
   const result=page(actor,kind,users,query.limit,item=>item.userId);
   const assignments=result.items.length?(await client.query<PlatformAssignment>(`SELECT ${assignmentColumns} FROM public.iam_role_assignments
    WHERE user_id=ANY($1::uuid[]) AND scope_type='platform' ORDER BY user_id,role_code`,[result.items.map(user=>user.userId)])).rows:[];
   const byUser=new Map<string,PlatformAssignment[]>();
   for(const assignment of assignments){
    const roles=byUser.get(assignment.userId)??[];roles.push(assignment);byUser.set(assignment.userId,roles);
   }
   return {...result,items:result.items.map(user=>({...user,platformRoles:byUser.get(user.userId)??[]}))};
  });
 }
 async members(token:string,key:string,organizationId:string,query:PageRequest){
  return this.read(token,async(client,actor)=>{
   if(key!==`organization:${organizationId}`)throw new AuthError('forbidden',403);
   requireAll((await authorizationContext(client,actor,key)).permissions,['organization.members.manage']);
   const kind=`members:${organizationId}`,after=afterCursor(actor,kind,query.cursor);
   const rows=(await client.query<MemberSummary>(`SELECT m.id,m.user_id AS "userId",u.display_name AS "displayName",m.status,m.version
    FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.id::text>$2 ORDER BY m.id LIMIT $3`,[organizationId,after,query.limit+1])).rows;
   const items=[];for(const member of rows)items.push(await projectMember(client,organizationId,member));
   return page(actor,kind,items,query.limit,item=>item.id);
  });
 }
 async userAccess(token:string,key:string,query:PageRequest){
  return this.read(token,async(client,actor)=>{
   if(key!=='platform')throw new AuthError('forbidden',403);
   requireAll((await authorizationContext(client,actor,key)).permissions,['platform.roles.manage']);
   const kind='platform-user-access',after=afterCursor(actor,kind,query.cursor);
   const users=(await client.query<UserAccess>(`SELECT u.id AS "userId",u.display_name AS "displayName",u.status,
    u.access_version::double precision AS version FROM public.users u WHERE u.id::text>$1 ORDER BY u.id LIMIT $2`,[after,query.limit+1])).rows;
   const result=page(actor,kind,users,query.limit,item=>item.userId);
   const assignments=result.items.length?(await client.query<PlatformAssignment>(`SELECT ${assignmentColumns} FROM public.iam_role_assignments
    WHERE user_id=ANY($1::uuid[]) AND scope_type='platform' ORDER BY user_id,role_code`,[result.items.map(user=>user.userId)])).rows:[];
   const byUser=new Map<string,PlatformAssignment[]>();
   for(const assignment of assignments){
    const roles=byUser.get(assignment.userId)??[];roles.push(assignment);byUser.set(assignment.userId,roles);
   }
   return {...result,items:result.items.map(user=>({...user,platformRoles:byUser.get(user.userId)??[]}))};
  });
 }
 async audit(token:string,key:string,query:PageRequest){
  return this.read(token,async(client,actor)=>{
   const context=await authorizationContext(client,actor,key);requireAll(context.permissions,['platform.audit.read']);
   const kind='audit',after=afterCursor(actor,kind,query.cursor);
   const rows=(await client.query(`SELECT id,actor_user_id AS "actorUserId",action,occurred_at AS "occurredAt",
    jsonb_strip_nulls(jsonb_build_object('assignmentId',data->'assignmentId','targetUserId',data->'targetUserId',
     'roleCode',data->'roleCode','status',data->'status','reason',data->'reason','resourceId',data->'resourceId')) AS data
    FROM public.audit_events WHERE action IN ('IAMPlatformAdminBootstrapped','IAMPlatformRoleGranted','IAMPlatformRoleUpdated',
     'IAMModerationReviewed','IAMRestrictionChanged','IAMUserAccessChanged') AND ($1::boolean OR actor_user_id=$2) AND id::text>$3
    ORDER BY id LIMIT $4`,[context.roles.includes('platform_admin'),actor.id,after,query.limit+1])).rows;
   return page(actor,kind,rows,query.limit,item=>item.id);
  });
 }
}
