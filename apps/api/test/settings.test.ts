import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {hashToken,randomToken} from '../src/iam/crypto.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';

let pool:Pool,app:NestFastifyApplication;
before(async()=>{
  const connectionString=testDatabaseUrl(process.env.TEST_DATABASE_URL);
  pool=new Pool({connectionString});
  await pool.query('DROP SCHEMA IF EXISTS iam CASCADE; DROP SCHEMA IF EXISTS party CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool);
  app=await createApp({publicOrigin:'https://forum.example',databaseUrl:connectionString,secureCookies:true,sessionTtlSeconds:3600},pool);
});
beforeEach(async()=>{await pool.query('TRUNCATE public.users,public.audit_events,public.outbox_events CASCADE')});
after(async()=>{await app?.close();await pool?.end()});
async function account(){
  const id=randomUUID(),token=randomToken();
  await pool.query('INSERT INTO public.users(id,display_name) VALUES ($1,$2)',[id,'Settings owner']);
  await pool.query('INSERT INTO public.persons(user_id) VALUES ($1)',[id]);
  await pool.query("INSERT INTO public.sessions(id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",[randomUUID(),id,hashToken(token)]);
  return {id,cookie:`__Host-forum_session=${token}`};
}
function read(cookie:string,url='/api/settings'){return app.inject({method:'GET',url,headers:{cookie}})}
function put(cookie:string,workAsIndividual:unknown,extra={},origin='https://forum.example'){
  return app.inject({method:'PUT',url:'/api/settings',headers:{cookie,origin},payload:{workAsIndividual,...extra}});
}
async function participant(userId:string){return (await pool.query('SELECT id,status FROM public.participants WHERE individual_user_id=$1',[userId])).rows[0]}
async function access(userId:string){
  const p=await participant(userId);
  return p?(await pool.query("SELECT public.effective_business_access($1,$2,'provider') AS allowed",[userId,p.id])).rows[0].allowed:false;
}
test('settings enable and disable actual provider access while preserving the account and person',async()=>{
  const a=await account();
  const initial=await read(a.cookie);assert.equal(initial.statusCode,200,initial.body);
  assert.deepEqual(initial.json(),{userId:a.id,workAsIndividual:false});assert.equal(initial.headers['cache-control'],'no-store');
  assert.equal((await put(a.cookie,true)).statusCode,200);
  assert.equal(await access(a.id),true);
  const original=await participant(a.id);
  assert.equal((await put(a.cookie,false)).json().workAsIndividual,false);
  assert.equal((await app.inject({method:'GET',url:'/api/auth/session',headers:{cookie:a.cookie}})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/profile',headers:{cookie:a.cookie}})).statusCode,200);
  assert.equal(await access(a.id),false);
  assert.equal((await participant(a.id)).id,original.id);
  assert.equal((await pool.query('SELECT count(*) FROM public.persons WHERE user_id=$1',[a.id])).rows[0].count,'1');
  assert.equal((await pool.query('SELECT revoked_at FROM public.sessions WHERE user_id=$1',[a.id])).rows[0].revoked_at,null);
  assert.equal((await put(a.cookie,true)).json().workAsIndividual,true);
  assert.equal((await participant(a.id)).id,original.id);
});
test('a fresh login preserves a disabled choice and does not grant provider rights',async()=>{
  const a=await account();
  assert.equal((await put(a.cookie,true)).statusCode,200);
  assert.equal((await put(a.cookie,false)).statusCode,200);
  const subject='synthetic-settings-'+a.id;
  await pool.query("INSERT INTO public.external_identities(id,user_id,provider,subject,claims_snapshot) VALUES ($1,$2,'sber_id',$3,'{}')",[randomUUID(),a.id,subject]);
  const token=randomToken();
  await new AuthStore(pool).authenticate({subject,alternateSubjects:[],displayName:'Settings owner',email:null,emailConfirmed:false,claims:{}},'login',token,3600);
  const cookie=`__Host-forum_session=${token}`;
  assert.deepEqual((await read(cookie)).json(),{userId:a.id,workAsIndividual:false});
  assert.equal(await access(a.id),false);
  assert.equal((await app.inject({method:'GET',url:'/api/profile',headers:{cookie}})).statusCode,200);
});
test('repeated and concurrent enables create one participant grant and audit event',async()=>{
  const a=await account();
  const results=await Promise.all([put(a.cookie,true),put(a.cookie,true),put(a.cookie,true)]);
  for(const r of results)assert.equal(r.statusCode,200,r.body);
  assert.equal((await pool.query('SELECT count(*) FROM public.participants')).rows[0].count,'1');
  assert.equal((await pool.query("SELECT count(*) FROM public.role_assignments WHERE role='provider' AND status='active'")).rows[0].count,'1');
  assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='IndividualParticipationEnabled'")).rows[0].count,'1');
  const p=await participant(a.id);
  const off=await Promise.all([put(a.cookie,false),put(a.cookie,false)]);
  for(const r of off)assert.equal(r.statusCode,200,r.body);
  assert.equal((await participant(a.id)).id,p.id);assert.equal(await access(a.id),false);
  assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='IndividualParticipationDisabled'")).rows[0].count,'1');
});
test('a user cannot select another owner or change organization rights',async()=>{
  const a=await account(),b=await account();
  assert.equal((await put(a.cookie,true,{userId:b.id})).statusCode,400);
  assert.equal((await read(a.cookie,'/api/settings?userId='+b.id)).statusCode,400);
  await put(a.cookie,true);
  assert.equal((await read(b.cookie)).json().workAsIndividual,false);
  assert.equal(await participant(b.id),undefined);
  // A personal update cannot write arbitrary participants, roles or account data.
  for(const extra of [{participantId:randomUUID()},{role:'organization_admin'},{displayName:'changed'}])assert.equal((await put(a.cookie,false,extra)).statusCode,400);
});
test('writes reject missing or foreign Origin and malformed values without side effects',async()=>{
  const a=await account();
  for(const origin of ['','https://attacker.test'])assert.equal((await put(a.cookie,true,{},origin)).statusCode,403);
  for(const value of ['true',1,null,{},[]])assert.equal((await put(a.cookie,value)).statusCode,400);
  assert.equal((await app.inject({method:'PUT',url:'/api/settings',headers:{cookie:a.cookie,origin:'https://forum.example'},payload:{}})).statusCode,400);
  assert.equal(await participant(a.id),undefined);
});
test('personal consent leaves corporate memberships and grants unchanged',async()=>{
  const a=await account(),organizationId=randomUUID(),participantId=randomUUID();
  await pool.query("INSERT INTO public.organizations(id,legal_status,inn,legal_name,created_by_user_id,registration_state,registered_at) VALUES ($1,'legal_entity','0000000001','Synthetic company',$2,'registered',now())",[organizationId,a.id]);
  await pool.query("INSERT INTO public.participants(id,kind,role,legal_status,organization_id) VALUES ($1,'organization','customer','legal_entity',$2)",[participantId,organizationId]);
  await pool.query('INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ($1,$2)',[a.id,participantId]);
  await pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES ($1,'participant',$2,'customer'),($1,'participant',$2,'organization_admin')",[a.id,participantId]);
  await pool.query("INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,created_by_user_id,approved_by_user_id,effective_from) VALUES ($1,$2,'active','invitation','synthetic-invite',$1,$1,now())",[a.id,organizationId]);
  const snapshot=async()=>Promise.all([
    pool.query('SELECT * FROM public.organization_memberships WHERE organization_id=$1',[organizationId]),
    pool.query('SELECT * FROM public.participant_memberships WHERE participant_id=$1',[participantId]),
    pool.query('SELECT * FROM public.role_assignments WHERE scope_id=$1 ORDER BY role',[participantId]),
  ]).then(results=>results.map(result=>result.rows));
  const before=await snapshot();
  for(const enabled of [true,false,true]){
    const response=await put(a.cookie,enabled);assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await pool.query("SELECT public.effective_business_access($1,$2,'customer') AS allowed",[a.id,participantId])).rows[0].allowed,true);
  }
});
test('anonymous expired revoked and deactivated accounts cannot read or write settings',async()=>{
  for(const cookie of ['', '__Host-forum_session=malformed']){
    assert.equal((await read(cookie)).statusCode,401);assert.equal((await put(cookie,true)).statusCode,401);
  }
  const a=await account();
  for(const sql of ["UPDATE public.sessions SET expires_at=now()-interval '1 second'","UPDATE public.sessions SET expires_at=now()+interval '1 hour',revoked_at=now()","UPDATE public.sessions SET revoked_at=NULL; UPDATE public.users SET status='deactivated'"]){
    await pool.query(sql);assert.equal((await read(a.cookie)).statusCode,401);assert.equal((await put(a.cookie,true)).statusCode,401);
  }
});
test('self-service cannot lift restricted participants or revoked memberships',async()=>{
  const a=await account();const enabled=await put(a.cookie,true);assert.equal(enabled.statusCode,200,enabled.body);const p=await participant(a.id);
  await pool.query("UPDATE public.participants SET status='restricted' WHERE id=$1",[p.id]);
  assert.equal((await read(a.cookie)).json().workAsIndividual,false);
  assert.equal((await put(a.cookie,true)).statusCode,409);assert.equal(await access(a.id),false);
  await pool.query("UPDATE public.participants SET status='active' WHERE id=$1",[p.id]);
  await pool.query("UPDATE public.participant_memberships SET status='revoked' WHERE user_id=$1",[a.id]);
  assert.equal((await put(a.cookie,true)).statusCode,409);assert.equal(await access(a.id),false);
});
test('a grant revoked outside the settings flow cannot be self-reactivated',async()=>{
  const a=await account();await put(a.cookie,true);
  await pool.query("UPDATE public.role_assignments SET status='revoked',revoked_at=now() WHERE user_id=$1 AND role='provider'",[a.id]);
  assert.equal((await put(a.cookie,true)).statusCode,409);assert.equal(await access(a.id),false);
});
test('a later administrative revocation overrides earlier self-service consent',async()=>{
  const a=await account();
  assert.equal((await put(a.cookie,true)).statusCode,200);
  assert.equal((await put(a.cookie,false)).statusCode,200);
  await pool.query("UPDATE public.role_assignments SET revoked_at=now()+interval '1 second' WHERE user_id=$1 AND role='provider'",[a.id]);
  assert.equal((await put(a.cookie,true)).statusCode,409);assert.equal(await access(a.id),false);
});
test('failure of the audit rolls back the participant and provider grant',async()=>{
  const a=await account();
  await pool.query("CREATE FUNCTION public.reject_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic settings failure'; END $$; CREATE TRIGGER reject_settings_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_settings_audit()");
  try {
    const response=await put(a.cookie,true);assert.equal(response.statusCode,503);assert.equal(response.json().code,'temporarily_unavailable');
    assert.equal(await participant(a.id),undefined);assert.equal(await access(a.id),false);
    assert.equal((await read(a.cookie)).json().workAsIndividual,false);
  } finally {await pool.query('DROP TRIGGER reject_settings_audit ON public.audit_events;DROP FUNCTION public.reject_settings_audit()')}
});
