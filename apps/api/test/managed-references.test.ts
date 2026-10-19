import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {okpdTestDatabase} from './okpd2-test-database.js';
import {migrateManagedReferences} from '../src/references/managed-migrate.js';

let database:Awaited<ReturnType<typeof okpdTestDatabase>>,pool:Pool,app:NestFastifyApplication;
let cookie:string,csrf:string,userId:string,assignmentId:string;
const kinds=['regions','offer-types','business-segments','commercial-roles','units','rejection-reasons','company-statuses'];
const tables=['regions','offer_types','business_segments','commercial_roles','units','moderation_reasons','company_statuses'];
before(async()=>{
 database=await okpdTestDatabase();pool=database.pool;await migrate(pool);await migrateManagedReferences(pool);await migrateManagedReferences(pool);
 app=await createApp({publicOrigin:'https://forum.example',databaseUrl:database.url,secureCookies:false,sessionTtlSeconds:3600},pool);
});
after(async()=>{await app?.close();await database?.close()});
beforeEach(async()=>{
 await pool.query('TRUNCATE public.audit_events,public.users,'+tables.map(x=>'public.'+x).join(',')+' CASCADE');
 const token=randomBytes(32).toString('base64url'),store=new AuthStore(pool);
 await store.authenticate({subject:randomUUID(),alternateSubjects:[],displayName:'Reference admin',email:null,emailConfirmed:false,claims:{},profile:{}},'login',token,3600);
 userId=(await store.session(token)).user.id;cookie=`forum_session=${token}`;
 csrf=(await pool.query('SELECT csrf_token FROM public.sessions WHERE user_id=$1',[userId])).rows[0].csrf_token;
 assignmentId=(await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason)
 VALUES($1,'platform','platform_admin',$1,'Reference test') RETURNING id`,[userId])).rows[0].id;
});
function get(kind:string,suffix=''){return app.inject({method:'GET',url:'/api/references/managed/'+kind+suffix,headers:{cookie}})}
function change(method:'POST'|'PATCH'|'DELETE',kind:string,code?:string,body?:Record<string,unknown>,version?:number,key=randomUUID(),extra:Record<string,string>={}){
 return app.inject({method,url:'/api/references/managed/'+kind+(code?'/'+encodeURIComponent(code):''),
 headers:{cookie,origin:'https://forum.example','x-forum-csrf':csrf,'idempotency-key':key,...(version?{'if-match':`"${version}"`}:{}),...extra},...(body===undefined?{}:{payload:body})});
}
for(const [i,kind] of kinds.entries())test(kind+': create, view, edit, soft delete retain the row and reserve code',async()=>{
 const code=i===0?'99':'test_01',body={code,name:'Проверочное значение',...([1,2,3,4,5].includes(i)?{description:'Описание'}:{}),...(i===4?{symbol:'шт.'}:{})};
 const created=await change('POST',kind,undefined,body);assert.equal(created.statusCode,201,created.body);
 const detail=await get(kind,'/'+code);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().item.code,code);
 assert.equal(detail.json().item.version,1);assert.equal(detail.headers['cache-control'],'no-store');
 const edited=await change('PATCH',kind,code,{...body,code:undefined,name:'Изменённое значение'},1);assert.equal(edited.statusCode,200,edited.body);
 assert.equal((await get(kind,'/'+code)).json().item.name,'Изменённое значение');
 assert.equal((await change('PATCH',kind,code,{name:'Потерянная правка'},1)).statusCode,412);
 const deleted=await change('DELETE',kind,code,undefined,2);assert.equal(deleted.statusCode,200,deleted.body);
 assert.equal((await get(kind)).json().total,0);assert.equal((await get(kind,'/'+code)).statusCode,404);
 const row=(await pool.query(`SELECT deleted_at,deleted_by,version,name FROM public.${tables[i]}`)).rows[0];
 assert.ok(row.deleted_at);assert.equal(row.deleted_by,userId);assert.equal(row.version,3);assert.equal(row.name,'Изменённое значение');
 assert.equal((await change('POST',kind,undefined,body)).statusCode,409);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'ReferenceValue%'")).rows[0].n,3);
});
test('idempotency replays once, canonicalizes fields, and rejects changed content or revoked actor',async()=>{
 const key=randomUUID();const a=await change('POST','units',undefined,{code:'01',name:'Штука'},undefined,key);
 const b=await change('POST','units',undefined,{name:'Штука',code:'01'},undefined,key);
 assert.equal(a.statusCode,201,a.body);assert.deepEqual(b.json(),a.json());
 assert.equal((await change('POST','units',undefined,{code:'02',name:'Метр'},undefined,key)).statusCode,409);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='ReferenceValueCreated'")).rows[0].n,1);
 await pool.query("UPDATE iam_role_assignments SET status='revoked',revoked_at=now() WHERE id=$1",[assignmentId]);
 assert.equal((await change('POST','units',undefined,{code:'01',name:'Штука'},undefined,key)).statusCode,403);
});
test('moderator can manage only rejection reasons, ordinary user cannot access any',async()=>{
 await pool.query("DELETE FROM iam_role_assignments WHERE id=$1",[assignmentId]);
 assignmentId=(await pool.query("INSERT INTO iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason) VALUES($1,'platform','platform_moderator',$1,'Moderator test') RETURNING id",[userId])).rows[0].id;
 for(const kind of kinds)assert.equal((await get(kind)).statusCode,kind==='rejection-reasons'?200:403,kind);
 assert.equal((await change('POST','rejection-reasons',undefined,{code:'01',name:'Недостоверные сведения'})).statusCode,201);
 assert.equal((await change('POST','units',undefined,{code:'01',name:'Штука'})).statusCode,403);
 await pool.query("UPDATE iam_role_assignments SET status='revoked',revoked_at=now() WHERE id=$1",[assignmentId]);
 assert.equal((await get('rejection-reasons')).statusCode,403);
});
test('literal code/name filters and pagination hide soft deleted values',async()=>{
 await pool.query(`INSERT INTO units(code,name) SELECT lpad(n::text,3,'0'),'Название '||n FROM generate_series(1,61) n`);
 assert.equal((await get('units')).json().items.length,50);assert.equal((await get('units','?page=2')).json().items.length,11);
 assert.equal((await get('units','?code=01&name='+encodeURIComponent('НАЗВАНИЕ'))).json().total,10);
 for(const text of ['%','_','\\',"' OR true --"])assert.equal((await get('units','?name='+encodeURIComponent(text))).json().total,0);
});
test('reject invalid fields, unknown dictionaries and query keys, immutable code and missing version',async()=>{
 for(const body of [{code:'01'}, {name:'Штука'}, {code:'01',name:''},{code:' 01',name:'x'},{code:'01',name:'x',surprise:true}])
  assert.equal((await change('POST','units',undefined,body)).statusCode,400,JSON.stringify(body));
 assert.equal((await change('POST','regions',undefined,{code:'1',name:'x'})).statusCode,400);
 assert.equal((await get('unknown')).statusCode,404);
 for(const q of ['?code=a&code=b','?page=0','?page=10001','?all=true','?name='+encodeURIComponent('\u0001')])assert.equal((await get('units',q)).statusCode,400,q);
 await change('POST','units',undefined,{code:'01',name:'Штука'});
 assert.equal((await change('PATCH','units','01',{code:'02',name:'x'},1)).statusCode,400);
 assert.equal((await change('DELETE','units','01')).statusCode,400);
});
test('Origin, CSRF, anonymous, expired and blocked sessions fail closed',async()=>{
 assert.equal((await app.inject({method:'GET',url:'/api/references/managed/units'})).statusCode,401);
 for(const h of ([{origin:'https://evil.example'},{'x-forum-csrf':'x'.repeat(43)},{origin:''}] as Record<string,string>[]))
  assert.equal((await change('POST','units',undefined,{code:'01',name:'x'},undefined,randomUUID(),h)).statusCode,403);
 await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[userId]);
 assert.equal((await get('units')).statusCode,401);
});
test('two concurrent edits with one version cannot overwrite each other',async()=>{
 await change('POST','units',undefined,{code:'01',name:'Штука'});
 const responses=await Promise.all([change('PATCH','units','01',{name:'Первый'},1),change('PATCH','units','01',{name:'Второй'},1)]);
 assert.deepEqual(responses.map(x=>x.statusCode).sort(),[200,412]);
 assert.equal((await get('units','/01')).json().item.version,2);
});
test('missing schema returns sanitized 503',async()=>{
 await pool.query('ALTER TABLE units RENAME COLUMN deleted_at TO unavailable');
 try{const r=await get('units');assert.equal(r.statusCode,503);assert.deepEqual(r.json(),{code:'temporarily_unavailable'})}
 finally{await pool.query('ALTER TABLE units RENAME COLUMN unavailable TO deleted_at')}
});
test('soft deletion preserves incoming foreign keys and existing reference keys',async()=>{
 await pool.query("INSERT INTO regions(code,name) VALUES(1,'Республика Адыгея')");
 await pool.query('CREATE TABLE managed_fk_fixture(region_code smallint REFERENCES regions(code) ON DELETE RESTRICT)');
 try{
  await pool.query('INSERT INTO managed_fk_fixture VALUES(1)');
  assert.equal((await get('regions','/01')).json().item.name,'Республика Адыгея');
  assert.equal((await change('DELETE','regions','01',undefined,1)).statusCode,200);
  assert.equal((await pool.query('SELECT region_code FROM managed_fk_fixture')).rows[0].region_code,1);
 }finally{await pool.query('DROP TABLE managed_fk_fixture')}
});
test('migration down/reapply preserves base rows and core ledger and refuses losing deletion marks',async()=>{
 const down=await readFile('migrations/references/002_managed_references.down.sql','utf8');
 await pool.query("INSERT INTO units(code,name) VALUES('01','Штука')");
 await pool.query('BEGIN');await pool.query(down);await pool.query('COMMIT');
 assert.equal((await pool.query("SELECT name FROM units WHERE code='01'")).rows[0].name,'Штука');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name='008_iam_roles'")).rows[0].n,1);
 await migrateManagedReferences(pool);assert.equal((await get('units','/01')).json().item.version,1);
 await change('DELETE','units','01',undefined,1);
 await assert.rejects(pool.query(down),/Rollback refused/);
 assert.equal((await get('units','/01')).statusCode,404);
});
test('runtime grants allow reference CRUD while prohibiting physical DELETE, code updates and DDL',async()=>{
 const container=process.env.TEST_DATABASE_CONTAINER;assert.ok(container&&/^[\w.-]+$/.test(container));
 const url=new URL(database.url),binding=spawnSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'});
 assert.equal(binding.status,0);assert.equal(binding.stdout.trim(),`127.0.0.1:${url.port}`);
 await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forum_managed_reference_runtime') THEN CREATE ROLE forum_managed_reference_runtime; END IF; END $$");
 const sql=(await readFile('../../deployment/forum-api/grant-runtime.sql','utf8'))+'\n'+await readFile('../../deployment/forum-api/grant-managed-references.sql','utf8');
 const grant=spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'psql','-X','-h','127.0.0.1','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-v','ON_ERROR_STOP=1'],{input:'\\set app_role forum_managed_reference_runtime\n'+sql,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}});
 assert.equal(grant.status,0,grant.stderr);
 const restricted=new Pool({connectionString:database.url,options:'-c role=forum_managed_reference_runtime'});
 const service=await createApp({publicOrigin:'https://forum.example',databaseUrl:database.url,secureCookies:false,sessionTtlSeconds:3600},restricted);
 try{
  const r=await service.inject({method:'POST',url:'/api/references/managed/units',payload:{code:'01',name:'Штука',symbol:'шт.'},headers:{cookie,origin:'https://forum.example','x-forum-csrf':csrf,'idempotency-key':randomUUID()}});
  assert.equal(r.statusCode,201,r.body);
  for(const sql of ['DELETE FROM units',"UPDATE units SET code='02'",'ALTER TABLE units ADD COLUMN injected text',"INSERT INTO units(code,name,deleted_at) VALUES('02','x',now())"])
   await assert.rejects(restricted.query(sql),{code:'42501'});
 }finally{await service.close();await restricted.end()}
});
test('description accepts multiline text while code and name remain single line',async()=>{
 const r=await change('POST','units',undefined,{code:'01',name:'Штука',description:'Первая строка\nВторая строка'});
 assert.equal(r.statusCode,201,r.body);assert.equal((await get('units','/01')).json().item.description,'Первая строка\nВторая строка');
 assert.equal((await change('POST','units',undefined,{code:'02',name:'Первая\nВторая'})).statusCode,400);
});
