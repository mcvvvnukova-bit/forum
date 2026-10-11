import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';

let pool:Pool,app:NestFastifyApplication;
type User={id:string;token:string;cookie:string};
let alice:User,bob:User;
before(async()=>{
 const connectionString=testDatabaseUrl(process.env.TEST_DATABASE_URL);
 pool=new Pool({connectionString});await migrate(pool);
});
after(async()=>{await app?.close();await pool?.end()});
beforeEach(async()=>{
 await app?.close();
 app=await createApp({publicOrigin:'https://forum.example',databaseUrl:testDatabaseUrl(process.env.TEST_DATABASE_URL),secureCookies:false,sessionTtlSeconds:3600},pool);
 await pool.query('TRUNCATE public.users,public.organizations,public.audit_events,public.outbox_events CASCADE');
 alice=await user('Alice');bob=await user('Bob');
});
async function user(name:string,phone:string|null=null):Promise<User>{
 const token=Buffer.from(randomUUID()).toString('base64url').slice(0,43);
 const store=new AuthStore(pool);
 await store.authenticate({subject:randomUUID(),alternateSubjects:[],displayName:name,email:null,emailConfirmed:false,
  claims:{},profile:{family_name:name,phone_number:phone}},'login',token,3600);
 return {id:(await store.session(token)).user.id,token,cookie:`forum_session=${token}`};
}
function get(url:string,actor=alice,context?:string){
 return app.inject({method:'GET',url,headers:{cookie:actor.cookie,...(context?{'x-forum-context':context}:{})}});
}
function resolve(contextKey:string,actor=alice){
 return app.inject({method:'POST',url:'/api/iam/context/resolve',headers:{cookie:actor.cookie},payload:{contextKey}});
}

// Missing/unguarded context routes would let ordinary accounts claim platform authority.
test('ordinary account cannot enter platform context',async()=>{
 assert.equal((await resolve('platform')).statusCode,403);
});
test('catalogue authenticates guests and contains exactly the six scoped roles',async()=>{
 assert.equal((await app.inject({method:'GET',url:'/api/iam/roles'})).statusCode,401);
 const response=await get('/api/iam/roles');assert.equal(response.statusCode,200,response.body);
 assert.deepEqual(response.json().items.map((r:{code:string})=>r.code),[
  'individual','organization_employee','organization_admin','organization_signer','platform_moderator','platform_admin']);
 assert.deepEqual(response.json().items.find((r:{code:string})=>r.code==='organization_signer').conditionalPermissions,['organization.documents.sign']);
 assert.equal(response.headers['cache-control'],'no-store');
});
test('personal context works without a participant and never resolves another person',async()=>{
 const response=await resolve(`person:${alice.id}`);assert.equal(response.statusCode,200,response.body);
 assert.deepEqual(response.json(),{contextKey:`person:${alice.id}`,participantId:null,roles:['individual'],
  permissions:['personal.profile.read','personal.profile.update','personal.business.use','organization.add'],accessVersion:1});
 assert.equal((await resolve(`person:${bob.id}`)).statusCode,403);
 assert.equal((await pool.query('SELECT count(*) FROM public.participants')).rows[0].count,'0');
});
test('session preserves baseline fields while exposing current platform roles version and session CSRF',async()=>{
 const response=await get('/api/auth/session');assert.equal(response.statusCode,200,response.body);
 const data=response.json();assert.deepEqual(data.roles,['individual']);assert.equal(data.participant,null);
 assert.deepEqual(data.platformRoles,[]);assert.equal(data.accessVersion,1);assert.match(data.csrfToken,/^[\w-]{43}$/);
 assert.equal((await get('/api/auth/session')).json().csrfToken,data.csrfToken);
});
test('platform list and grants are inaccessible to ordinary accounts',async()=>{
 assert.equal((await get('/api/iam/platform-users',alice,'platform')).statusCode,403);
 const response=await app.inject({method:'POST',url:'/api/iam/platform-role-assignments',headers:{cookie:alice.cookie,
  origin:'https://forum.example','x-forum-context':'platform','x-forum-csrf':'x'.repeat(43),'idempotency-key':randomUUID()},
  payload:{targetUserId:alice.id,roleCode:'platform_admin',reason:'Self elevation'}});
 assert.equal(response.statusCode,403);
});

