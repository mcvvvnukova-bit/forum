import type {Pool} from 'pg';
import {v7 as uuid} from 'uuid';
import {createIndividualParticipant, findIndividualParticipant} from '../party/individual-participant.js';
import {AuthError} from './auth-error.js';
import {hashToken} from './crypto.js';
import type {SberIdentity} from './sber-client.js';

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

  async authenticate(identity: SberIdentity, intent: 'register' | 'login', token: string, ttl: number, oldToken?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const subjects = [...new Set([identity.subject, ...identity.alternateSubjects])].sort();
      // Serialize intersecting subject sets, including first registration and alias migration.
      for (const subject of subjects) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sber_id:${subject}`]);
      const matches = await client.query(`SELECT DISTINCT user_id FROM public.external_identities
        WHERE provider = 'sber_id' AND subject = ANY($1::text[])`, [subjects]);
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
      if (!isNew) {
        const participant = await findIndividualParticipant(client, userId);
        if (!participant || participant.status === 'deactivated') throw new AuthError('account_deactivated', 403);
      }
      for (const subject of subjects) {
        await client.query(`INSERT INTO public.external_identities(id, user_id, provider, subject, claims_snapshot)
          VALUES ($1, $2, 'sber_id', $3, $4) ON CONFLICT (provider, subject)
          DO UPDATE SET claims_snapshot = EXCLUDED.claims_snapshot, last_authenticated_at = now()`,
          [uuid(), userId, subject, identity.claims]);
      }
      // The reduced verified snapshot contains only these userinfo attributes.
      // Profile ownership must exist before the personal participant FK is checked.
      const profile = {sub: identity.subject, email: identity.email,
        email_verified: identity.emailConfirmed, phone_number: identity.claims.phoneNumber ?? null,
        ...Object.fromEntries([['family_name','familyName'],['given_name','givenName'],['middle_name','middleName']]
          .filter(([, claim]) => typeof identity.claims[claim] === 'string')
          .map(([field, claim]) => [field, identity.claims[claim]]))};
      await client.query(`INSERT INTO public.persons(user_id, sber_profile, identified_at, profile_received_at)
        VALUES ($1,$2,now(),now()) ON CONFLICT (user_id) DO UPDATE
        SET sber_profile=public.persons.sber_profile || EXCLUDED.sber_profile,
            identified_at=EXCLUDED.identified_at, profile_received_at=EXCLUDED.profile_received_at`, [userId, profile]);
      if (isNew) {
        const participantId = await createIndividualParticipant(client, userId);
        await client.query(`INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ($1,$2)`, [userId,participantId]);
        await client.query(`INSERT INTO public.role_assignments(id, user_id, scope_type, scope_id, role)
          VALUES ($1, $2, 'participant', $3, 'individual')`, [uuid(), userId, participantId]);
        await client.query(`INSERT INTO public.outbox_events(event_id, aggregate_type, aggregate_id, event_type, payload)
          VALUES ($1, 'participant', $2, 'ParticipantRegistered', $3)`,
          [uuid(), participantId, {userId, participantId, provider: 'sber_id', legalStatus: 'individual_person'}]);
      }
      if (oldToken) await client.query('UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(oldToken)]);
      await client.query(`INSERT INTO public.sessions(id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + $4 * interval '1 second')`, [uuid(), userId, hashToken(token), ttl]);
      await client.query(`INSERT INTO public.audit_events(id, actor_user_id, action, data)
        VALUES ($1, $2, 'UserAuthenticated', $3)`, [uuid(), userId, {provider: 'sber_id', intent}]);
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
      if (!participant || participant.status === 'deactivated') throw new AuthError('unauthenticated', 401);
      const assignments = await client.query(`SELECT role FROM public.role_assignments
        WHERE user_id=$1 AND scope_type='participant' AND scope_id=$2 AND role='individual'`, [row.id, participant.id]);
      const {expiresAt, ...user} = row;
      return {user, participant, roles: assignments.rows.map(row => row.role), expiresAt};
    } finally { client.release(); }
  }

  async logout(token: string) {
    await this.pool.query('UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
  }

  async profile(token: string) {
    // No caller-supplied user identifier: the existing active membership/session
    // contract is the only source of ownership, including legacy sessions.
    const {user} = await this.session(token);
    const result = await this.pool.query<{sber_profile: Record<string, unknown>}>(
      'SELECT sber_profile FROM public.persons WHERE user_id=$1', [user.id]);
    if (!result.rows[0]) throw new AuthError('profile_unavailable', 503);
    const profile = {...result.rows[0].sber_profile};
    delete profile.sub;
    delete profile.email_verified;
    return {userId: user.id, profile};
  }
}
