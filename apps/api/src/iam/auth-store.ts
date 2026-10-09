import type {Pool} from 'pg';
import {v7 as uuid} from 'uuid';
import {findIndividualParticipant} from '../party/individual-participant.js';
import {AuthError} from './auth-error.js';
import {hashToken} from './crypto.js';
import type {SberIdentity} from './sber-client.js';
import {canonicalProfileFields,type PersonProfile} from './person-profile.js';

/** Only trusted, validated adapters call this store; browser routes cannot select a provider. */
export interface AccountIdentity extends SberIdentity {provider?:string}

export interface AuthorizationAttempt {nonce: string; code_verifier: string; intent: 'register' | 'login'}

export class AuthStore {
  constructor(private readonly pool: Pool) {}

  async start(state: string, browser: string, nonce: string, verifier: string, intent: 'register' | 'login') {
    await this.pool.query('DELETE FROM public.authorization_attempts WHERE expires_at <= now()');
    await this.pool.query(`INSERT INTO public.authorization_attempts(state_hash, browser_hash, nonce, code_verifier, intent, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`, [hashToken(state), hashToken(browser), nonce, verifier, intent]);
  }

  async consume(state: string, browser: string): Promise<AuthorizationAttempt> {
    const result = await this.pool.query<AuthorizationAttempt>(`DELETE FROM public.authorization_attempts
      WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > now() RETURNING nonce, code_verifier, intent`,
      [hashToken(state), hashToken(browser)]);
    if (!result.rows[0]) throw new AuthError('invalid_state');
    return result.rows[0];
  }