async function platformAdmin(actor=alice){
 return (await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason)
  VALUES($1,'platform','platform_admin',$1,'Trusted test fixture') RETURNING id`,[actor.id])).rows[0].id as string;
}
async function mutate(url:string,payload:Record<string,unknown>,actor=alice,context='platform',headers:Record<string,string>={}){
 const session=(await get('/api/auth/session',actor)).json();
 return app.inject({method:url.endsWith('platform-role-assignments')?'POST':'PATCH',url,
  headers:{cookie:actor.cookie,origin:'https://forum.example','x-forum-context':context,'x-forum-csrf':session.csrfToken,
   'idempotency-key':randomUUID(),...headers},payload});
}
const grant=(targetUserId:string,roleCode='platform_moderator')=>({targetUserId,roleCode,reason:'Reviewed duty assignment'});
async function company(){
 const id=randomUUID();await pool.query(`INSERT INTO public.organizations(id,legal_status,inn,legal_name,registration_state,registered_at)
  VALUES($1,'legal_entity',$2,'Synthetic organization','registered',now())`,[id,String(Math.floor(Math.random()*9000000000)+1000000000)]);
 return id;
}
async function membership(actor:User,organizationId:string,roles=['organization_employee']){
 const id=(await pool.query(`INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from)
  VALUES($1,$2,'active','legacy','trusted test evidence',now()) RETURNING id`,[actor.id,organizationId])).rows[0].id;
 for(const role of roles)await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason)
  VALUES($1,'organization',$2,$3,$4,$1,'Trusted fixture')`,[actor.id,organizationId,id,role]);
 return id as string;
}
async function authority(actor:User,organizationId:string,type='administrator',expired=false){
 return pool.query(`INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,status,basis_type,basis_reference,
  approved_by_user_id,decided_at,effective_from,effective_until,allowed_actions)
  VALUES($1,$2,$3,'confirmed','trusted_adapter','Synthetic verified evidence',$1,now(),now()-interval '1 day',
   CASE WHEN $4 THEN now()-interval '1 second' ELSE NULL END,$5)`,[actor.id,organizationId,type,expired,
    type==='signer'?['organization.documents.sign']:[]]);
}

