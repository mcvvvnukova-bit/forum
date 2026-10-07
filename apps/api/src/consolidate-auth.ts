import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';

const columns = {
  users: 'id,email,email_confirmed_at,display_name,status,created_at,updated_at',
  external_identities: 'id,user_id,provider,subject,claims_snapshot,last_authenticated_at,created_at',
  participants: 'id,kind,role,legal_status,individual_user_id,status,created_at,updated_at',
  role_assignments: 'id,user_id,scope_type,scope_id,role,created_at',
  sessions: 'id,user_id,token_hash,expires_at,revoked_at,created_at',
  authorization_attempts: 'state_hash,browser_hash,nonce,code_verifier,intent,expires_at,created_at',
  audit_events: 'id,actor_user_id,action,occurred_at,data',
  outbox_events: 'sequence,event_id,aggregate_type,aggregate_id,event_type,schema_version,occurred_at,payload,available_at,published_at,last_error',
} as const;
type Table = keyof typeof columns;
export interface LegacyAuthSnapshot {
  schemaVersion: 1;
  sourceDatabase: 'forum_sber_sandbox';
  sourceLedger: {name: string; applied_at: string}[];
  tables: Record<Table, Record<string, unknown>[]>;
}

function validate(snapshot: LegacyAuthSnapshot) {
  if (snapshot.schemaVersion !== 1 || snapshot.sourceDatabase !== 'forum_sber_sandbox'
    || !Array.isArray(snapshot.sourceLedger)
    || snapshot.sourceLedger.map(row => row.name).sort().join(',') !== '001_sber_identity,004_individual_role'
    || Object.keys(snapshot.tables).sort().join(',') !== Object.keys(columns).sort().join(',')) {
    throw new Error('Unsupported source snapshot or migration ledger');
  }
  for (const table of Object.keys(columns) as Table[]) {
    if (!Array.isArray(snapshot.tables[table])) throw new Error('Missing source table');
    for (const row of snapshot.tables[table]) {
      if (Object.keys(row).sort().join(',') !== columns[table].split(',').sort().join(',')) throw new Error('Unexpected source columns');
    }
  }
  const persons = snapshot.tables.users.map(user => {
    const candidates = snapshot.tables.external_identities.filter(identity => identity.user_id === user.id);
    if (!candidates.length || candidates.some(identity => identity.provider !== 'sber_id')) throw new Error('Unsupported identity provider or missing identity');
    for (const identity of candidates) {
      const claims = identity.claims_snapshot as Record<string, unknown>;
      if (!claims || claims.schemaVersion !== 1 || typeof claims.sub !== 'string'
        || !/^\S{1,96}$/.test(claims.sub) || typeof claims.emailVerified !== 'boolean'
        || (claims.email !== null && typeof claims.email !== 'string')
        || (claims.phoneNumber !== null && typeof claims.phoneNumber !== 'string')
        || !Number.isFinite(Date.parse(String(identity.last_authenticated_at)))
        || !Number.isFinite(Date.parse(String(identity.created_at)))) throw new Error('Invalid verified source snapshot or timestamp');
    }
    const canonical = candidates.filter(identity => identity.subject === (identity.claims_snapshot as Record<string, unknown>).sub);
    if (canonical.length !== 1) throw new Error('Ambiguous source profile; explicit reconciliation required');
    const identity = canonical[0];
    const claims = identity.claims_snapshot as Record<string, unknown>;
    return {user_id: user.id, sber_profile: {sub: claims.sub, email: claims.email,
      email_verified: claims.emailVerified, phone_number: claims.phoneNumber},
      identified_at: identity.last_authenticated_at, profile_received_at: identity.last_authenticated_at,
      created_at: identity.created_at, updated_at: identity.last_authenticated_at};
  });
  if (snapshot.tables.participants.length !== persons.length
    || persons.some(person => snapshot.tables.participants.filter(p => p.individual_user_id === person.user_id).length !== 1)
    || snapshot.tables.participants.some(p => p.kind !== 'individual' || p.role !== 'provider' || p.legal_status !== 'individual_person')
    || snapshot.tables.role_assignments.length !== persons.length
    || snapshot.tables.role_assignments.some(r => r.role !== 'individual' || r.scope_type !== 'participant'
      || !snapshot.tables.participants.some(p => p.id === r.scope_id && p.individual_user_id === r.user_id))) {
    throw new Error('Unsupported personal participant or role ownership');
  }
  return persons;
}

