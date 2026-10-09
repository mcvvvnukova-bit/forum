import {after, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.js';
import {createApp} from '../src/app.js';
import {BusinessAccess} from '../src/party/business-access.js';
import {AuthStore} from '../src/iam/auth-store.js';
import {testDatabaseUrl} from './test-database.js';

const pool = new Pool({connectionString:testDatabaseUrl(process.env.TEST_DATABASE_URL)});
async function reset(upgrade=false) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  if(upgrade) {
    await pool.query('CREATE SCHEMA iam; CREATE TABLE iam.schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
    for(const name of ['001_sber_identity','002_profiles','003_public_schema','005_public_individual_role']) {
      await pool.query(await readFile(`migrations/${name}.sql`,'utf8'));
      await pool.query(`INSERT INTO ${name < '003' ? 'iam' : 'public'}.schema_migrations(name) VALUES ($1)`,[name]);
    }
  } else await migrate(pool);
}
beforeEach(async()=>{await reset();});
after(async()=>{await pool.end();});
const addUser=async()=>{const id=randomUUID();await pool.query("INSERT INTO public.users(id,display_name) VALUES ($1,'Synthetic person')",[id]);return id;};

test('generic person has no Sber dependency and accepts independently editable canonical data',async()=>{
  const user=await addUser();
  await pool.query("INSERT INTO public.persons(user_id,family_name) VALUES ($1,'Independent')",[user]);
  const person=(await pool.query('SELECT family_name,sber_profile,sub,identity_provider FROM public.persons')).rows[0];
  assert.deepEqual(person,{family_name:'Independent',sber_profile:null,sub:null,identity_provider:null});
  assert.equal((await pool.query('SELECT count(*) FROM public.participants')).rows[0].count,'0');
});

test('upgrade preserves every generated canonical attribute, source timestamp, UUID and history; repeat apply is inert',async()=>{
  await reset(true);
  const user=await addUser(),identity=randomUUID(),participant=randomUUID();
  const profile={sub:'upgrade-sub',email:'synthetic@example.test',phone_number:'+70000000000',birthdate:'02.03.2001',family_name:'Test',given_name:'Person',middle_name:'Middle',gender:1,
    identification:{series:'0000',number:'000000'},inn:{number:'000000000000'},snils:{number:'00000000000'},driving_license:{number:'x'},international_passport:{number:'y'},priority_doc:{type:1},citizenship:{country_code:'RU'},place_of_birth:'City',
    address_reg:{full_address:'Registration'},work_address:{full_address:'Work'},address_of_actual_residence:{full_address:'Actual'},delivery_address:{full_address:'Delivery'},address:{full_address:'Other'},sts:{number:'z'},previous_identification:{number:'p'},
    previous_family_name:'Before',previous_given_name:'Former',previous_middle_name:'Old',education:{code:1},place_of_work:'Company',job_title:'Job',marital_status:{code:2},is_self_employed:true};
  await pool.query('BEGIN');
  await pool.query("INSERT INTO public.external_identities(id,user_id,provider,subject,claims_snapshot) VALUES ($1,$2,'sber_id','upgrade-sub','{}')",[identity,user]);
  await pool.query("INSERT INTO public.persons(user_id,sber_profile,identified_at,profile_received_at,requested_scopes,granted_scopes) VALUES ($1,$2,'2026-09-01 12:34:56.123456Z','2026-09-01 12:34:57.654321Z','{openid,name}','{openid}')",[user,profile]);
  await pool.query("INSERT INTO public.participants(id,kind,role,legal_status,individual_user_id) VALUES ($1,'individual','provider','individual_person',$2)",[participant,user]);
  await pool.query('INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ($1,$2)',[user,participant]);
  await pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES ($1,'participant',$2,'individual')",[user,participant]);
  await pool.query("INSERT INTO public.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES ($1,'participant',$2,'ParticipantRegistered','{}')",[randomUUID(),participant]);
  await pool.query('COMMIT');
  const before=(await pool.query('SELECT to_jsonb(p) AS value FROM public.persons p')).rows[0].value;
  const history=(await pool.query('SELECT to_jsonb(e) AS value FROM public.outbox_events e')).rows;
  await migrate(pool);await migrate(pool);
  const after=(await pool.query('SELECT to_jsonb(p) AS value FROM public.persons p')).rows[0].value;
  assert.deepEqual(after,before);
  assert.deepEqual((await pool.query('SELECT to_jsonb(e) AS value FROM public.outbox_events e')).rows,history);
  const source=(await pool.query("SELECT identity_id,user_id,snapshot,requested_scopes,granted_scopes,to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') stamp FROM public.identity_profiles")).rows[0];
  assert.deepEqual(source,{identity_id:identity,user_id:user,snapshot:profile,requested_scopes:['openid','name'],granted_scopes:['openid'],stamp:'2026-09-01 12:34:57.654321'});
  assert.equal((await pool.query("SELECT count(*) FROM pg_attribute WHERE attrelid='public.persons'::regclass AND attgenerated<>''")).rows[0].count,'0');
});

test('migration fault rolls back canonical conversion and ledger before safe retry',async()=>{
  await reset(true);
  await pool.query('CREATE TABLE public.organization_memberships(blocker integer)');
  await assert.rejects(migrate(pool));
  assert.equal((await pool.query("SELECT attgenerated FROM pg_attribute WHERE attrelid='public.persons'::regclass AND attname='family_name'")).rows[0].attgenerated,'s');
  assert.equal((await pool.query("SELECT count(*) FROM public.schema_migrations WHERE name='006_person_memberships'")).rows[0].count,'0');
  assert.equal((await pool.query("SELECT to_regclass('public.identity_profiles') AS value")).rows[0].value,null);
  await pool.query('DROP TABLE public.organization_memberships');await migrate(pool);
});

test('configured second provider owns separate subjects, unconfigured namespaces and cross-owner aliases are rejected',async()=>{
  await pool.query("INSERT INTO public.identity_providers(provider) VALUES ('test_provider')");
  const store=new AuthStore(pool);
  const identity={subject:'same-sub',alternateSubjects:[],displayName:'Synthetic',email:null,emailConfirmed:false,claims:{givenName:'Generic'}};
  await store.authenticate(Object.assign({...identity},{provider:'test_provider'}),'login','test-second-token',3600);
  await store.authenticate(identity,'login','test-sber-token',3600);
  assert.equal((await pool.query('SELECT count(*) FROM public.users')).rows[0].count,'2');
  assert.equal((await pool.query('SELECT count(*) FROM public.identity_profiles')).rows[0].count,'2');
  assert.equal((await store.session('test-second-token')).participant,null);
  assert.equal((await store.profile('test-second-token')).profile.given_name,'Generic');
  await assert.rejects(store.authenticate(Object.assign({...identity},{provider:'unconfigured'}),'login','no-token',3600),/unconfigured_provider/);
  await store.authenticate(Object.assign({...identity,subject:'other-sub'},{provider:'test_provider'}),'login','other-token',3600);
  await assert.rejects(store.authenticate(Object.assign({...identity,alternateSubjects:['other-sub']},{provider:'test_provider'}),'login','collision-token',3600),/account_conflict/);
});

async function company(user:string,inn:string) {
  const id=randomUUID(),participant=randomUUID();
  await pool.query("INSERT INTO public.organizations(id,legal_status,inn,legal_name,created_by_user_id) VALUES ($1,'legal_entity',$2,'Synthetic company',$3)",[id,inn,user]);
  await pool.query("INSERT INTO public.participants(id,kind,role,legal_status,organization_id) VALUES ($1,'organization','customer','legal_entity',$2)",[participant,id]);
  await pool.query('INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ($1,$2)',[user,participant]);
  await pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES ($1,'participant',$2,'customer'),($1,'participant',$2,'organization_admin')",[user,participant]);
  return {id,participant};
}
const access=async(user:string,participant:string,role:'customer'|'provider'|'organization_admin'|'individual'='customer',write=true)=>
  new BusinessAccess(pool).allows(user,participant,role as 'customer'|'provider'|'organization_admin',write);
async function activate(user:string,org:string) {
  await pool.query("UPDATE public.organizations SET registration_state='registered',registered_at=now() WHERE id=$1",[org]);
  await pool.query("INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,created_by_user_id,approved_by_user_id,effective_from) VALUES ($1,$2,'active','invitation','synthetic-invite',$1,$1,now())",[user,org]);
}

test('corporate permissions require two active memberships and scoped grant; restriction affects actions and revocation is local',async()=>{
  const user=await addUser(),one=await company(user,'0000000001'),two=await company(user,'0000000002');
  assert.equal(await access(user,one.participant),false);
  await pool.query("INSERT INTO public.organization_memberships(user_id,organization_id,basis_type,basis_reference,created_by_user_id) VALUES ($1,$2,'invitation','pending-invite',$1)",[user,one.id]);
  assert.equal(await access(user,one.participant),false);
  await pool.query('DELETE FROM public.organization_memberships');await activate(user,one.id);await activate(user,two.id);
  assert.equal(await access(user,one.participant),true);
  assert.equal(await access(user,one.participant,'provider'),false);
  assert.equal(await access(user,one.participant,'individual'),false);
  await pool.query("UPDATE public.participants SET status='restricted' WHERE id=$1",[one.participant]);
  assert.equal(await access(user,one.participant),false);assert.equal(await access(user,one.participant,'customer',false),true);
  await pool.query("UPDATE public.participants SET status='active' WHERE id=$1",[one.participant]);
  await pool.query("UPDATE public.organizations SET status='restricted' WHERE id=$1",[one.id]);
  assert.equal(await access(user,one.participant),false);
  await pool.query("UPDATE public.organizations SET status='active' WHERE id=$1",[one.id]);
  await pool.query("UPDATE public.organization_memberships SET status='revoked',revoked_at=now() WHERE organization_id=$1",[one.id]);
  assert.equal(await access(user,one.participant),false);assert.equal(await access(user,two.participant),true);
  await pool.query("UPDATE public.participant_memberships SET status='revoked' WHERE participant_id=$1",[two.participant]);
  assert.equal(await access(user,two.participant),false);
});

test('admin grant requires independently confirmed matching authority and time; evidence ownership and states are enforced',async()=>{
  const user=await addUser(),other=await addUser(),one=await company(user,'0000000003'),two=await company(user,'0000000004');
  await activate(user,one.id);await activate(user,two.id);
  assert.equal(await access(user,one.participant,'organization_admin'),false);
  const authority=randomUUID();
  await pool.query("INSERT INTO public.organization_authorities(id,user_id,organization_id,authority_type,basis_type,basis_reference,created_by_user_id) VALUES ($1,$2,$3,'administrator','document','synthetic-proof',$4)",[authority,user,one.id,other]);
  for(const status of ['pending','rejected']) {
    if(status==='rejected') await pool.query("UPDATE public.organization_authorities SET status='rejected',approved_by_user_id=$1,decided_at=now() WHERE id=$2",[other,authority]);
    assert.equal(await access(user,one.participant,'organization_admin'),false);
  }
  await assert.rejects(pool.query("UPDATE public.organization_authorities SET status='confirmed' WHERE id=$1",[authority]),{code:'23514'});
  await pool.query("UPDATE public.organization_authorities SET status='confirmed',approved_by_user_id=$1,decided_at=now(),effective_from=now() WHERE id=$2",[other,authority]);
  assert.equal(await access(user,one.participant,'organization_admin'),true);
  assert.equal(await access(user,two.participant,'organization_admin'),false);
  await assert.rejects(pool.query('UPDATE public.organization_authorities SET organization_id=$1 WHERE id=$2',[two.id,authority]),{code:'23514'});
  await assert.rejects(pool.query('UPDATE public.organization_memberships SET user_id=$1 WHERE organization_id=$2',[other,one.id]),{code:'23514'});
  await pool.query("UPDATE public.organization_authorities SET effective_from=now()+interval '1 hour' WHERE id=$1",[authority]);
  assert.equal(await access(user,one.participant,'organization_admin'),false);
  await pool.query("UPDATE public.organization_authorities SET effective_from=now()-interval '1 hour',effective_until=now()-interval '1 minute' WHERE id=$1",[authority]);
  assert.equal(await access(user,one.participant,'organization_admin'),false);
  await pool.query("UPDATE public.organization_authorities SET status='revoked',revoked_at=now(),effective_until=NULL WHERE id=$1",[authority]);
  assert.equal(await access(user,one.participant,'organization_admin'),false);assert.equal(await access(user,one.participant),true);
  await pool.query("UPDATE public.users SET status='deactivated' WHERE id=$1",[user]);
  assert.equal(await access(user,one.participant),false);
});

function psqlResult(file:string) {
  // No fallback: the caller must name the disposable endpoint used by the pool.
  const authority=new URL(testDatabaseUrl(process.env.TEST_DATABASE_URL));
  const container=process.env.TEST_DATABASE_CONTAINER;
  assert.ok(container && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container),'Set TEST_DATABASE_CONTAINER to the disposable PostgreSQL container');
  assert.equal(authority.hostname,'127.0.0.1','Container psql requires an exact IPv4 loopback binding');
  const binding=spawnSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'});
  assert.equal(binding.status,0,binding.stderr);
  assert.equal(binding.stdout.trim(),`127.0.0.1:${authority.port || '5432'}`,'Container must match TEST_DATABASE_URL endpoint');
  return spawnSync('docker',['exec','-i','-e','PGPASSWORD',container,'psql','-X','-h','127.0.0.1','-U',decodeURIComponent(authority.username),'-d',decodeURIComponent(authority.pathname.slice(1)),'-v','ON_ERROR_STOP=1'],
    {input:file,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(authority.password)}});
}
function psql(file:string) {
  const result=psqlResult(file);
  assert.equal(result.status,0,result.stderr);return result.stdout;
}
test('psql entrypoint applies 005/006 repeatably; restricted runtime authenticates and queries access without approval/DDL rights',async()=>{
  await pool.query('DROP SCHEMA public CASCADE;CREATE SCHEMA public');
  const entry=await readFile('../../deployment/forum-db/apply-public.psql','utf8');
  // psql include paths are expanded to the exact repository files before piping into the dedicated container.
  const expanded=entry.replace(/\\ir (.+)/g,(_,path:string)=>`__INCLUDE__${path}`);
  let script=expanded;
  for(const line of expanded.split('\n').filter(v=>v.includes('__INCLUDE__'))) {
    const included=await readFile('../../deployment/forum-db/'+line.trim().slice('__INCLUDE__'.length),'utf8');
    script=script.replace(line,()=>included);
  }
  psql(script);psql(script);
  assert.equal((await pool.query("SELECT count(*) FROM public.schema_migrations WHERE name IN ('005_public_individual_role','006_person_memberships')")).rows[0].count,'2');
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proj161_runtime') THEN CREATE ROLE proj161_runtime; END IF; END $$");
  psql('\\set app_role proj161_runtime\n'+await readFile('../../deployment/forum-api/grant-runtime.sql','utf8'));
  const client=await pool.connect();
  try {
    await client.query('SET ROLE proj161_runtime');
    assert.equal((await client.query('SELECT public.effective_business_access($1,$2,$3,true) allowed',[randomUUID(),randomUUID(),'customer'])).rows[0].allowed,false);
    for(const sql of ["CREATE TABLE public.forbidden_test(id int)","INSERT INTO public.identity_providers(provider) VALUES ('forbidden')","INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,basis_type,basis_reference) VALUES (gen_random_uuid(),gen_random_uuid(),'administrator','self','no')"]) await assert.rejects(client.query(sql),{code:'42501'});
  } finally {await client.query('RESET ROLE');client.release();}
  const runtimePool=new Pool({connectionString:testDatabaseUrl(process.env.TEST_DATABASE_URL),options:'-c role=proj161_runtime'});
  const store=new AuthStore(runtimePool);
  await store.authenticate({subject:'runtime-sub',alternateSubjects:[],displayName:'Runtime test',email:null,emailConfirmed:false,claims:{}},'login','runtime-test-token',3600);
  assert.deepEqual((await store.session('runtime-test-token')).roles,['individual']);
  assert.equal((await store.profile('runtime-test-token')).profile.family_name,null);
  const runtimeApp=await createApp({publicOrigin:'http://localhost',databaseUrl:testDatabaseUrl(process.env.TEST_DATABASE_URL),secureCookies:false,sessionTtlSeconds:3600},runtimePool);
  try {assert.equal((await runtimeApp.inject({method:'GET',url:'/health/ready'})).statusCode,200);}
  finally {await runtimeApp.close();}
  const grantUser=await addUser(),grantCompany=await company(grantUser,'0000000009');
  await activate(grantUser,grantCompany.id);
  assert.equal(await new BusinessAccess(runtimePool).allows(grantUser,grantCompany.participant,'customer'),true);
  await runtimePool.query("UPDATE public.role_assignments SET status='revoked',revoked_at=now() WHERE scope_id=$1 AND role='customer'",[grantCompany.participant]);
  assert.equal(await new BusinessAccess(runtimePool).allows(grantUser,grantCompany.participant,'customer'),false);
  await assert.rejects(runtimePool.query("UPDATE public.role_assignments SET role='provider' WHERE scope_id=$1",[grantCompany.participant]),{code:'42501'});
  await runtimePool.end();
  const acl=(await pool.query("SELECT has_table_privilege('proj161_runtime','public.organization_memberships','UPDATE') approval,has_table_privilege('proj161_runtime','public.schema_migrations','INSERT') migration")).rows[0];
  assert.deepEqual(acl,{approval:false,migration:false});
});

