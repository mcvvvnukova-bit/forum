import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {loadConfig} from './config.js';
import {AuthError} from './iam/auth-error.js';
import {auditIam,bumpAccess,lockIamScope} from './iam/role-mutations.js';
import {assertIamReady,assignmentColumns,type PlatformAssignment} from './iam/role-store.js';
import {reasonValue,uuidValue} from './iam/role-request.js';

function normalizePhone(value:string):string{
 if(typeof value!=='string'||value.length>40||!/^[+\d ()-]+$/.test(value))throw new AuthError('invalid_request');
 const digits=value.replace(/\D/g,'');
 if(!/^[78]\d{10}$/.test(digits))throw new AuthError('invalid_request');return '+7'+digits.slice(1);
}
export async function bootstrapPlatformAdmin(pool:Pool,input:{phone:string;expectedUserId:string;reason:string}):Promise<PlatformAssignment>{
 const phone=normalizePhone(input.phone),expectedUserId=uuidValue(input.expectedUserId),reason=reasonValue(input.reason);
 const client=await pool.connect();try{
  await client.query('BEGIN');await lockIamScope(client);await assertIamReady(client);
  const matches=await client.query(`SELECT u.id FROM public.users u JOIN public.persons p ON p.user_id=u.id
   WHERE u.status='active' AND '+7'||substring(regexp_replace(p.phone_number,'[^0-9]','','g') FROM 2)=$1
    AND regexp_replace(p.phone_number,'[^0-9]','','g') ~ '^[78][0-9]{10}$'
    AND EXISTS(SELECT 1 FROM public.external_identities e JOIN public.identity_profiles i ON i.identity_id=e.id AND i.user_id=e.user_id
     WHERE e.user_id=u.id AND e.provider='sber_id' AND i.identified_at IS NOT NULL)
   ORDER BY u.id FOR UPDATE OF u,p`,[phone]);
  if(matches.rowCount!==1||matches.rows[0].id!==expectedUserId)throw new AuthError('bootstrap_identity_mismatch',409);
  // Any different active assignment blocks recovery through this initial bootstrap path.
  if((await client.query(`SELECT 1 FROM public.iam_role_assignments WHERE scope_type='platform' AND role_code='platform_admin'
   AND user_id<>$1 LIMIT 1`,[expectedUserId])).rowCount)throw new AuthError('bootstrap_already_initialized',409);
  const existing=(await client.query<PlatformAssignment>(`SELECT ${assignmentColumns} FROM public.iam_role_assignments
   WHERE user_id=$1 AND scope_type='platform' AND role_code='platform_admin'`,[expectedUserId])).rows[0];
  if(existing){
   if(existing.status!=='active')throw new AuthError('bootstrap_already_initialized',409);
   await client.query('COMMIT');return existing;
  }
  const assignment=(await client.query<PlatformAssignment>(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason)
   VALUES($1,'platform','platform_admin',$1,$2) RETURNING ${assignmentColumns}`,[expectedUserId,reason])).rows[0];
  await bumpAccess(client,expectedUserId);
  await auditIam(client,expectedUserId,'IAMPlatformAdminBootstrapped',{assignmentId:assignment.id,targetUserId:expectedUserId,roleCode:'platform_admin',reason});
  await client.query('COMMIT');return assignment;
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let pool:Pool|undefined;
 try{
  const args=process.argv.slice(2);const values=new Map<string,string>();
  if(args.length!==6)throw new AuthError('invalid_request');
  for(let i=0;i<args.length;i+=2){if(!['--phone','--user-id','--reason'].includes(args[i])||values.has(args[i]))throw new AuthError('invalid_request');values.set(args[i],args[i+1])}
  const config=loadConfig({...process.env,SBER_ID_ENABLED:'false'});if(!config.databaseUrl)throw new AuthError('database_unavailable',503);
  pool=new Pool({connectionString:config.databaseUrl});
  const role=await bootstrapPlatformAdmin(pool,{phone:values.get('--phone')!,expectedUserId:values.get('--user-id')!,reason:values.get('--reason')!});
  console.log(JSON.stringify({status:'ok',userId:role.userId,assignmentId:role.id}));
 }catch(error){console.error(JSON.stringify({status:'failed',code:error instanceof AuthError?error.code:'temporarily_unavailable'}));process.exitCode=1}
 finally{await pool?.end()}
}
