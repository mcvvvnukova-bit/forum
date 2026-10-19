import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';
import {okpdTestDatabase} from './okpd2-test-database.js';
import {migrateOkpd} from '../src/references/okpd2-migrate.js';
let database:Awaited<ReturnType<typeof okpdTestDatabase>>;

let pool:Pool,app:NestFastifyApplication,cookie:string,userId:string,assignmentId:string;
before(async()=>{
 database=await okpdTestDatabase();pool=database.pool;await migrate(pool);await migrateOkpd(pool);
 app=await createApp({publicOrigin:'https://forum.example',databaseUrl:database.url,secureCookies:false,sessionTtlSeconds:3600},pool);
});
after(async()=>{await app?.close();await database?.close()});
beforeEach(async()=>{
 await pool.query('TRUNCATE public.users,public.okpds,public.okpd_sections CASCADE');
 await pool.query("INSERT INTO public.okpd_sections(code,name) VALUES ('A','Agriculture'),('U','Extraterritorial')");
 await pool.query("UPDATE public.okpd_reference_state SET revision=1,source_metadata=$1::jsonb,last_checked_at='2026-10-19T18:00:00Z'",[JSON.stringify({edition:'148/2026',publishedDate:'2026-10-02',url:'https://rosstat.gov.ru/storage/mediabank/OKPD2.rar',archiveHash:'a'.repeat(64)})]);
 const token=randomBytes(32).toString('base64url'),store=new AuthStore(pool);
 await store.authenticate({subject:randomUUID(),alternateSubjects:[],displayName:'Directory admin',email:null,emailConfirmed:false,claims:{},profile:{}},'login',token,3600);
 userId=(await store.session(token)).user.id;cookie=`forum_session=${token}`;
 assignmentId=(await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason)
  VALUES($1,'platform','platform_admin',$1,'Directory test') RETURNING id`,[userId])).rows[0].id;
 await pool.query(`INSERT INTO public.okpds(okpd,level,section,name,is_active) VALUES
  ('01',1,'A','Растениеводство и животноводство',true),('01.11',3,'A','Выращивание зерновых культур',true),
  ('01.12',3,'A','Выращивание риса',true),('02',1,'A','Лесоводство',true),('99',1,'U','Исторический код',false)`);
});
function get(query='',headers:Record<string,string>={cookie}){return app.inject({method:'GET',url:'/api/references/okpd'+query,headers})}
test('administrator reads published active codes with count and stable code order',async()=>{
 const r=await get();assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');
 assert.deepEqual(r.json(),{source:{edition:'148/2026',publishedDate:'2026-10-02',url:'https://rosstat.gov.ru/storage/mediabank/OKPD2.rar',checkedAt:'2026-10-19T18:00:00.000Z'},items:[{code:'01',name:'Растениеводство и животноводство'},{code:'01.11',name:'Выращивание зерновых культур'},{code:'01.12',name:'Выращивание риса'},{code:'02',name:'Лесоводство'}],total:4,page:1,pageSize:50});
});
test('code prefix and case-insensitive name intersect and keep leading zeroes',async()=>{
 const r=await get('?code=01&name='+encodeURIComponent(' ВЫРАЩИВАНИЕ '));assert.equal(r.statusCode,200,r.body);
 assert.deepEqual(r.json().items.map((x:{code:string})=>x.code),['01.11','01.12']);
 assert.equal((await get('?code=02&name='+encodeURIComponent('рис'))).json().total,0);
});
test('name LIKE metacharacters and SQL punctuation are literal',async()=>{
 for(const name of ['%','_','\\',"' OR true --"]){const r=await get('?name='+encodeURIComponent(name));assert.equal(r.statusCode,200,r.body);assert.equal(r.json().total,0)}
});
test('server pagination covers all rows without duplicates',async()=>{
 await pool.query(`INSERT INTO public.okpds(okpd,level,section,name) SELECT '03.'||lpad(n::text,2,'0'),3,'A','Fixture '||n FROM generate_series(1,60) n`);
 const a=(await get()).json(),b=(await get('?page=2')).json();assert.equal(a.total,64);assert.equal(a.items.length,50);assert.equal(b.items.length,14);
 assert.equal(new Set([...a.items,...b.items].map(x=>x.code)).size,64);assert.equal(b.page,2);
});
test('guest, ordinary user and platform moderator cannot read the directory',async()=>{
 assert.equal((await get('',{})).statusCode,401);
 await pool.query('DELETE FROM public.iam_role_assignments WHERE id=$1',[assignmentId]);assert.equal((await get()).statusCode,403);
 await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason) VALUES($1,'platform','platform_moderator',$1,'Test')`,[userId]);
 assert.equal((await get()).statusCode,403);
});
test('revoked role, blocked account and expired session take effect on the next read',async()=>{
 assert.equal((await get()).statusCode,200);
 await pool.query("UPDATE public.iam_role_assignments SET status='revoked',revoked_at=now(),version=version+1 WHERE id=$1",[assignmentId]);assert.equal((await get()).statusCode,403);
 await pool.query("UPDATE public.users SET status='deactivated' WHERE id=$1",[userId]);assert.equal((await get()).statusCode,401);
 await pool.query("UPDATE public.users SET status='active' WHERE id=$1",[userId]);await pool.query("UPDATE public.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[userId]);assert.equal((await get()).statusCode,401);
});
test('query rejects duplicate keys, unexpected keys, invalid page and bounded text',async()=>{
 for(const q of ['?code=01&code=02','?unknown=x','?page=0','?page=1.5','?page=10001','?code=abc','?code=1234567890123','?name='+encodeURIComponent('\u0001'),'?name='+'a'.repeat(251)])assert.equal((await get(q)).statusCode,400,q);
});
test('unavailable classifier schema returns 503 without SQL details',async()=>{
 await pool.query('ALTER TABLE public.okpds RENAME COLUMN is_active TO directory_unavailable');
 try{const r=await get();assert.equal(r.statusCode,503,r.body);assert.deepEqual(r.json(),{code:'temporarily_unavailable'})}
 finally{await pool.query('ALTER TABLE public.okpds RENAME COLUMN directory_unavailable TO is_active')}
});
test('runtime role can read the classifier without table ownership or write privileges',async()=>{
 const url=new URL(database.url),container=process.env.TEST_DATABASE_CONTAINER;
 assert.ok(container&&/^[\w.-]+$/.test(container));
 const binding=spawnSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'});assert.equal(binding.status,0,binding.stderr);assert.equal(binding.stdout.trim(),`127.0.0.1:${url.port}`);
 await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forum_okpd_directory_runtime') THEN CREATE ROLE forum_okpd_directory_runtime; END IF; END $$");
 const sql=await readFile('../../deployment/forum-api/grant-runtime.sql','utf8');
 const grant=spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'psql','-X','-h','127.0.0.1','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-v','ON_ERROR_STOP=1'],{input:'\\set app_role forum_okpd_directory_runtime\n'+sql,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}});
 assert.equal(grant.status,0,grant.stderr);
 const restricted=new Pool({connectionString:url.href,options:'-c role=forum_okpd_directory_runtime'});
 const service=await createApp({publicOrigin:'https://forum.example',databaseUrl:url.href,secureCookies:false,sessionTtlSeconds:3600},restricted);
 try{
  const response=await service.inject({method:'GET',url:'/api/references/okpd',headers:{cookie}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().total,4);
  for(const query of ["UPDATE public.okpds SET name='changed'","DELETE FROM public.okpds","INSERT INTO public.okpds(okpd,name,level,section) VALUES('03','Forbidden',1,'A')",'SELECT level FROM public.okpds','SELECT source_metadata FROM public.okpd_imports'])await assert.rejects(restricted.query(query),{code:'42501'});
 }finally{await service.close();await restricted.end()}
});
test('full twelve-character code is searchable without losing leading zeroes',async()=>{
 await pool.query("INSERT INTO public.okpds(okpd,level,section,name) VALUES ('01.11.11.110',6,'A','Пшеница озимая твердая')");
 const r=await get('?code=01.11.11.110&name='+encodeURIComponent('ТВЕРДАЯ'));assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json().items,[{code:'01.11.11.110',name:'Пшеница озимая твердая'}]);
});
test('uninitialized publication is unavailable rather than a misleading empty classifier',async()=>{
 await pool.query('UPDATE public.okpd_reference_state SET revision=0,source_metadata=null');const r=await get();assert.equal(r.statusCode,503);assert.deepEqual(r.json(),{code:'temporarily_unavailable'});
});
