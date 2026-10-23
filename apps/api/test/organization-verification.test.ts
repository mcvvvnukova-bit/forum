import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';

const origin='https://forum.example',route='/api/me/organizations/verification',inn='9709128511';
let pool:Pool,app:NestFastifyApplication,alice:string,bob:string,aliceId:string;
const config={publicOrigin:origin,databaseUrl:'',secureCookies:false,sessionTtlSeconds:3600,...{organizationVerificationEnabled:true}};
before(async()=>{pool=new Pool({connectionString:testDatabaseUrl(process.env.TEST_DATABASE_URL)});await migrate(pool);app=await createApp(config,pool)});
after(async()=>{await app?.close();await pool?.end()});
beforeEach(async()=>{
 await pool.query('TRUNCATE public.users,public.organizations,public.audit_events,public.outbox_events CASCADE');
 const auth=new AuthStore(pool);
 for(const [subject,token] of [['alice','a'.repeat(43)],['bob','b'.repeat(43)]]){
  await auth.authenticate({subject,alternateSubjects:[],email:null,emailConfirmed:false,displayName:subject,claims:{}},'register',token,3600);
 }
 alice='forum_session='+'a'.repeat(43);bob='forum_session='+'b'.repeat(43);aliceId=(await auth.session('a'.repeat(43))).user.id;
 await app.inject({method:'POST',url:'/api/me/organizations',headers:{origin,cookie:alice},payload:{inn}});
});
function start(method='diadoc',requestId=randomUUID(),cookie=alice,extra={}){
 return app.inject({method:'POST',url:route,headers:{origin,cookie},payload:{inn,method,requestId,...extra}});
}
function read(cookie=alice){return app.inject({method:'GET',url:route+'?inn='+inn,headers:{cookie}})}
test('keeps technical verification separate from company roles and persists the result after app restart',async()=>{
 const result=await start();assert.equal(result.statusCode,201,result.body);
 const body=result.json();assert.equal(body.userId,aliceId);assert.equal(body.item.status,'connection_required');
 assert.deepEqual(body.item.legalPermissions,{registerCompany:false,submitTender:false});
 assert.equal(result.headers['cache-control'],'no-store');
 await app.close();app=await createApp(config,pool);
 assert.deepEqual((await read()).json().item,body.item);
 for(const table of ['organization_memberships','organization_authorities'])assert.equal((await pool.query(`SELECT count(*) FROM public.${table}`)).rows[0].count,'0');
 assert.equal((await pool.query("SELECT count(*) FROM public.participants WHERE kind='organization'")).rows[0].count,'0');
});
test('independent KEP path needs no Diadoc account or mailbox',async()=>{
 const result=await start('kep');assert.equal(result.statusCode,201,result.body);
 assert.equal(result.json().item.status,'signature_required');assert.equal(result.json().item.method,'kep');
 assert.deepEqual(result.json().item.legalPermissions,{registerCompany:false,submitTender:false});
});
test('retries and concurrent requests reuse one attempt while conflicting input gets 409',async()=>{
 const id=randomUUID(),results=await Promise.all(Array.from({length:5},()=>start('diadoc',id)));
 assert.equal(results.filter(r=>r.statusCode===201).length,1,results.map(r=>r.body).join('\n'));
 assert.equal(new Set(results.map(r=>r.json().item.id)).size,1);
 assert.equal((await start('kep',id)).statusCode,409);
 assert.equal((await pool.query('SELECT count(*) FROM public.organization_verifications')).rows[0].count,'1');
 assert.equal((await pool.query("SELECT count(*) FROM public.audit_events WHERE action='OrganizationVerificationStarted'")).rows[0].count,'1');
});
test('requires own saved INN and never exposes another users result',async()=>{
 assert.equal((await start('diadoc',randomUUID(),bob)).statusCode,404);
 assert.equal((await read(bob)).statusCode,404);
 await start();assert.equal((await read(bob)).statusCode,404);
 assert.equal((await read()).json().userId,aliceId);
});
test('validates exact origin session input and query without trusting client authority',async()=>{
 assert.equal((await app.inject({method:'GET',url:route+'?inn='+inn})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:route,headers:{cookie:alice,origin:'https://evil.example'},payload:{inn,method:'diadoc',requestId:randomUUID()}})).statusCode,403);
 for(const payload of [{userId:randomUUID()},{legalPermissions:{registerCompany:true}},{boxId:randomUUID()},{requestId:'bad'},{requestId:randomUUID()+'\n'},{inn:'9709128512'},{method:'mock'}])assert.equal((await start('diadoc',randomUUID(),alice,payload)).statusCode,400);
 for(const query of ['?inn='+inn+'&userId=other','?inn='+inn+'&inn='+inn,'?inn=bad'])assert.equal((await app.inject({method:'GET',url:route+query,headers:{cookie:alice}})).statusCode,400);
});
test('disabled by default and options require an authenticated owner',async()=>{
 const disabled=await createApp({...config,...{organizationVerificationEnabled:false}},pool);
 try{
  assert.equal((await disabled.inject({method:'GET',url:route+'/options'})).statusCode,401);
  assert.deepEqual((await disabled.inject({method:'GET',url:route+'/options',headers:{cookie:alice}})).json(),{userId:aliceId,enabled:false});
  assert.equal((await disabled.inject({method:'POST',url:route,headers:{origin,cookie:alice},payload:{inn,method:'diadoc',requestId:randomUUID()}})).statusCode,404);
 }finally{await disabled.close()}
});
test('simulated technical evidence is minimized never grants authority and expires',async()=>{
 let calls=0;
 const server=await createApp(config,pool,async()=>{calls++;return {status:'access_confirmed',source:'simulation',reason:'employee_access',evidence:{requisites:{inn,name:'Компания',orgId:'org',boxId:'box'},permissions:{isAdministrator:true,canSignDocuments:true,documentAccessLevel:'AllDocuments'}},token:'private-upstream-token'};});
 const requestId=randomUUID();
 try{
  const send=()=>server.inject({method:'POST',url:route,headers:{origin,cookie:alice},payload:{inn,method:'diadoc',requestId}});
  const first=await send();assert.equal(first.statusCode,201,first.body);await send();assert.equal(calls,1);
  assert.equal(first.json().item.status,'access_confirmed');assert.equal(first.json().item.source,'simulation');
  assert.ok(!first.body.includes('private-upstream-token'));assert.deepEqual(first.json().item.legalPermissions,{registerCompany:false,submitTender:false});
  assert.equal((await pool.query('SELECT count(*) FROM public.organization_authorities')).rows[0].count,'0');
  await pool.query("UPDATE public.organization_verifications SET expires_at=now()-interval '1 second'");
  const stale=await server.inject({method:'GET',url:route+'?inn='+inn,headers:{cookie:alice}});
  assert.equal(stale.json().item.status,'unavailable');assert.equal(stale.json().item.reason,'expired');assert.deepEqual(stale.json().item.evidence,{});
 }finally{await server.close()}
});
test('provider exceptions never leak upstream credentials or create rights',async()=>{
 const server=await createApp(config,pool,async()=>{throw new Error('Bearer private-upstream-token')});
 try{
  const result=await server.inject({method:'POST',url:route,headers:{origin,cookie:alice},payload:{inn,method:'diadoc',requestId:randomUUID()}});
  assert.equal(result.statusCode,201,result.body);assert.equal(result.json().item.status,'unavailable');assert.ok(!result.body.includes('private-upstream-token'));
 }finally{await server.close()}
});
test('verification works under the deployed runtime allowlist without UPDATE on additions',async()=>{
 const connectionString=testDatabaseUrl(process.env.TEST_DATABASE_URL),url=new URL(connectionString),container=process.env.TEST_DATABASE_CONTAINER;
 assert.ok(container,'A dedicated local PostgreSQL container is required');
 const binding=spawnSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'});
 assert.equal(binding.status,0);assert.ok(binding.stdout.includes('127.0.0.1:'+url.port),'Container must match the test database');
 await pool.query('CREATE ROLE proj180_runtime NOLOGIN');
 const granted=spawnSync('docker',['exec','-i',container,'psql','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-v','app_role=proj180_runtime'],{input:await readFile('../../deployment/forum-api/grant-runtime.sql','utf8'),encoding:'utf8'});
 assert.equal(granted.status,0,granted.stderr);
 const restricted=new Pool({connectionString,options:'-c role=proj180_runtime'}),server=await createApp(config,restricted);
 try{
  assert.equal((await restricted.query('SELECT current_user AS role')).rows[0].role,'proj180_runtime');
  assert.equal((await restricted.query("SELECT has_table_privilege(current_user,'public.organization_additions','UPDATE') AS allowed")).rows[0].allowed,false);
  const response=await server.inject({method:'POST',url:route,headers:{origin,cookie:alice},payload:{inn,method:'diadoc',requestId:randomUUID()}});
  assert.equal(response.statusCode,201,response.body);
  assert.equal((await server.inject({method:'GET',url:route+'?inn='+inn,headers:{cookie:alice}})).json().item.status,'connection_required');
  await assert.rejects(restricted.query('UPDATE public.organization_verifications SET user_id=user_id'),{code:'42501'});
 }finally{await server.close();await restricted.end();await pool.query('DROP OWNED BY proj180_runtime; DROP ROLE proj180_runtime')}
});
