import type {Pool,PoolClient} from 'pg';
import {AuthError} from '../iam/auth-error.js';
export type OrganizationRole='organization_admin'|'organization_signer'|'organization_employee';
export type OrganizationMember={userId:string;fullName:string;roles:OrganizationRole[]};
export type MyOrganization={id:string;inn:string;name:string|null;status:'pending'|'active';members:OrganizationMember[]};
type CardRow={id:string;inn:string;name:string|null;active:boolean};
const newerColumns:Record<string,string[]>={
 organization_memberships:['user_id','organization_id','status','effective_from','effective_until','revoked_at'],
 organization_authorities:['user_id','organization_id','authority_type','status','effective_from','effective_until','revoked_at'],
 organizations:['registration_state','status']
};
async function newerSchema(client:PoolClient):Promise<boolean>{
 const result=await client.query(`SELECT table_name,column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name=ANY($1::text[])`,[Object.keys(newerColumns)]);
 const columns=new Set(result.rows.map(r=>`${r.table_name}.${r.column_name}`));
 const contract=(await client.query("SELECT to_regprocedure('public.effective_business_access(uuid,uuid,text,boolean)') IS NOT NULL AS present, EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.proname='effective_business_access') AS any_function, to_regclass('public.organization_memberships') IS NOT NULL OR to_regclass('public.organization_authorities') IS NOT NULL AS tables")).rows[0];
 const functionPresent=contract.present;
 const any=contract.tables||contract.any_function||functionPresent||columns.has('organization_memberships.user_id')||columns.has('organization_authorities.user_id')||columns.has('organizations.registration_state')||columns.has('organizations.status');
 if(!any)return false;
 if(!functionPresent||Object.entries(newerColumns).some(([table,names])=>names.some(name=>!columns.has(`${table}.${name}`))))throw new AuthError('temporarily_unavailable',503);
 return true;
}
function effectivePredicate(newer:boolean,alias='m',participant='p'){
 return `${alias}.status='active' AND u.status='active' AND ${participant}.status='active'
 AND EXISTS(SELECT 1 FROM public.role_assignments access WHERE access.user_id=${alias}.user_id AND access.scope_type='participant' AND access.scope_id=${participant}.id AND access.role=${participant}.role)
 ${newer?`AND public.effective_business_access(${alias}.user_id,${participant}.id,${participant}.role,false)` : ''}`;
}
export class OrganizationStore {
 constructor(private readonly pool:Pool){}
 async add(userId:string,inn:string){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await newerSchema(client); // Partial newer deployments fail closed, never fall back.
   const inserted=await client.query(`INSERT INTO public.organization_additions(user_id,inn) VALUES($1,$2)
    ON CONFLICT(user_id,inn) DO NOTHING RETURNING id`,[userId,inn]);
   if(inserted.rowCount)await client.query(`INSERT INTO public.audit_events(id,actor_user_id,action,data)
    VALUES(gen_random_uuid(),$1,'OrganizationAdded',jsonb_build_object('additionId',$2::text))`,[userId,inserted.rows[0].id]);
   const card=(await client.query(`SELECT a.id,a.inn,o.legal_name AS name FROM public.organization_additions a
    LEFT JOIN public.organizations o ON o.inn=a.inn WHERE a.user_id=$1 AND a.inn=$2`,[userId,inn])).rows[0];
   await client.query('COMMIT');
   return {created:Boolean(inserted.rowCount),item:{...card,status:'pending' as const,members:[]} as MyOrganization};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 async list(userId:string,cursor?:string){
  let after='';
  if(cursor){
   try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(value.userId!==userId||typeof value.inn!=='string'||!/^([0-9]{10}|[0-9]{12})$/.test(value.inn)||Buffer.from(JSON.stringify(value)).toString('base64url')!==cursor)throw new Error();after=value.inn;
   }catch{throw new AuthError('invalid_request')}
  }
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const newer=await newerSchema(client);
   const effective=effectivePredicate(newer);
   const rows=(await client.query<CardRow>(`WITH own AS(
    SELECT DISTINCT o.id,o.inn,o.legal_name AS name,true AS active FROM public.organizations o
    JOIN public.participants p ON p.organization_id=o.id JOIN public.participant_memberships m ON m.participant_id=p.id
    JOIN public.users u ON u.id=m.user_id WHERE m.user_id=$1 AND ${effective}
   ), cards AS(
    SELECT * FROM own UNION ALL SELECT a.id,a.inn,o.legal_name AS name,false AS active
    FROM public.organization_additions a LEFT JOIN public.organizations o ON o.inn=a.inn
    WHERE a.user_id=$1 AND NOT EXISTS(SELECT 1 FROM own WHERE own.inn=a.inn)
   ) SELECT id,inn,name,active FROM cards WHERE inn>$2 ORDER BY inn LIMIT 51`,[userId,after])).rows;
   const page=rows.slice(0,50),activeIds=page.filter(r=>r.active).map(r=>r.id);
   const members=new Map<string,OrganizationMember[]>();
   if(activeIds.length){
    const result=await client.query(`SELECT p.organization_id,u.id AS user_id,
     coalesce(nullif(btrim(concat_ws(' ',person.family_name,person.given_name,person.middle_name)),''),u.display_name) AS full_name,
     bool_or(EXISTS(SELECT 1 FROM public.role_assignments r WHERE r.user_id=m.user_id AND r.scope_type='participant'
       AND r.scope_id=p.id AND r.role='organization_admin') ${newer?`AND public.effective_business_access(m.user_id,p.id,'organization_admin',false)
       AND EXISTS(SELECT 1 FROM public.organization_authorities a WHERE a.user_id=m.user_id AND a.organization_id=p.organization_id
       AND a.authority_type='administrator' AND a.status='confirmed' AND a.revoked_at IS NULL AND a.effective_from<=now() AND (a.effective_until IS NULL OR a.effective_until>now()))`:''}) AS admin
     FROM public.participants p JOIN public.participant_memberships m ON m.participant_id=p.id JOIN public.users u ON u.id=m.user_id
     LEFT JOIN public.persons person ON person.user_id=u.id WHERE p.organization_id=ANY($1::uuid[]) AND ${effective}
     GROUP BY p.organization_id,u.id,person.family_name,person.given_name,person.middle_name,u.display_name ORDER BY full_name,u.id`,[activeIds]);
    for(const row of result.rows){const entries=members.get(row.organization_id)??[];
     // Legacy accepted membership is employee status; admin inheritance is not a second assigned role.
     entries.push({userId:row.user_id,fullName:row.full_name,roles:row.admin?['organization_admin']:['organization_employee']});members.set(row.organization_id,entries)}
   }
   await client.query('COMMIT');
   return {userId,items:page.map(r=>({id:r.id,inn:r.inn,name:r.name,status:r.active?'active':'pending',members:r.active?(members.get(r.id)??[]):[]})),
    nextCursor:rows.length>50?Buffer.from(JSON.stringify({userId,inn:page[49].inn})).toString('base64url'):null};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
}
