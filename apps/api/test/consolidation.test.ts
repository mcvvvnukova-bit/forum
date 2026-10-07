import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {consolidateAuth, type LegacyAuthSnapshot} from '../src/consolidate-auth.js';
import {migrate} from '../src/migrate.js';
import {testDatabaseUrl} from './test-database.js';

const url = testDatabaseUrl(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test');
const database = decodeURIComponent(new URL(url).pathname.slice(1));
const pool = new Pool({connectionString:url});
before(async () => { await migrate(pool); });
beforeEach(async () => {
  await pool.query(`TRUNCATE public.users,public.external_identities,public.persons,public.participants,
    public.participant_memberships,public.role_assignments,public.sessions,public.authorization_attempts,
    public.audit_events,public.outbox_events,public.organizations`);
});
after(async () => { await pool.end(); });

function snapshot(): LegacyAuthSnapshot {
  const user = randomUUID(), participant = randomUUID();
  const time = '2026-10-01T08:13:57.816868+00:00';
  return {schemaVersion:1,sourceDatabase:'forum_sber_sandbox',
    sourceLedger:['001_sber_identity','004_individual_role'].map(name => ({name,applied_at:time})),tables:{
      users:[{id:user,email:null,email_confirmed_at:null,display_name:'Test person',status:'deactivated',created_at:time,updated_at:time}],
      external_identities:[{id:randomUUID(),user_id:user,provider:'sber_id',subject:'source-sub',
        claims_snapshot:{schemaVersion:1,sub:'source-sub',email:null,emailVerified:false,phoneNumber:null,displayName:'Test person',acr:null},
        last_authenticated_at:time,created_at:time}],
      participants:[{id:participant,kind:'individual',role:'provider',legal_status:'individual_person',individual_user_id:user,status:'restricted',created_at:time,updated_at:time}],
      role_assignments:[{id:randomUUID(),user_id:user,scope_type:'participant',scope_id:participant,role:'individual',created_at:time}],
      sessions:[{id:randomUUID(),user_id:user,token_hash:'preserved-hash',expires_at:'2026-10-10T08:13:57.816868+00:00',revoked_at:null,created_at:time}],
      authorization_attempts:[{state_hash:'state-hash',browser_hash:'browser-hash',nonce:'nonce',code_verifier:'verifier',intent:'login',expires_at:'2026-10-10T08:13:57.816868+00:00',created_at:time}],
      audit_events:[{id:randomUUID(),actor_user_id:user,action:'UserAuthenticated',occurred_at:time,data:{provider:'sber_id'}}],
      outbox_events:[{sequence:17,event_id:randomUUID(),aggregate_type:'participant',aggregate_id:participant,event_type:'ParticipantRegistered',schema_version:1,occurred_at:time,payload:{userId:user,participantId:participant},available_at:time,published_at:null,last_error:null}],
    }};
}

test('transfer preserves UUIDs, statuses, sessions, attempts and exact recorded profile time', async () => {
  const source = snapshot();
  const result = await consolidateAuth(pool,source,database);
  assert.equal(result.persons,1);
  const user = (await pool.query('SELECT id,status FROM public.users')).rows[0];
  assert.deepEqual(user,{id:source.tables.users[0].id,status:'deactivated'});
  assert.equal((await pool.query('SELECT token_hash FROM public.sessions')).rows[0].token_hash,'preserved-hash');
  assert.equal((await pool.query('SELECT code_verifier FROM public.authorization_attempts')).rows[0].code_verifier,'verifier');
  const person = (await pool.query("SELECT sub, to_char(identified_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS stamp,requested_scopes FROM public.persons")).rows[0];
  assert.deepEqual(person,{sub:'source-sub',stamp:'2026-10-01 08:13:57.816868',requested_scopes:[]});
  assert.equal((await pool.query("SELECT nextval('public.outbox_events_sequence_seq') AS value")).rows[0].value,'18');
  assert.equal((await pool.query('SELECT status FROM public.participant_memberships')).rows[0].status,'active');
  await assert.rejects(consolidateAuth(pool,source,database),/must be empty/);
  assert.equal((await pool.query('SELECT count(*) FROM public.users')).rows[0].count,'1');
});

test('destination mismatch rejects before data is written', async () => {
  await assert.rejects(consolidateAuth(pool,snapshot(),'unrelated'),/Wrong destination/);
  assert.equal((await pool.query('SELECT count(*) FROM public.users')).rows[0].count,'0');
});

test('invalid outbox late in transfer rolls back every earlier inserted row', async () => {
  const source = snapshot();source.tables.outbox_events[0].event_type=null;
  await assert.rejects(consolidateAuth(pool,source,database));
  for (const table of ['users','external_identities','persons','participants','participant_memberships','sessions','audit_events']) {
    assert.equal((await pool.query(`SELECT count(*) FROM public.${table}`)).rows[0].count,'0');
  }
});

test('missing verified snapshot and ambiguous primary subjects require reconciliation', async () => {
  const source = snapshot();
  delete (source.tables.external_identities[0].claims_snapshot as Record<string,unknown>).phoneNumber;
  await assert.rejects(consolidateAuth(pool,source,database),/Invalid verified/);
  const ambiguous = snapshot();
  ambiguous.tables.external_identities.push({...ambiguous.tables.external_identities[0],id:randomUUID(),subject:'other-sub',
    claims_snapshot:{...(ambiguous.tables.external_identities[0].claims_snapshot as object),sub:'other-sub'}});
  await assert.rejects(consolidateAuth(pool,ambiguous,database),/Ambiguous source/);
  assert.equal((await pool.query('SELECT count(*) FROM public.users')).rows[0].count,'0');
});
