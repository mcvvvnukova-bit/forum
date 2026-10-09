import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';

let pool:Pool, app:NestFastifyApplication, alice:string, bob:string, aliceId:string, bobId:string;
before(async()=>{
 const connectionString=testDatabaseUrl(process.env.TEST_DATABASE_URL);
 pool=new Pool({connectionString});await migrate(pool);
 app=await createApp({publicOrigin:'https://forum.example',databaseUrl:connectionString,secureCookies:false,sessionTtlSeconds:3600},pool);
});
after(async()=>{await app?.close();await pool?.end()});
beforeEach(async()=>{
 await pool.query('TRUNCATE public.users,public.organizations,public.audit_events,public.outbox_events CASCADE');
 const store=new AuthStore(pool);
 async function user(subject:string,name:string){
  const token=subject==='alice'?'a'.repeat(43):'b'.repeat(43);
  await store.authenticate({subject,alternateSubjects:[],email:null,emailConfirmed:false,displayName:name,claims:{familyName:name}},'register',token,3600);
  return {cookie:`forum_session=${token}`,id:(await store.session(token)).user.id};
 }
 const a=await user('alice','Алиса'),b=await user('bob','Борис');alice=a.cookie;bob=b.cookie;aliceId=a.id;bobId=b.id;
});
function add(inn:unknown,cookie=alice,origin:string|undefined='https://forum.example',extra={}){
 return app.inject({method:'POST',url:'/api/me/organizations',headers:{cookie,...(origin?{origin}:{})},payload:{inn,...extra}});
}
function list(cookie=alice,cursor=''){return app.inject({method:'GET',url:'/api/me/organizations'+cursor,headers:{cookie}})}
async function organization(inn='9709128511'){
 const id=randomUUID();await pool.query(`INSERT INTO public.organizations(id,legal_status,inn,legal_name,provider_organization_id,identified_at,registration_state,registered_at) VALUES($1,'legal_entity',$2,'Проверенная компания',$3,now(),'registered',now())`,[id,inn,id]);
 const p=(await pool.query(`INSERT INTO public.participants(kind,role,legal_status,organization_id) VALUES('organization','provider','legal_entity',$1) RETURNING id`,[id])).rows[0].id;
 return {id,p};
}
async function member(userId:string,p:string,admin=false){
 await pool.query('INSERT INTO public.participant_memberships(user_id,participant_id) VALUES($1,$2)',[userId,p]);
 await pool.query(`INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES($1,'participant',$2,'provider')`,[userId,p]);
 await pool.query(`INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from) SELECT $1,organization_id,'active','legacy','test-existing-evidence',now() FROM public.participants WHERE id=$2`,[userId,p]);
 if(admin)await pool.query(`INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,status,basis_type,basis_reference,approved_by_user_id,decided_at,effective_from) SELECT $1,organization_id,'administrator','confirmed','test','test-existing-evidence',$1,now(),now() FROM public.participants WHERE id=$2`,[userId,p]);
 if(admin)await pool.query(`INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES($1,'participant',$2,'organization_admin')`,[userId,p]);
}
test('saves a pending INN, rereads only own cards, and emits a single authored audit under races',async()=>{
 const first=await add('9709128511');assert.equal(first.statusCode,201,first.body);
 assert.deepEqual(first.json().item,{id:first.json().item.id,inn:'9709128511',name:null,status:'pending',members:[]});
 assert.equal(first.json().userId,aliceId);assert.equal(first.headers['cache-control'],'no-store');
 const races=await Promise.all(Array.from({length:5},()=>add('9709128511')));assert.ok(races.every(r=>r.statusCode===200));
 assert.equal((await list()).json().items.length,1);assert.equal((await list(bob)).json().items.length,0);
 assert.deepEqual((await pool.query("SELECT actor_user_id FROM public.audit_events WHERE action='OrganizationAdded'")).rows,[{actor_user_id:aliceId}]);
 assert.equal((await pool.query("SELECT count(*) FROM public.participants WHERE kind='organization'")).rows[0].count,'0');
});
test('validates company and entrepreneur checksum without normalizing identity input',async()=>{
 assert.equal((await add('500100732259')).statusCode,201);
 for(const inn of ['9709128512','500100732258','0000000000','000000000000','970912851',' 9709128511',9709128511,null])assert.equal((await add(inn)).statusCode,400,String(inn));
 assert.equal((await add('9709128511',alice,'')).statusCode,403);
 assert.equal((await add('9709128511',alice,'https://evil.example')).statusCode,403);
 assert.equal((await add('9709128511',alice,'',{userId:bobId})).statusCode,403);
 for(const extra of [{userId:bobId},{name:'Fake'},{roles:['organization_admin']}])assert.equal((await add('9709128511',alice,'https://forum.example',extra)).statusCode,400);
 assert.equal((await app.inject({method:'GET',url:'/api/me/organizations'})).statusCode,401);
 assert.equal((await add('9709128511','')).statusCode,401);
 assert.equal((await list(alice,'?cursor=not-a-cursor')).statusCode,400);
 assert.equal((await list(alice,'?userId='+bobId)).statusCode,400);
});
test('known company card remains pending and hides foreign members until own active membership',async()=>{
 const o=await organization();await member(bobId,o.p,true);
 const pending=await add('9709128511');assert.equal(pending.json().item.name,'Проверенная компания');assert.deepEqual(pending.json().item.members,[]);
 await member(aliceId,o.p,true);
 const item=(await list()).json().items[0];assert.equal(item.status,'active');assert.equal(item.id,o.id);
 assert.deepEqual(item.members.map((m:{userId:string;fullName:string;roles:string[]})=>({userId:m.userId,fullName:m.fullName,roles:m.roles})).sort((a:{fullName:string},b:{fullName:string})=>a.fullName.localeCompare(b.fullName)),[
  {userId:aliceId,fullName:'Алиса',roles:['organization_admin']},{userId:bobId,fullName:'Борис',roles:['organization_admin']}]);
 assert.equal((await add('9709128511')).json().item.members.length,0,'POST never supplies member evidence');
 await pool.query("UPDATE public.participant_memberships SET status='revoked' WHERE user_id=$1 AND participant_id=$2",[aliceId,o.p]);
 const revoked=(await list()).json().items;assert.equal(revoked.length,1);assert.equal(revoked[0].status,'pending');assert.deepEqual(revoked[0].members,[]);
});
test('revoked grants, deactivated participants and users never disclose members',async()=>{
 const o=await organization();await member(aliceId,o.p);await member(bobId,o.p,true);
 await pool.query("UPDATE public.users SET status='deactivated' WHERE id=$1",[bobId]);
 assert.equal((await list()).json().items[0].members.length,1);
 await pool.query('DELETE FROM public.role_assignments WHERE scope_id=$1 AND user_id=$2',[o.p,aliceId]);
 assert.equal((await list()).json().items.length,0);
 await pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES($1,'participant',$2,'provider')",[aliceId,o.p]);
 await pool.query("UPDATE public.participants SET status='deactivated' WHERE id=$1",[o.p]);
 assert.equal((await list()).json().items.length,0);
});
test('cursor pages are stable, owner scoped and not a product count limit',async()=>{
 // Checksum generation is fixture-only; API independently validates it.
 const inns=Array.from({length:56},(_,i)=>{const prefix=String(100000000+i);const sum=[2,4,10,3,5,9,4,6,8].reduce((n,w,j)=>n+w*Number(prefix[j]),0);return prefix+String(sum%11%10)});
 for(const inn of inns)assert.equal((await add(inn)).statusCode,201);
 const first=(await list()).json();assert.equal(first.items.length,50);assert.ok(first.nextCursor);
 const second=(await list(alice,'?cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(second.items.length,6);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(i=>i.inn)).size,56);
 assert.equal((await list(bob,'?cursor='+encodeURIComponent(first.nextCursor))).statusCode,400);
});
test('partial newer schema fails closed on reads and additions, including empty incompatible tables',async()=>{
 await pool.query('ALTER TABLE public.organization_memberships RENAME TO organization_memberships_complete; CREATE TABLE public.organization_memberships(foo text)');
 try{
  assert.equal((await list()).statusCode,503);
  assert.equal((await add('9709128511')).statusCode,503);
  assert.equal((await pool.query('SELECT count(*) FROM public.organization_additions')).rows[0].count,'0');
 }finally{await pool.query('DROP TABLE public.organization_memberships; ALTER TABLE public.organization_memberships_complete RENAME TO organization_memberships')}
});
test('complete newer guard honors organizational revocation and requires current confirmed admin authority',async()=>{
 const o=await organization();await member(aliceId,o.p,true);await member(bobId,o.p,true);
 await pool.query("UPDATE public.organization_authorities SET status='pending',effective_from=NULL,decided_at=NULL,approved_by_user_id=NULL WHERE user_id=$1",[aliceId]);
  const first=(await list()).json().items[0];assert.deepEqual(first.members.find((m:{userId:string;roles:string[]})=>m.userId===aliceId).roles,['organization_employee']);assert.deepEqual(first.members.find((m:{userId:string;roles:string[]})=>m.userId===bobId).roles,['organization_admin']);
  await pool.query("UPDATE public.organization_authorities SET effective_from=now()-interval '2 seconds',effective_until=now()-interval '1 second' WHERE user_id=$1",[bobId]);
  assert.deepEqual((await list()).json().items[0].members.find((m:{userId:string;roles:string[]})=>m.userId===bobId).roles,['organization_employee']);
  await pool.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=now() WHERE user_id=$1",[bobId]);
  assert.equal((await list()).json().items[0].members.length,1);
  await add('9709128511');await pool.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=now() WHERE user_id=$1",[aliceId]);
  assert.equal((await list()).json().items[0].status,'pending');assert.deepEqual((await list()).json().items[0].members,[]);
  await pool.query("UPDATE public.organization_memberships SET status='active',revoked_at=NULL WHERE user_id=$1",[aliceId]);
  await pool.query("UPDATE public.organizations SET status='deactivated'");assert.deepEqual((await list()).json().items[0].members,[]);
  await pool.query("UPDATE public.organizations SET status='active'; UPDATE public.organization_memberships SET status='active',revoked_at=NULL");
  await pool.query('DELETE FROM public.role_assignments WHERE user_id=$1 AND scope_id=$2',[bobId,o.p]);
  assert.equal((await list(bob)).json().items.length,0,'General organization membership alone supplies no participant access');

});

test('an incompatible newer guard function alone is partial schema and never a legacy fallback',async()=>{
 await pool.query('ALTER FUNCTION public.effective_business_access(uuid,uuid,text,boolean) RENAME TO saved_effective_business_access; CREATE FUNCTION public.effective_business_access() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$');
 try{assert.equal((await list()).statusCode,503);assert.equal((await add('9709128511')).statusCode,503)}
 finally{await pool.query('DROP FUNCTION public.effective_business_access(); ALTER FUNCTION public.saved_effective_business_access(uuid,uuid,text,boolean) RENAME TO effective_business_access')}
});
