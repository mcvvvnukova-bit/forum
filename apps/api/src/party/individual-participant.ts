import type {PoolClient} from 'pg';
import {v7 as uuid} from 'uuid';

export async function createIndividualParticipant(client: PoolClient, userId: string): Promise<string> {
  const id = uuid();
  await client.query(`INSERT INTO public.participants(id, kind, role, legal_status, individual_user_id)
    VALUES ($1, 'individual', 'provider', 'individual_person', $2)`, [id, userId]);
  return id;
}

export async function findIndividualParticipant(client: PoolClient, userId: string) {
  const result = await client.query(`SELECT id, status, legal_status AS "legalStatus", role
    FROM public.participants p WHERE individual_user_id = $1
      AND EXISTS (SELECT 1 FROM public.participant_memberships m
        WHERE m.participant_id=p.id AND m.user_id=$1 AND m.status='active')`, [userId]);
  return result.rows[0] ?? null;
}