test('legacy company associations are preserved with provenance but admin evidence remains pending',async()=>{
  await reset(true);
  const user=await addUser(),org=randomUUID(),participant=randomUUID();
  await pool.query("INSERT INTO public.organizations(id,legal_status,inn,legal_name,provider_organization_id,identified_at) VALUES ($1,'legal_entity','0000000005','Legacy synthetic','legacy-org','2026-09-01 12:00:00Z')",[org]);
  await pool.query("INSERT INTO public.participants(id,kind,role,legal_status,organization_id) VALUES ($1,'organization','customer','legal_entity',$2)",[participant,org]);
  await pool.query("INSERT INTO public.participant_memberships(user_id,participant_id,created_at) VALUES ($1,$2,'2026-09-02 12:00:00Z')",[user,participant]);
  await pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES ($1,'participant',$2,'customer'),($1,'participant',$2,'organization_admin')",[user,participant]);
  const originalOrganization=(await pool.query('SELECT updated_at FROM public.organizations WHERE id=$1',[org])).rows[0];
  const grants=(await pool.query('SELECT id,user_id,scope_id,role FROM public.role_assignments ORDER BY role')).rows;
  await migrate(pool);
  assert.deepEqual((await pool.query('SELECT id,user_id,scope_id,role FROM public.role_assignments ORDER BY role')).rows,grants);
  assert.deepEqual((await pool.query('SELECT updated_at FROM public.organizations WHERE id=$1',[org])).rows[0],originalOrganization);
  const membership=(await pool.query("SELECT status,basis_type,basis_reference,approved_by_user_id,to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') effective FROM public.organization_memberships")).rows[0];
  assert.deepEqual(membership,{status:'active',basis_type:'legacy',basis_reference:'migration006:participant_memberships',approved_by_user_id:null,effective:'2026-09-02 12:00:00'});
  assert.equal(await access(user,participant),true);
  assert.equal(await access(user,participant,'organization_admin'),false);
  assert.deepEqual((await pool.query('SELECT status,basis_type,approved_by_user_id,effective_from FROM public.organization_authorities')).rows,[{status:'pending',basis_type:'legacy',approved_by_user_id:null,effective_from:null}]);
});

