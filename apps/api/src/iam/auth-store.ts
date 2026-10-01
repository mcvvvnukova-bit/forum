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
    await this.pool.query('DELETE FROM iam.authorization_attempts WHERE expires_at <= now()');
    await this.pool.query(`INSERT INTO iam.authorization_attempts(state_hash, browser_hash, nonce, code_verifier, intent, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`, [hashToken(state), hashToken(browser), nonce, verifier, intent]);
  }

  async consume(state: string, browser: string): Promise<AuthorizationAttempt> {
    const result = await this.pool.query<AuthorizationAttempt>(`DELETE FROM iam.authorization_attempts
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
      const matches = await client.query(`SELECT DISTINCT user_id FROM iam.external_identities
        WHERE provider = 'sber_id' AND subject = ANY($1::text[])`, [subjects]);
      if (matches.rowCount! > 1) throw new AuthError('account_conflict', 409);
      let userId: string = matches.rows[0]?.user_id;
      if (!userId) {
        if (intent !== 'register') throw new AuthError('registration_required', 409);
        userId = uuid();
        await client.query(`INSERT INTO iam.users(id, email, email_confirmed_at, display_name)
          VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4)`,
          [userId, identity.email, identity.emailConfirmed, identity.displayName]);
        const participantId = await createIndividualParticipant(client, userId);
        await client.query(`INSERT INTO iam.role_assignments(id, user_id, scope_type, scope_id, role)
          VALUES ($1, $2, 'participant', $3, 'provider')`, [uuid(), userId, participantId]);
        await client.query(`INSERT INTO integration.outbox_events(event_id, aggregate_type, aggregate_id, event_type, payload)
          VALUES ($1, 'participant', $2, 'ParticipantRegistered', $3)`,
          [uuid(), participantId, {userId, participantId, provider: 'sber_id', legalStatus: 'individual_person'}]);
      }
      const user = await client.query('SELECT status FROM iam.users WHERE id = $1 FOR UPDATE', [userId]);
      if (user.rows[0]?.status !== 'active') throw new AuthError('account_deactivated', 403);
      const participant = await findIndividualParticipant(client, userId);
      if (!participant || participant.status === 'deactivated') throw new AuthError('account_deactivated', 403);
      for (const subject of subjects) {
        await client.query(`INSERT INTO iam.external_identities(id, user_id, provider, subject, claims_snapshot)
          VALUES ($1, $2, 'sber_id', $3, $4) ON CONFLICT (provider, subject)
          DO UPDATE SET claims_snapshot = EXCLUDED.claims_snapshot, last_authenticated_at = now()`,
          [uuid(), userId, subject, identity.claims]);
      }
      if (oldToken) await client.query('UPDATE iam.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(oldToken)]);
      await client.query(`INSERT INTO iam.sessions(id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + $4 * interval '1 second')`, [uuid(), userId, hashToken(token), ttl]);
      await client.query(`INSERT INTO audit.audit_events(id, actor_user_id, action, data)
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
        FROM iam.sessions s JOIN iam.users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [hashToken(token)]);
      const row = result.rows[0];
      if (!row) throw new AuthError('unauthenticated', 401);
      const participant = await findIndividualParticipant(client, row.id);
      if (!participant || participant.status === 'deactivated') throw new AuthError('unauthenticated', 401);
      const {expiresAt, ...user} = row;
      return {user, participant, expiresAt};
    } finally { client.release(); }
  }

  async logout(token: string) {
    await this.pool.query('UPDATE iam.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
  }
}
