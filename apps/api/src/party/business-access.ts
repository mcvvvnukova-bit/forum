import type {Pool} from 'pg';
export type BusinessRole = 'provider' | 'customer' | 'organization_admin';
/** Internal authorization boundary. Recheck for every business operation;
 * account/session roles are not business grants. No approval endpoints exist. */
export class BusinessAccess {
  constructor(private readonly pool: Pool) {}
  async allows(userId:string,participantId:string,role:BusinessRole,writeAccess=true):Promise<boolean> {
    const result=await this.pool.query<{allowed:boolean}>(
      'SELECT public.effective_business_access($1,$2,$3,$4) AS allowed',[userId,participantId,role,writeAccess]);
    return result.rows[0]?.allowed === true;
  }
}