test('source ownership, invalid company state, expired membership and grant scope mismatch fail closed',async()=>{
  const user=await addUser(),other=await addUser(),org=await company(user,'0000000006');
  await activate(user,org.id);
  await assert.rejects(pool.query("INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role) VALUES ($1,'participant',$2,'provider')",[user,org.participant]),{code:'23514'});
  await assert.rejects(pool.query("UPDATE public.organizations SET registration_state='pending' WHERE id=$1",[org.id]),{code:'23514'});
  await assert.rejects(pool.query("UPDATE public.organization_memberships SET status='pending' WHERE organization_id=$1",[org.id]),{code:'23514'});
  await pool.query("UPDATE public.organization_memberships SET effective_from=now()-interval '1 hour',effective_until=now()-interval '1 minute' WHERE organization_id=$1",[org.id]);
  assert.equal(await access(user,org.participant),false);
  await pool.query("UPDATE public.organization_memberships SET effective_from=now(),effective_until=NULL WHERE organization_id=$1",[org.id]);
  await pool.query("UPDATE public.organizations SET status='deactivated' WHERE id=$1",[org.id]);
  assert.equal(await access(user,org.participant,'customer',false),false);
  const store=new AuthStore(pool);
  await store.authenticate({subject:'ownership-sub',alternateSubjects:[],displayName:'Ownership',email:null,emailConfirmed:false,claims:{}},'login','ownership-token',3600);
  await assert.rejects(pool.query('UPDATE public.external_identities SET user_id=$1',[other]),{code:'23514'});
  await assert.rejects(pool.query('UPDATE public.identity_profiles SET user_id=$1',[other]),{code:'23514'});
  await pool.query("UPDATE public.identity_providers SET enabled=false WHERE provider='sber_id'");
  await assert.rejects(store.authenticate({subject:'ownership-sub',alternateSubjects:[],displayName:'Ownership',email:null,emailConfirmed:false,claims:{}},'login','disabled-token',3600),/unconfigured_provider/);
  assert.equal((await store.session('ownership-token')).user.displayName,'Ownership');
});