  async authenticate(identity: AccountIdentity, intent: 'register' | 'login', token: string, ttl: number, oldToken?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const provider=identity.provider ?? 'sber_id';
      const configured=await client.query('SELECT 1 FROM public.identity_providers WHERE provider=$1 AND enabled',[provider]);
      if(!configured.rowCount) throw new AuthError('unconfigured_provider',400);
      const subjects = [...new Set([identity.subject, ...identity.alternateSubjects])].sort();
      // Serialize intersecting subject sets, including first registration and alias migration.
      for (const subject of subjects) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${provider}:${subject}`]);
      const matches = await client.query(`SELECT DISTINCT user_id FROM public.external_identities
        WHERE provider = $1 AND subject = ANY($2::text[])`, [provider,subjects]);
      if (matches.rowCount! > 1) throw new AuthError('account_conflict', 409);
      let userId: string = matches.rows[0]?.user_id;
      const isNew = !userId;
      if (!userId) {
        userId = uuid();
        await client.query(`INSERT INTO public.users(id, email, email_confirmed_at, display_name)
          VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4)`,
          [userId, identity.email, identity.emailConfirmed, identity.displayName]);
      }
      const user = await client.query('SELECT status FROM public.users WHERE id = $1 FOR UPDATE', [userId]);
      if (user.rows[0]?.status !== 'active') throw new AuthError('account_deactivated', 403);
      for (const subject of subjects) {
        await client.query(`INSERT INTO public.external_identities(id, user_id, provider, subject, claims_snapshot)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, subject)
          DO UPDATE SET claims_snapshot = EXCLUDED.claims_snapshot, last_authenticated_at = now()
          WHERE public.external_identities.user_id=EXCLUDED.user_id`,
          [uuid(), userId, provider,subject, identity.claims]);
      }
      // Trusted adapters supply reviewed attributes; Sber refreshes canonical data
      // at every login while other providers retain their existing precedence.
      const initialProfile:PersonProfile = identity.profile ?? {email:identity.email,
        phone_number:identity.claims.phoneNumber ?? null,
        ...Object.fromEntries([['family_name','familyName'],['given_name','givenName'],['middle_name','middleName']]
          .filter(([,claim])=>typeof identity.claims[claim] === 'string')
          .map(([field,claim])=>[field,identity.claims[claim]]))};
      const canonical=Object.fromEntries(canonicalProfileFields.filter(field=>Object.hasOwn(initialProfile,field)).map(field=>[field,initialProfile[field]]));
      const snapshot=provider==='sber_id' ? {...canonical,sub:identity.subject,email_verified:identity.emailConfirmed} : canonical;
      const fields=canonicalProfileFields.join(',');
      await client.query(`INSERT INTO public.persons(user_id,${fields})
        SELECT $1,${canonicalProfileFields.map(field=>`p.${field}`).join(',')}
        FROM jsonb_populate_record(NULL::public.persons,$2::jsonb) p
        ON CONFLICT(user_id) DO NOTHING`,[userId,canonical]);
      if(provider==='sber_id') {
        const supplied=canonicalProfileFields.filter(field=>Object.hasOwn(canonical,field));
        // JSONB comparison is structural. Merge only supplied, reviewed one-level
        // children; absent fields retain canonical values and explicit null clears.
        const incoming=(field:typeof canonicalProfileFields[number])=>
          `CASE WHEN jsonb_typeof($2::jsonb->'${field}')='object' THEN coalesce(current.${field},'{}'::jsonb)||($2::jsonb->'${field}') ELSE incoming.${field} END`;
        const objectFields=new Set(['identification','inn','snils','driving_license','international_passport','priority_doc','citizenship','address_reg','work_address','address_of_actual_residence','delivery_address','address','sts','previous_identification','education','marital_status']);
        const value=(field:typeof canonicalProfileFields[number])=>objectFields.has(field) ? incoming(field) : `incoming.${field}`;
        if(supplied.length) await client.query(`UPDATE public.persons AS current
          SET ${supplied.map(field=>`${field}=${value(field)}`).join(',')}
          FROM jsonb_populate_record(NULL::public.persons,$2::jsonb) AS incoming
          WHERE current.user_id=$1 AND (${supplied.map(field=>`current.${field} IS DISTINCT FROM (${value(field)})`).join(' OR ')})`,[userId,canonical]);
        const namesSupplied=['family_name','given_name','middle_name'].some(field=>Object.hasOwn(canonical,field));
        const emailSupplied=Object.hasOwn(canonical,'email');
        if(namesSupplied || emailSupplied) await client.query(`UPDATE public.users AS current
          SET display_name=CASE WHEN $2 THEN coalesce(nullif(concat_ws(' ',p.family_name,p.given_name,p.middle_name),''),'Пользователь') ELSE current.display_name END,
              email=CASE WHEN $3 THEN p.email ELSE current.email END,
              email_confirmed_at=CASE WHEN $3 THEN CASE WHEN $4 THEN coalesce(current.email_confirmed_at,now()) ELSE NULL END ELSE current.email_confirmed_at END
          FROM public.persons p WHERE current.id=$1 AND p.user_id=current.id`,[userId,namesSupplied,emailSupplied,identity.emailConfirmed]);
        // Latest reviewed source projection; never a canonical read source.
        await client.query(`UPDATE public.persons SET sber_profile=$2::jsonb,
          identity_provider='sber_id',sub=$3,identified_at=now(),profile_received_at=now() WHERE user_id=$1`,[userId,snapshot,identity.subject]);
      }
      await client.query(`INSERT INTO public.identity_profiles(identity_id,user_id,snapshot,requested_scopes,granted_scopes,identified_at,received_at)
        SELECT id,user_id,$3,$4,$5,now(),now() FROM public.external_identities
        WHERE user_id=$1 AND provider=$2 AND subject=ANY($6::text[])
        ON CONFLICT(identity_id) DO UPDATE SET snapshot=CASE WHEN $2='sber_id' THEN EXCLUDED.snapshot ELSE public.identity_profiles.snapshot||EXCLUDED.snapshot END,
          requested_scopes=EXCLUDED.requested_scopes,granted_scopes=EXCLUDED.granted_scopes,
          identified_at=EXCLUDED.identified_at,received_at=EXCLUDED.received_at`,
        [userId,provider,snapshot,identity.requestedScopes ?? [],identity.grantedScopes ?? null,subjects]);
      if(isNew) await client.query(`INSERT INTO public.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES ($1,'user',$2,'UserRegistered',$3)`,[uuid(),userId,{userId,provider}]);
      if (oldToken) await client.query('UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(oldToken)]);
      await client.query(`INSERT INTO public.sessions(id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + $4 * interval '1 second')`, [uuid(), userId, hashToken(token), ttl]);
      await client.query(`INSERT INTO public.audit_events(id, actor_user_id, action, data)
        VALUES ($1, $2, 'UserAuthenticated', $3)`, [uuid(), userId, {provider,intent}]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') throw new AuthError('account_conflict', 409);
      throw error;
    } finally { client.release(); }
  }

  async session(token: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT u.id, u.display_name AS "displayName", u.email,
        (u.email_confirmed_at IS NOT NULL) AS "emailConfirmed", s.expires_at AS "expiresAt"
        FROM public.sessions s JOIN public.users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [hashToken(token)]);
      const row = result.rows[0];
      if (!row) throw new AuthError('unauthenticated', 401);
      const participant = await findIndividualParticipant(client, row.id);

      const {expiresAt, ...user} = row;
      return {user, participant, roles: ['individual'], expiresAt};
    } finally { client.release(); }
  }

  async logout(token: string) {
    await this.pool.query('UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
  }

  async profile(token: string) {
    // Ownership comes only from the valid account session.
    const {user} = await this.session(token);
    const result = await this.pool.query<PersonProfile>(
      `SELECT ${canonicalProfileFields.map(field=>field==='birthdate' ? 'birthdate::text AS birthdate' : field).join(',')}
       FROM public.persons WHERE user_id=$1`, [user.id]);
    if (!result.rows[0]) throw new AuthError('profile_unavailable', 503);
    return {userId:user.id,profile:result.rows[0]};
  }
}
