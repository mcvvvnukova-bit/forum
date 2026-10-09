import type {Pool,PoolClient} from 'pg';
import {v7 as uuid} from 'uuid';
import {createIndividualParticipant} from '../party/individual-participant.js';
import {AuthError} from './auth-error.js';
import {hashToken} from './crypto.js';

export interface AccountSettings {userId:string;workAsIndividual:boolean}

/** The session owns the setting. Personal provider grants are independent of
 * the account role and all organization memberships/authorities. Requires 006. */
export class SettingsStore {
  constructor(private readonly pool:Pool) {}

  async read(token:string):Promise<AccountSettings> {
    const result=await this.pool.query<AccountSettings>(`SELECT u.id AS "userId", EXISTS (
      SELECT 1 FROM public.participants p WHERE p.individual_user_id=u.id
        AND p.kind='individual' AND p.role='provider'
        AND public.effective_business_access(u.id,p.id,'provider')
      ) AS "workAsIndividual"
      FROM public.sessions s JOIN public.users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`,[hashToken(token)]);
    if(!result.rows[0])throw new AuthError('unauthenticated',401);
    return result.rows[0];
  }

  async update(token:string,enabled:boolean):Promise<AccountSettings> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Both serialization and ownership are checked inside the write transaction.
      const owner=await client.query<{id:string}>(`SELECT u.id FROM public.sessions s JOIN public.users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' FOR UPDATE OF u,s`,[hashToken(token)]);
      if(!owner.rows[0])throw new AuthError('unauthenticated',401);
      const userId=owner.rows[0].id;
      const personal=await client.query<{id:string;status:string}>(`SELECT id,status FROM public.participants
        WHERE individual_user_id=$1 AND kind='individual' AND role='provider' FOR UPDATE`,[userId]);
      let participant=personal.rows[0];
      if(enabled && participant && participant.status!=='active')throw new AuthError('participation_restricted',409);
      if(enabled && !participant){
        const id=await createIndividualParticipant(client,userId);
        participant={id,status:'active'};
        await client.query(`INSERT INTO public.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload)
          VALUES ($1,'participant',$2,'ParticipantRegistered',$3)`,[uuid(),id,{userId,participantId:id,source:'account_settings',legalStatus:'individual_person'}]);
      }
      const changed=participant?await this.setGrant(client,userId,participant.id,enabled):false;
      if(changed)await client.query(`INSERT INTO public.audit_events(id,actor_user_id,action,data) VALUES ($1,$2,$3,$4)`,
        [uuid(),userId,enabled?'IndividualParticipationEnabled':'IndividualParticipationDisabled',{participantId:participant.id,workAsIndividual:enabled}]);
      await client.query('COMMIT');
      return {userId,workAsIndividual:enabled};
    } catch(error){await client.query('ROLLBACK');throw error}
    finally{client.release()}
  }

  private async setGrant(client:PoolClient,userId:string,participantId:string,enabled:boolean):Promise<boolean> {
    const membership=await client.query<{status:string}>(`SELECT status FROM public.participant_memberships
      WHERE user_id=$1 AND participant_id=$2 FOR UPDATE`,[userId,participantId]);
    if(enabled && membership.rows[0]?.status==='revoked')throw new AuthError('participation_restricted',409);
    if(enabled && !membership.rows[0])await client.query(`INSERT INTO public.participant_memberships(user_id,participant_id,basis_type,basis_reference)
      VALUES ($1,$2,'user_consent','settings:individual')`,[userId,participantId]);
    const grants=await client.query<{id:string;status:string;selfRevoked:boolean}>(`SELECT r.id,r.status, EXISTS (
      SELECT 1 FROM public.audit_events a WHERE a.actor_user_id=$1 AND a.action='IndividualParticipationDisabled'
        AND a.data->>'participantId'=$2::text AND a.occurred_at=r.revoked_at
      ) AS "selfRevoked" FROM public.role_assignments r
      WHERE r.user_id=$1 AND r.scope_type='participant' AND r.scope_id=$2::uuid AND r.role='provider' FOR UPDATE`,[userId,participantId]);
    const grant=grants.rows[0];
    if(enabled){
      if(grant?.status==='active')return false;
      // A fresh administrative revocation has a different timestamp from our
      // consent audit. Do not turn a settings endpoint into an approval bypass.
      if(grant && !grant.selfRevoked)throw new AuthError('participation_restricted',409);
      if(grant)await client.query("UPDATE public.role_assignments SET status='active',revoked_at=NULL WHERE id=$1",[grant.id]);
      else await client.query(`INSERT INTO public.role_assignments(id,user_id,scope_type,scope_id,role,basis_type,basis_reference)
        VALUES ($1,$2,'participant',$3,'provider','user_consent','settings:individual')`,[uuid(),userId,participantId]);
      return true;
    }
    if(grant?.status!=='active')return false;
    await client.query("UPDATE public.role_assignments SET status='revoked',revoked_at=now() WHERE id=$1",[grant.id]);
    return true;
  }
}