test('both migration entrypoints reject mixed and legacy layouts before touching data',async()=>{
  const entry=await readFile('../../deployment/forum-db/apply-public.psql','utf8');
  await pool.query('CREATE SCHEMA iam;CREATE TABLE iam.schema_migrations(name text PRIMARY KEY)');
  await assert.rejects(migrate(pool),/reviewed consolidation/);
  const result=psqlResult(entry);
  assert.notEqual(result.status,0);assert.match(result.stderr,/Both public and legacy/);
  assert.equal((await pool.query("SELECT count(*) FROM public.schema_migrations WHERE name='006_person_memberships'")).rows[0].count,'1');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await assert.rejects(migrate(pool),/reviewed consolidation/);
  const legacy=psqlResult(entry);
  assert.notEqual(legacy.status,0);assert.match(legacy.stderr,/Legacy installation requires/);
  assert.equal((await pool.query("SELECT count(*) FROM iam.schema_migrations")).rows[0].count,'0');
  await pool.query('DROP TABLE iam.schema_migrations;DROP SCHEMA iam');
});

test('revoking a business grant alone preserves memberships, account session and other-company access',async()=>{
  const store=new AuthStore(pool);
  await store.authenticate({subject:'grant-lifecycle',alternateSubjects:[],displayName:'Grant person',email:null,emailConfirmed:false,claims:{}},'login','grant-lifecycle-token',3600);
  const user=(await store.session('grant-lifecycle-token')).user.id;
  const one=await company(user,'0000000007'),two=await company(user,'0000000008');
  await activate(user,one.id);await activate(user,two.id);
  assert.equal(await access(user,one.participant),true);
  await assert.rejects(pool.query("UPDATE public.role_assignments SET status='revoked' WHERE scope_id=$1 AND role='customer'",[one.participant]),{code:'23514'});
  await pool.query("UPDATE public.role_assignments SET status='revoked',revoked_at=now() WHERE scope_id=$1 AND role='customer'",[one.participant]);
  assert.equal(await access(user,one.participant),false);
  assert.equal(await access(user,two.participant),true);
  assert.deepEqual((await store.session('grant-lifecycle-token')).roles,['individual']);
  assert.equal((await pool.query("SELECT count(*) FROM public.organization_memberships WHERE status='active'")).rows[0].count,'2');
  assert.equal((await pool.query("SELECT count(*) FROM public.participant_memberships WHERE status='active'")).rows[0].count,'2');
  await pool.query("UPDATE public.role_assignments SET status='active',revoked_at=NULL WHERE scope_id=$1 AND role='customer'",[one.participant]);
  assert.equal(await access(user,one.participant),true);
});