test('platform admin grants only service roles and revocation is visible with the old cookie',async()=>{
 await platformAdmin();const response=await mutate('/api/iam/platform-role-assignments',grant(bob.id));
 assert.equal(response.statusCode,201,response.body);const item=response.json().item;
 assert.equal(item.roleCode,'platform_moderator');assert.equal(item.userId,bob.id);assert.equal(item.version,1);
 assert.deepEqual((await get('/api/auth/session',bob)).json().platformRoles,['platform_moderator']);
 const context=(await resolve('platform',bob)).json();
 assert.deepEqual(context.permissions,['platform.moderation.review','platform.restrictions.manage','platform.audit.read']);
 assert.equal((await get('/api/iam/platform-users',bob,'platform')).statusCode,403);
 const revoke=await mutate(`/api/iam/platform-role-assignments/${item.id}`,{status:'revoked',reason:'Duty completed'},alice,'platform',{'if-match':'"1"'});
 assert.equal(revoke.statusCode,200,revoke.body);assert.equal(revoke.json().item.version,2);
 assert.equal((await resolve('platform',bob)).statusCode,403);
 assert.deepEqual((await get('/api/auth/session',bob)).json().platformRoles,[]);
 assert.equal((await get('/api/auth/session',bob)).json().accessVersion,3);
});
test('mutations require valid Origin CSRF context and idempotency headers',async()=>{
 await platformAdmin();
 for(const [headers,status,code] of [
  [{origin:''},403,'invalid_origin'],[{origin:'https://evil.example'},403,'invalid_origin'],
  [{'x-forum-csrf':''},403,'invalid_csrf'],[{'x-forum-csrf':'x'.repeat(43)},403,'invalid_csrf'],
  [{'x-forum-context':''},400,'context_required'],[{'x-forum-context':`person:${alice.id}`},403,'forbidden'],
  [{'idempotency-key':''},400,'invalid_request'],[{'idempotency-key':'a b'},400,'invalid_request']
 ] as Array<[Record<string,string>,number,string]>){
  const r=await mutate('/api/iam/platform-role-assignments',grant(bob.id),alice,'platform',headers);
  assert.equal(r.statusCode,status,r.body);assert.equal(r.json().code,code);
 }
 assert.equal((await pool.query('SELECT count(*) FROM public.iam_role_assignments')).rows[0].count,'1');
});
test('strict request validation rejects foreign roles unknown fields malformed targets and query values',async()=>{
 await platformAdmin();
 for(const body of [grant(bob.id,'organization_admin'),grant(bob.id,'unknown'),grant('bad'),{...grant(bob.id),reason:''},
  {...grant(bob.id),actorUserId:bob.id},{...grant(bob.id),scopeId:randomUUID()}]){
  assert.equal((await mutate('/api/iam/platform-role-assignments',body)).statusCode,400);
 }
 for(const suffix of ['?limit=0','?limit=101','?limit=1.2','?limit=2&limit=3','?cursor=invalid','?userId='+bob.id]){
  assert.equal((await get('/api/iam/platform-users'+suffix,alice,'platform')).statusCode,400);
 }
 assert.equal((await get('/api/iam/platform-users',alice)).json().code,'context_required');
 assert.equal((await resolve('organization:bad')).statusCode,400);
 const unverified=await user('Unverified');await pool.query('DELETE FROM public.identity_profiles WHERE user_id=$1',[unverified.id]);
 await pool.query('DELETE FROM public.external_identities WHERE user_id=$1',[unverified.id]);
 assert.equal((await mutate('/api/iam/platform-role-assignments',grant(unverified.id))).statusCode,404);
 await pool.query("UPDATE public.users SET status='deactivated' WHERE id=$1",[bob.id]);
 assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id))).statusCode,404);
});
test('idempotency returns the original result rejects changed requests and reauthorizes replays',async()=>{
 const adminId=await platformAdmin();const key=randomUUID();
 const first=await mutate('/api/iam/platform-role-assignments',grant(bob.id),alice,'platform',{'idempotency-key':key});
 const replay=await mutate('/api/iam/platform-role-assignments',grant(bob.id),alice,'platform',{'idempotency-key':key});
 assert.equal(first.statusCode,201,first.body);assert.equal(replay.statusCode,201,replay.body);assert.deepEqual(replay.json(),first.json());
 assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id,'platform_admin'),alice,'platform',{'idempotency-key':key})).statusCode,409);
 assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='IAMPlatformRoleGranted'")).rows[0].count,'1');
 await pool.query("UPDATE public.iam_role_assignments SET status='revoked',revoked_at=now() WHERE id=$1",[adminId]);
 assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id),alice,'platform',{'idempotency-key':key})).statusCode,403);
});
test('If-Match rejects missing malformed and stale updates without changing the role',async()=>{
 await platformAdmin();const id=(await mutate('/api/iam/platform-role-assignments',grant(bob.id))).json().item.id;
 for(const [value,status] of [['',400],['1',400],['"0"',400],['"2"',412]] as const){
  const r=await mutate(`/api/iam/platform-role-assignments/${id}`,{status:'revoked',reason:'Retired'},alice,'platform',{'if-match':value});
  assert.equal(r.statusCode,status,r.body);
 }
 assert.equal((await resolve('platform',bob)).statusCode,200);
});
test('parallel platform administrator revocations retain one current administrator',async()=>{
 const a=await platformAdmin(),b=await platformAdmin(bob);
 const responses=await Promise.all([
  mutate(`/api/iam/platform-role-assignments/${a}`,{status:'revoked',reason:'Retire Alice'},alice,'platform',{'if-match':'"1"'}),
  mutate(`/api/iam/platform-role-assignments/${b}`,{status:'revoked',reason:'Retire Bob'},bob,'platform',{'if-match':'"1"'})]);
 assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal((await pool.query("SELECT count(*) FROM public.iam_role_assignments WHERE role_code='platform_admin' AND status='active'")).rows[0].count,'1');
});
test('audit insertion failure rolls back role access version and idempotency together',async()=>{
 await platformAdmin();await pool.query(`CREATE FUNCTION public.fail_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='IAMPlatformRoleGranted' THEN RAISE EXCEPTION 'Synthetic audit storage failure';END IF;RETURN NEW;END $$;
  CREATE TRIGGER fail_role_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_role_audit()`);
 try{
  assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id))).statusCode,503);
  assert.equal((await pool.query('SELECT count(*) FROM public.iam_role_assignments WHERE user_id=$1',[bob.id])).rows[0].count,'0');
  assert.equal((await get('/api/auth/session',bob)).json().accessVersion,1);
  assert.equal((await pool.query('SELECT count(*) FROM public.iam_idempotency')).rows[0].count,'0');
 }finally{await pool.query('DROP TRIGGER fail_role_audit ON public.audit_events;DROP FUNCTION public.fail_role_audit()')}
});
test('two organization contexts stay isolated from platform authority and business participants',async()=>{
 const a=await company(),b=await company();await membership(alice,a,['organization_admin']);await authority(alice,a);
 await membership(alice,b);await platformAdmin();
 const ca=(await resolve(`organization:${a}`)).json(),cb=(await resolve(`organization:${b}`)).json();
 assert.equal(ca.participantId,null);assert.deepEqual(ca.roles,['organization_admin']);
 assert.ok(ca.permissions.includes('organization.members.manage'));assert.ok(!ca.permissions.includes('platform.roles.manage'));
 assert.deepEqual(cb.permissions,['organization.business.read','organization.business.draft']);
 assert.equal((await get(`/api/iam/organizations/${b}/members`,alice,`organization:${b}`)).statusCode,403);
 assert.equal((await get(`/api/iam/organizations/${a}/members`,alice,'platform')).statusCode,403);
 assert.equal((await get(`/api/iam/organizations/${a}/members`,bob,`organization:${a}`)).statusCode,403);
 const list=(await get('/api/me/organizations')).json();assert.equal(list.items.length,2,'Membership alone permits viewing own company');
});
test('corporate roles require current membership organization state administrator and signer evidence',async()=>{
 const org=await company(),id=await membership(alice,org,['organization_admin','organization_signer']);
 await authority(alice,org);let c=(await resolve(`organization:${org}`)).json();
 assert.ok(c.roles.includes('organization_signer'));assert.ok(!c.permissions.includes('organization.documents.sign'));
 await authority(alice,org,'signer',true);assert.ok(!(await resolve(`organization:${org}`)).json().permissions.includes('organization.documents.sign'));
 await pool.query("UPDATE public.organization_authorities SET effective_until=NULL WHERE authority_type='signer'");
 assert.ok((await resolve(`organization:${org}`)).json().permissions.includes('organization.documents.sign'));
 await pool.query("UPDATE public.organization_authorities SET status='revoked',revoked_at=now() WHERE authority_type='administrator'");
 assert.ok(!(await resolve(`organization:${org}`)).json().roles.includes('organization_admin'));
 await pool.query("UPDATE public.organizations SET status='restricted' WHERE id=$1",[org]);assert.equal((await resolve(`organization:${org}`)).statusCode,403);
 await pool.query("UPDATE public.organizations SET status='active' WHERE id=$1",[org]);
 await pool.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=now() WHERE id=$1",[id]);
 assert.equal((await resolve(`organization:${org}`)).statusCode,403);
});
test('corporate member updates cannot select foreign membership service roles or signer proof',async()=>{
 const org=await company(),foreign=await company();await membership(alice,org,['organization_admin']);await authority(alice,org);
 const id=await membership(bob,org),foreignId=await membership(bob,foreign);
 const url=`/api/iam/organizations/${org}/members/`;
 const payload={roles:['organization_signer'],status:'active',reason:'Draft signer duty'};
 assert.equal((await mutate(url+foreignId,payload,alice,`organization:${org}`,{'if-match':'"1"'})).statusCode,404);
 assert.equal((await mutate(url+id,{...payload,roles:['platform_admin']},alice,`organization:${org}`,{'if-match':'"1"'})).statusCode,400);
 assert.equal((await mutate(url+id,{...payload,approved:true},alice,`organization:${org}`,{'if-match':'"1"'})).statusCode,400);
 const response=await mutate(url+id,payload,alice,`organization:${org}`,{'if-match':'"1"'});assert.equal(response.statusCode,200,response.body);
 assert.equal(response.json().item.version,2);assert.deepEqual(response.json().item.roles,['organization_signer']);
 assert.ok(!(await resolve(`organization:${org}`,bob)).json().permissions.includes('organization.documents.sign'));
 assert.equal((await mutate(url+id,payload,alice,`organization:${org}`,{'if-match':'"1"'})).statusCode,412);
 const revoke=await mutate(url+id,{roles:[],status:'revoked',reason:'Ended membership'},alice,`organization:${org}`,{'if-match':'"2"'});
 assert.equal(revoke.statusCode,200,revoke.body);assert.equal((await resolve(`organization:${org}`,bob)).statusCode,403);
});
test('member PATCH GET round trip preserves dormant assignments while separating current rights and signer proof',async()=>{
 const org=await company();await membership(alice,org,['organization_admin']);await authority(alice,org);
 const id=await membership(bob,org),key=`organization:${org}`;
 const patch=await mutate(`/api/iam/organizations/${org}/members/${id}`,{
  roles:['organization_admin','organization_signer'],status:'active',reason:'Assigned duties awaiting independent proof'},alice,key,{'if-match':'"1"'});
 assert.equal(patch.statusCode,200,patch.body);
 assert.deepEqual(patch.json().item,{id,userId:bob.id,displayName:'Bob',status:'active',version:2,
  roles:['organization_admin','organization_signer'],effectiveRoles:['organization_signer'],
  permissions:['organization.business.read','organization.business.draft']});
 const getResponse=await get(`/api/iam/organizations/${org}/members`,alice,key);assert.equal(getResponse.statusCode,200,getResponse.body);
 const found=getResponse.json().items.find((item:{id:string})=>item.id===id);
 assert.deepEqual(found,patch.json().item);
 assert.ok(!found.permissions.includes('organization.documents.sign'));assert.ok(!found.permissions.includes('organization.members.manage'));
 await authority(bob,org);await authority(bob,org,'signer');
 const current=(await get(`/api/iam/organizations/${org}/members`,alice,key)).json().items.find((item:{id:string})=>item.id===id);
 assert.deepEqual(current.roles,['organization_admin','organization_signer']);assert.deepEqual(current.effectiveRoles,['organization_admin','organization_signer']);
 assert.ok(current.permissions.includes('organization.members.manage'));assert.ok(current.permissions.includes('organization.documents.sign'));
 assert.equal(current.version,2,'Evidence does not rewrite assigned duties');
});
test('parallel corporate admin removals cannot remove the last effective company admin',async()=>{
 const org=await company();const a=await membership(alice,org,['organization_admin']),b=await membership(bob,org,['organization_admin']);
 await authority(alice,org);await authority(bob,org);
 const responses=await Promise.all([a,b].map((id,i)=>mutate(`/api/iam/organizations/${org}/members/${id}`,
  {roles:['organization_employee'],status:'active',reason:'End admin duty'},i===0?alice:bob,`organization:${org}`,{'if-match':'"1"'})));
 assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
});
test('blocked user loses platform and company rights even when the account is the last admin',async()=>{
 await platformAdmin();await pool.query("UPDATE public.users SET status='deactivated' WHERE id=$1",[alice.id]);
 assert.equal((await get('/api/auth/session')).statusCode,401);assert.equal((await resolve('platform')).statusCode,401);
});
test('platform pagination is owner bound and exposes no private profiles or provider data',async()=>{
 await platformAdmin();await platformAdmin(bob);
 const first=await get('/api/iam/platform-users?limit=1',alice,'platform');assert.equal(first.statusCode,200,first.body);
 assert.equal(first.json().items.length,1);assert.ok(first.json().nextCursor);
 const second=await get('/api/iam/platform-users?limit=1&cursor='+encodeURIComponent(first.json().nextCursor),alice,'platform');
 assert.equal(second.json().items.length,1);assert.equal(second.json().nextCursor,null);
 assert.notEqual(second.json().items[0].userId,first.json().items[0].userId);
 assert.equal((await get('/api/iam/platform-users?cursor='+encodeURIComponent(first.json().nextCursor),bob,'platform')).statusCode,400);
 assert.deepEqual(Object.keys(first.json().items[0]).sort(),['displayName','platformRoles','userId']);
 for(const text of ['phone_number','claims_snapshot','sber_profile','csrfToken','email','token_hash'])assert.ok(!first.body.includes(text));
});
test('moderator audit is confined to own decisions and platform admin reads all service decisions',async()=>{
 await platformAdmin();await mutate('/api/iam/platform-role-assignments',grant(bob.id));
 await pool.query(`INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES
  (gen_random_uuid(),$1,'IAMModerationReviewed','{"resourceId":"synthetic"}'),
  (gen_random_uuid(),$1,'UserAuthenticated','{"provider":"sber_id"}')`,[bob.id]);
 const own=(await get('/api/iam/audit-events',bob,'platform')).json();assert.equal(own.items.length,1);
 assert.equal(own.items[0].action,'IAMModerationReviewed');assert.equal(own.items[0].actorUserId,bob.id);
 assert.equal((await get('/api/iam/audit-events',alice,'platform')).json().items.length,2);
});