/** Owner-only, one-shot import into an empty, migrated public identity store. */
export async function consolidateAuth(pool: Pool, snapshot: LegacyAuthSnapshot, expectedDatabase: string) {
  const persons = validate(snapshot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('forum-auth-migrations'))");
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (database !== expectedDatabase) throw new Error('Wrong destination database');
    const marker = await client.query("SELECT name FROM public.schema_migrations WHERE name='005_public_individual_role'");
    if (!marker.rowCount) throw new Error('Apply public migration005 before importing');
    const tables = [...Object.keys(columns), 'persons','organizations','participant_memberships'];
    await client.query(`LOCK TABLE ${tables.map(table => `public.${table}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of tables) {
      if ((await client.query(`SELECT 1 FROM public.${table} LIMIT 1`)).rowCount) throw new Error('Destination identity tables must be empty');
    }
    const insert = async (table: Table) => {
      await client.query(`INSERT INTO public.${table} (${columns[table]}) OVERRIDING SYSTEM VALUE
        SELECT ${columns[table]} FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)`, [JSON.stringify(snapshot.tables[table])]);
    };
    await insert('users');
    await insert('external_identities');
    await client.query(`INSERT INTO public.persons(user_id,sber_profile,identified_at,profile_received_at,created_at,updated_at)
      SELECT user_id,sber_profile,identified_at,profile_received_at,created_at,updated_at
      FROM jsonb_populate_recordset(NULL::public.persons,$1::jsonb)`, [JSON.stringify(persons)]);
    await insert('participants');
    await client.query(`INSERT INTO public.participant_memberships(user_id,participant_id)
      SELECT individual_user_id,id FROM public.participants`);
    for (const table of ['role_assignments','sessions','authorization_attempts','audit_events','outbox_events'] as Table[]) await insert(table);
    // Compare typed values of every original column, including revoked/expired sessions.
    for (const table of Object.keys(columns) as Table[]) {
      const mismatch = await client.query(`WITH expected AS (
        SELECT ${columns[table]} FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)),
        actual AS (SELECT ${columns[table]} FROM public.${table})
        SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
          UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) differences`, [JSON.stringify(snapshot.tables[table])]);
      if (mismatch.rowCount) throw new Error('Source/destination row mismatch');
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    // Do this last: PostgreSQL sequence state is not rolled back with the transaction.
    await client.query(`SELECT setval('public.outbox_events_sequence_seq',
      greatest(coalesce((SELECT max(sequence) FROM public.outbox_events),0)+1,1),false)`);
    await client.query('COMMIT');
    return {database, counts: Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, rows.length])),
      persons: persons.length, memberships: persons.length};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [urlFile, snapshotFile] = process.argv.slice(2);
  if (!urlFile || !snapshotFile || process.argv.length !== 4) throw new Error('Usage: consolidate-auth <private owner URL file> <private snapshot file>');
  for (const path of [urlFile,snapshotFile]) {
    if ((await stat(path)).mode & 0o077) throw new Error('Input files must have private permissions');
  }
  const pool = new Pool({connectionString: (await readFile(urlFile,'utf8')).trim()});
  try { console.log(JSON.stringify(await consolidateAuth(pool,JSON.parse(await readFile(snapshotFile,'utf8')),'forum'))); }
  catch { console.error('Consolidation failed; destination transaction rolled back. Inspect private operator diagnostics.'); process.exitCode=1; }
  finally { await pool.end(); }
}