test('readiness rejects missing006 and each required source-write or grant-lifecycle permission',async()=>{
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proj161_runtime') THEN CREATE ROLE proj161_runtime; END IF; END $$");
  psql('\\set app_role proj161_runtime\n'+await readFile('../../deployment/forum-api/grant-runtime.sql','utf8'));
  const runtimePool=new Pool({connectionString:testDatabaseUrl(process.env.TEST_DATABASE_URL),options:'-c role=proj161_runtime'});
  const app=await createApp({publicOrigin:'http://localhost',databaseUrl:testDatabaseUrl(process.env.TEST_DATABASE_URL),secureCookies:false,sessionTtlSeconds:3600},runtimePool);
  const ready=async()=>(await app.inject({method:'GET',url:'/health/ready'})).statusCode;
  try {
    assert.equal(await ready(),200);
    await pool.query("DELETE FROM public.schema_migrations WHERE name='006_person_memberships'");
    try {assert.equal(await ready(),503,'missing006 marker');}
    finally {await pool.query("INSERT INTO public.schema_migrations(name) VALUES ('006_person_memberships')");}
    for(const [privilege,table] of [['INSERT','identity_profiles'],['UPDATE','identity_profiles'],['UPDATE(status)','role_assignments'],['UPDATE(revoked_at)','role_assignments']]) {
      await pool.query(`REVOKE ${privilege} ON public.${table} FROM proj161_runtime`);
      try {assert.equal(await ready(),503,`${table}/${privilege}`);}
      finally {await pool.query(`GRANT ${privilege} ON public.${table} TO proj161_runtime`);}
      assert.equal(await ready(),200);
    }
    assert.deepEqual((await runtimePool.query("SELECT name FROM public.schema_migrations WHERE name='006_person_memberships'")).rows,[{name:'006_person_memberships'}]);
    for(const statement of ['SELECT applied_at FROM public.schema_migrations',"INSERT INTO public.schema_migrations(name) VALUES ('forbidden')",'UPDATE public.schema_migrations SET name=name','DELETE FROM public.schema_migrations'])
      await assert.rejects(runtimePool.query(statement),{code:'42501'});
  } finally {await app.close();await runtimePool.end();}
});

