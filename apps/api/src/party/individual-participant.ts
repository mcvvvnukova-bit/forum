import type {PoolClient} from 'pg';
import {v7 as uuid} from 'uuid';

export async function createIndividualParticipant(client: PoolClient, userId: string): Promise<string> {
  const id = uuid();
  await client.query(`INSERT INTO party.participants(id, kind, role, legal_status, individual_user_id)
    VALUES ($1, 'individual', 'provider', 'individual_person', $2)`, [id, userId]);
  return id;
}

export async function findIndividualParticipant(client: PoolClient, userId: string) {
  const result = await client.query(`SELECT id, status, legal_status AS "legalStatus", role
    FROM party.participants WHERE individual_user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}