async function bootstrap(phone:string,expectedUserId:string){
 const modulePath='../src/bootstrap-platform-admin.js';
 const {bootstrapPlatformAdmin}=await import(modulePath);
 return bootstrapPlatformAdmin(pool,{phone,expectedUserId,reason:'Authorized synthetic owner bootstrap'});
}
test('bootstrap accepts exactly one canonical active Sber match and is audited once',async()=>{
 await pool.query('UPDATE public.persons SET phone_number=$2 WHERE user_id=$1',[alice.id,'+79010000001']);
 const first=await bootstrap('8 (901) 000-00-01',alice.id);const second=await bootstrap('+79010000001',alice.id);
 assert.deepEqual(second,first);assert.equal(first.userId,alice.id);
 assert.deepEqual((await get('/api/auth/session')).json().platformRoles,['platform_admin']);
 assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='IAMPlatformAdminBootstrapped'")).rows[0].count,'1');
});
test('bootstrap fails on zero multiple mismatched or unverified accounts without changes',async()=>{
 await assert.rejects(bootstrap('+79010000001',alice.id));
 await pool.query('UPDATE public.persons SET phone_number=$1',['+79010000001']);
 await assert.rejects(bootstrap('+79010000001',alice.id));
 await pool.query('UPDATE public.persons SET phone_number=NULL WHERE user_id=$1',[bob.id]);
 await assert.rejects(bootstrap('+79010000001',bob.id));
 await pool.query('DELETE FROM public.identity_profiles WHERE user_id=$1',[alice.id]);
 await pool.query('DELETE FROM public.external_identities WHERE user_id=$1',[alice.id]);
 await assert.rejects(bootstrap('+79010000001',alice.id));
 assert.equal((await pool.query('SELECT count(*) FROM public.iam_role_assignments')).rows[0].count,'0');
});
test('bootstrap cannot bypass another administrator and phone reassignment never transfers authority',async()=>{
 await pool.query('UPDATE public.persons SET phone_number=$2 WHERE user_id=$1',[alice.id,'+79010000001']);
 await bootstrap('+79010000001',alice.id);
 await pool.query('UPDATE public.persons SET phone_number=CASE WHEN user_id=$1 THEN NULL ELSE $2 END',[alice.id,'+79010000001']);
 await assert.rejects(bootstrap('+79010000001',bob.id));
 assert.deepEqual((await get('/api/auth/session')).json().platformRoles,['platform_admin']);
 assert.deepEqual((await get('/api/auth/session',bob)).json().platformRoles,[]);
});