test('container psql rejects a mismatched endpoint before executing SQL',async()=>{
  const original=process.env.TEST_DATABASE_URL;
  const url=new URL(testDatabaseUrl(original));url.port=url.port==='1'?'2':'1';
  process.env.TEST_DATABASE_URL=url.toString();
  try {assert.throws(()=>psql('SELECT 1'),/Container must match TEST_DATABASE_URL endpoint/);}
  finally {process.env.TEST_DATABASE_URL=original;}
});


test('generic repeated login preserves canonical manual changes',async()=>{
  await pool.query("INSERT INTO public.identity_providers(provider) VALUES ('test_provider')");
  const store=new AuthStore(pool);
  const identity={provider:'test_provider',subject:'generic-repeat',alternateSubjects:[],displayName:'Generic',email:null,emailConfirmed:false,claims:{},profile:{family_name:'Source'}};
  await store.authenticate(identity,'login','first-generic',3600);
  await pool.query("UPDATE public.persons SET family_name='Manual'");
  await store.authenticate({...identity,profile:{family_name:'Changed source'}},'login','second-generic',3600);
  assert.equal((await store.profile('second-generic')).profile.family_name,'Manual');
});

test('unchanged structural Sber objects skip canonical updates and explicit null clears objects',async()=>{
  const store=new AuthStore(pool);
  const identity={subject:'structural',alternateSubjects:[],displayName:'Source',email:null,emailConfirmed:false,claims:{},profile:{family_name:'Source',identification:{series:'1234',number:'555555'}}};
  await store.authenticate(identity,'login','first-structural',3600);
  await pool.query('CREATE TABLE public.canonical_update_count(value integer); INSERT INTO public.canonical_update_count VALUES (0)');
  await pool.query(`CREATE FUNCTION public.count_canonical_updates() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.canonical_update_count SET value=value+1; RETURN NEW; END $$;
    CREATE TRIGGER count_canonical_updates AFTER UPDATE OF family_name,identification ON public.persons FOR EACH ROW EXECUTE FUNCTION public.count_canonical_updates()`);
  await store.authenticate({...identity,profile:{family_name:'Source',identification:{number:'555555',series:'1234'}}},'login','second-structural',3600);
  assert.equal((await pool.query('SELECT value FROM public.canonical_update_count')).rows[0].value,0);
  await store.authenticate({...identity,profile:{family_name:null,identification:null}},'login','third-structural',3600);
  assert.equal((await pool.query('SELECT value FROM public.canonical_update_count')).rows[0].value,1);
  assert.equal((await store.profile('third-structural')).profile.identification,null);
  assert.equal((await store.session('third-structural')).user.displayName,'Пользователь');
});