test('multi-permission checks require every known permission and reject unknown codes',async()=>{
 const modulePath='../src/iam/role-catalog.js';const {requireAll}=await import(modulePath);
 assert.doesNotThrow(()=>requireAll(['organization.business.read','organization.business.draft'],['organization.business.read','organization.business.draft']));
 assert.throws(()=>requireAll(['organization.business.read'],['organization.business.read','organization.business.publish']));
 assert.throws(()=>requireAll(['invented.permission'],['invented.permission']));
});
test('context cursors are signed user-bound pages and resolving contexts never switches a shared session',async()=>{
 await platformAdmin();const org=await company();await membership(alice,org);
 const firstResponse=await get('/api/iam/contexts?limit=1');assert.equal(firstResponse.statusCode,200,firstResponse.body);
 const first=firstResponse.json();assert.equal(first.items.length,1);assert.ok(first.nextCursor);
 const second=(await get('/api/iam/contexts?limit=1&cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(second.items.length,1);
 assert.notEqual(first.items[0].contextKey,second.items[0].contextKey);
 assert.equal((await get('/api/iam/contexts?cursor='+encodeURIComponent(first.nextCursor),bob)).statusCode,400);
 const decoded=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString());decoded[0]=decoded[0].replace(org,randomUUID());
 assert.equal((await get('/api/iam/contexts?cursor='+Buffer.from(JSON.stringify(decoded)).toString('base64url'))).statusCode,400);
 const before=(await get('/api/auth/session')).json();await resolve('platform');await resolve(`organization:${org}`);
 assert.deepEqual((await get('/api/auth/session')).json(),before);
});
test('signer authority must cover signing and be current confirmed and unrevoked',async()=>{
 const org=await company();await membership(alice,org,['organization_signer']);await authority(alice,org,'signer');
 const key=`organization:${org}`;
 assert.ok((await resolve(key)).json().permissions.includes('organization.documents.sign'));
 await pool.query("UPDATE public.organization_authorities SET allowed_actions='{}' WHERE organization_id=$1",[org]);
 assert.ok(!(await resolve(key)).json().permissions.includes('organization.documents.sign'));
 await pool.query("UPDATE public.organization_authorities SET allowed_actions=ARRAY['organization.documents.sign'],status='revoked',revoked_at=now() WHERE organization_id=$1",[org]);
 assert.ok(!(await resolve(key)).json().permissions.includes('organization.documents.sign'));
});
test('expired or future memberships grants and unregistered organizations fail closed',async()=>{
 const org=await company();await membership(alice,org);
 await pool.query("UPDATE public.iam_role_assignments SET effective_from=now()-interval '1 day',effective_until=now()-interval '1 second' WHERE user_id=$1",[alice.id]);
 assert.equal((await resolve(`organization:${org}`)).statusCode,403);
 await pool.query("UPDATE public.iam_role_assignments SET effective_until=NULL WHERE user_id=$1",[alice.id]);
 await pool.query("UPDATE public.organization_memberships SET effective_from=now()+interval '1 day' WHERE user_id=$1",[alice.id]);
 assert.equal((await resolve(`organization:${org}`)).statusCode,403);
 await pool.query("UPDATE public.organization_memberships SET effective_from=now()-interval '1 day',effective_until=now()-interval '1 second' WHERE user_id=$1",[alice.id]);
 assert.equal((await resolve(`organization:${org}`)).statusCode,403);
 await pool.query("UPDATE public.organization_memberships SET effective_until=NULL WHERE user_id=$1",[alice.id]);
 await pool.query("UPDATE public.organizations SET registration_state='pending',registered_at=NULL WHERE id=$1",[org]);
 assert.equal((await resolve(`organization:${org}`)).statusCode,403);
});
test('database constraints forbid foreign membership scope role ownership reassignment and duplicate grants',async()=>{
 const org=await company(),foreign=await company(),id=await membership(alice,org);
 const assignment=(await pool.query('SELECT id FROM public.iam_role_assignments WHERE user_id=$1',[alice.id])).rows[0].id;
 for(const [sql,args] of [
  ['UPDATE public.iam_role_assignments SET user_id=$2 WHERE id=$1',[assignment,bob.id]],
  ['UPDATE public.iam_role_assignments SET scope_id=$2 WHERE id=$1',[assignment,foreign]],
  ['UPDATE public.iam_role_assignments SET role_code=$2 WHERE id=$1',[assignment,'organization_admin']],
  ["INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason) VALUES($1,'organization',$2,$3,'organization_signer',$1,'invalid owner')",[bob.id,org,id]],
  ["INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason) VALUES($1,'organization',$2,$3,'platform_admin',$1,'invalid scope')",[alice.id,org,id]],
  ["INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason) VALUES($1,'organization',$2,$3,'organization_employee',$1,'duplicate')",[alice.id,org,id]],
 ] as Array<[string,unknown[]]>)await assert.rejects(pool.query(sql,args));
});
test('partial deployment makes readiness sessions and IAM context fail closed',async()=>{
 await pool.query("DELETE FROM public.schema_migrations WHERE name='008_iam_roles'");
 try{
  for(const url of ['/health/ready','/api/auth/session','/api/iam/roles'])assert.equal((await get(url)).statusCode,503,url);
  assert.equal((await resolve(`person:${alice.id}`)).statusCode,503);
 }finally{await pool.query("INSERT INTO public.schema_migrations(name) VALUES('008_iam_roles')")}
});
test('rollback refuses live assignments and audits but empty schema rolls back and migrates again',async()=>{
 const sql=await readFile('../../deployment/forum-api/rollback-008-iam-roles.sql','utf8');await platformAdmin();
 const client=await pool.connect();try{
  await assert.rejects(client.query(sql),/IAM data exists/);await client.query('ROLLBACK');
  assert.ok((await client.query("SELECT to_regclass('public.iam_role_assignments') AS present")).rows[0].present);
  await client.query('TRUNCATE public.users,public.audit_events CASCADE');
  await client.query("INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES(gen_random_uuid(),gen_random_uuid(),'IAMHistoricalDecision','{}')");
  await assert.rejects(client.query(sql),/IAM data exists/);await client.query('ROLLBACK');
  await client.query('TRUNCATE public.audit_events');await client.query(sql);
  assert.equal((await client.query("SELECT to_regclass('public.iam_role_assignments') AS present")).rows[0].present,null);
 }finally{await client.query('ROLLBACK');client.release();await migrate(pool)}
 assert.equal((await get('/health/ready')).statusCode,200);
});
function runtimeGrants(role:string,sql:string){
 const url=new URL(testDatabaseUrl(process.env.TEST_DATABASE_URL));const container=process.env.TEST_DATABASE_CONTAINER;
 assert.ok(container&&/^[\w.-]+$/.test(container));assert.equal(url.hostname,'127.0.0.1');
 const binding=spawnSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'});assert.equal(binding.status,0,binding.stderr);
 assert.equal(binding.stdout.trim(),`127.0.0.1:${url.port||'5432'}`);
 const result=spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'psql','-X','-h','127.0.0.1','-U',decodeURIComponent(url.username),
  '-d',decodeURIComponent(url.pathname.slice(1)),'-v','ON_ERROR_STOP=1'],{input:`\\set app_role ${role}\n${sql}`,encoding:'utf8',
   env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}});
 assert.equal(result.status,0,result.stderr);
}
test('restricted runtime executes real role grants member updates reads and rejects owner/evidence/DDL writes',async()=>{
 await platformAdmin();const org=await company();await membership(alice,org,['organization_admin']);await authority(alice,org);
 const memberId=await membership(bob,org);
 await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forum_role_runtime') THEN CREATE ROLE forum_role_runtime;END IF;END $$");
 runtimeGrants('forum_role_runtime',await readFile('../../deployment/forum-api/grant-runtime.sql','utf8'));
 const restricted=new Pool({connectionString:testDatabaseUrl(process.env.TEST_DATABASE_URL),options:'-c role=forum_role_runtime'});
 const ownerApp=app;app=await createApp({publicOrigin:'https://forum.example',databaseUrl:testDatabaseUrl(process.env.TEST_DATABASE_URL),secureCookies:false,sessionTtlSeconds:3600},restricted);
 try{
  assert.equal((await get('/health/ready')).statusCode,200);
  assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id))).statusCode,201);
  assert.equal((await get('/api/iam/platform-users',alice,'platform')).statusCode,200);
  const result=await mutate(`/api/iam/organizations/${org}/members/${memberId}`,{roles:['organization_signer'],status:'active',reason:'Reviewed signer duty'},alice,`organization:${org}`,{'if-match':'"1"'});
  assert.equal(result.statusCode,200,result.body);
  assert.equal((await get(`/api/iam/organizations/${org}/members`,alice,`organization:${org}`)).statusCode,200);
  for(const statement of [
   'CREATE TABLE public.forbidden_iam(id int)','DELETE FROM public.iam_role_assignments',
   'UPDATE public.iam_role_assignments SET user_id=gen_random_uuid()',
   'UPDATE public.organization_memberships SET approved_by_user_id=user_id',
   "INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,basis_type,basis_reference) VALUES(gen_random_uuid(),gen_random_uuid(),'signer','self','invalid')",
   'UPDATE public.iam_idempotency SET request_hash=request_hash'
  ])await assert.rejects(restricted.query(statement),{code:'42501'});
  assert.equal((await restricted.query('SELECT current_user AS actor')).rows[0].actor,'forum_role_runtime');
  await pool.query('REVOKE INSERT ON public.audit_events FROM forum_role_runtime');
  const before=(await get('/api/auth/session',bob)).json().accessVersion;
  assert.equal((await mutate('/api/iam/platform-role-assignments',grant(bob.id,'platform_admin'))).statusCode,503);
  assert.equal((await get('/api/auth/session',bob)).json().accessVersion,before);
  assert.equal((await pool.query("SELECT count(*) FROM public.iam_role_assignments WHERE user_id=$1 AND role_code='platform_admin'",[bob.id])).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM public.iam_idempotency')).rows[0].count,'2');
  await pool.query('GRANT INSERT ON public.audit_events TO forum_role_runtime');
  await pool.query('REVOKE INSERT ON public.iam_idempotency FROM forum_role_runtime');
  assert.equal((await get('/health/ready')).statusCode,503);
  await pool.query('GRANT INSERT ON public.iam_idempotency TO forum_role_runtime');
  for(const [revoke,restore] of [
   ['UPDATE(reason) ON public.iam_role_assignments','UPDATE(reason) ON public.iam_role_assignments'],
   ['UPDATE(revoked_at) ON public.organization_memberships','UPDATE(revoked_at) ON public.organization_memberships'],
   ['INSERT ON public.audit_events','INSERT ON public.audit_events'],
   ['EXECUTE ON FUNCTION public.guard_iam_role_owner()','EXECUTE ON FUNCTION public.guard_iam_role_owner()']
  ]){
   await pool.query(`REVOKE ${revoke} FROM forum_role_runtime`);
   try{assert.equal((await get('/health/ready')).statusCode,503,revoke)}
   finally{await pool.query(`GRANT ${restore} TO forum_role_runtime`)}
  }
 }finally{await app.close();app=ownerApp;await restricted.end()}
});

test('migration backfills only current employee memberships and proven legacy administrator grants',async()=>{
 const rollback=await readFile('../../deployment/forum-api/rollback-008-iam-roles.sql','utf8');
 const client=await pool.connect();try{await client.query(rollback)}finally{client.release()}
 try{
  const org=await company(),p=(await pool.query(`INSERT INTO public.participants(kind,role,legal_status,organization_id)
   VALUES('organization','provider','legal_entity',$1) RETURNING id`,[org])).rows[0].id;
  for(const actor of [alice,bob]){
   await pool.query(`INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from)
    VALUES($1,$2,'active','legacy','Reviewed legacy record',now()-interval '1 day')`,[actor.id,org]);
   await pool.query('INSERT INTO public.participant_memberships(user_id,participant_id) VALUES($1,$2)',[actor.id,p]);
   await pool.query(`INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES($1,'participant',$2,'organization_admin')`,[actor.id,p]);
  }
  await pool.query(`INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,status,basis_type,basis_reference,
   approved_by_user_id,decided_at,effective_from) VALUES($1,$2,'administrator','confirmed','trusted_adapter','Verified legacy authority',$1,now(),now()-interval '1 day')`,[alice.id,org]);
  await pool.query(`INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,basis_type,basis_reference)
   VALUES($1,$2,'administrator','legacy','Unproven legacy admin')`,[bob.id,org]);
  const expired=await company();await pool.query(`INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from,effective_until)
   VALUES($1,$2,'active','legacy','Expired legacy record',now()-interval '1 day',now()-interval '1 second')`,[bob.id,expired]);
  const legacy=(await pool.query('SELECT id,user_id,scope_id,role,status FROM public.role_assignments ORDER BY user_id')).rows;
  await migrate(pool);
  assert.deepEqual((await pool.query('SELECT id,user_id,scope_id,role,status FROM public.role_assignments ORDER BY user_id')).rows,legacy);
  assert.deepEqual((await resolve(`organization:${org}`)).json().roles,['organization_admin','organization_employee']);
  assert.deepEqual((await resolve(`organization:${org}`,bob)).json().roles,['organization_employee']);
  assert.equal((await resolve(`organization:${expired}`,bob)).statusCode,403);
  assert.equal((await pool.query('SELECT count(*) FROM public.iam_role_assignments')).rows[0].count,'3');
 }finally{await migrate(pool)}
});
test('bootstrap audit storage failure leaves the assignment account version and audit unchanged',async()=>{
 await pool.query('UPDATE public.persons SET phone_number=$2 WHERE user_id=$1',[alice.id,'+79010000001']);
 await pool.query(`CREATE FUNCTION public.fail_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.action='IAMPlatformAdminBootstrapped' THEN RAISE EXCEPTION 'Synthetic bootstrap audit failure';END IF;RETURN NEW;END $$;
  CREATE TRIGGER fail_bootstrap_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_bootstrap_audit()`);
 try{
  await assert.rejects(bootstrap('+79010000001',alice.id));
  assert.equal((await get('/api/auth/session')).json().accessVersion,1);
  assert.deepEqual((await get('/api/auth/session')).json().platformRoles,[]);
  assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='IAMPlatformAdminBootstrapped'")).rows[0].count,'0');
 }finally{await pool.query('DROP TRIGGER fail_bootstrap_audit ON public.audit_events;DROP FUNCTION public.fail_bootstrap_audit()')}
});
test('bootstrap refuses a different revoked administrator instead of becoming a recovery bypass',async()=>{
 const id=await platformAdmin(bob);await pool.query("UPDATE public.iam_role_assignments SET status='revoked',revoked_at=now() WHERE id=$1",[id]);
 await pool.query('UPDATE public.persons SET phone_number=$2 WHERE user_id=$1',[alice.id,'+79010000001']);
 await assert.rejects(bootstrap('+79010000001',alice.id));
 assert.deepEqual((await get('/api/auth/session')).json().platformRoles,[]);
});
test('local bootstrap CLI requires exact arguments and prints only sanitized status and IDs',async()=>{
 await pool.query('UPDATE public.persons SET phone_number=$2 WHERE user_id=$1',[alice.id,'+79010000001']);
 const result=spawnSync(process.execPath,['.test-build/src/bootstrap-platform-admin.js','--phone','+79010000001',
  '--user-id',alice.id,'--reason','Authorized synthetic CLI bootstrap'],{encoding:'utf8',env:{...process.env,DATABASE_URL:testDatabaseUrl(process.env.TEST_DATABASE_URL),SBER_ID_ENABLED:'false',PUBLIC_ORIGIN:'https://forum.example'}});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).userId,alice.id);
 assert.ok(!result.stdout.includes('+79010000001'));assert.ok(!result.stdout.includes('postgres://'));assert.equal(result.stderr,'');
 const invalid=spawnSync(process.execPath,['.test-build/src/bootstrap-platform-admin.js','--phone','private-invalid-value'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.deepEqual(JSON.parse(invalid.stderr),{status:'failed',code:'invalid_request'});
 assert.ok(!invalid.stderr.includes('private-invalid-value'));
});
