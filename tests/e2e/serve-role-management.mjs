// Test-only fixture runner. Never import this module from an application bundle.
import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'vite'
import {Pool} from 'pg'
import {createApp} from '../../apps/api/dist/app.js'
import {migrate} from '../../apps/api/dist/migrate.js'
import {AuthStore} from '../../apps/api/dist/iam/auth-store.js'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const database='postgres://postgres@127.0.0.1:55473/astforum_roles_test'
if(process.env.TEST_DATABASE_URL!==database||process.env.TEST_DATABASE_CONTAINER!=='forum-role-model-test')throw new Error('Only the explicitly isolated role-model test database is permitted')
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='http://127.0.0.1:5191'
const pool=new Pool({connectionString:database}),store=new AuthStore(pool)
await migrate(pool)
const identities={}
for(const [name,label] of [['admin','UI Администратор'],['ordinary','UI Обычный пользователь'],['corporate','UI Администратор компании'],['employee','UI Сотрудник компании']]){
 const token=randomBytes(32).toString('base64url')
 await store.authenticate({subject:'role-ui-'+randomUUID(),alternateSubjects:[],displayName:label,email:null,emailConfirmed:false,claims:{},profile:{family_name:label}},'login',token,3600)
 identities[name]={id:(await store.session(token)).user.id,token}
}
await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason) VALUES($1,'platform','platform_admin',$1,'Synthetic UI fixture')`,[identities.admin.id])
const companies=[]
function validInn(){const digits=Array.from({length:9},()=>Math.floor(Math.random()*10));const checksum=[2,4,10,3,5,9,4,6,8].reduce((sum,w,i)=>sum+w*digits[i],0)%11%10;return digits.join('')+checksum}
for(let index=0;index<2;index++){
 const companyId=randomUUID();companies.push(companyId)
 await pool.query(`INSERT INTO public.organizations(id,legal_status,inn,legal_name,registration_state,registered_at) VALUES($1,'legal_entity',$2,$3,'registered',now())`,[companyId,validInn(),'Тестовая компания '+(index+1)])
 for(const name of ['corporate','employee']){
  if(index===1&&name==='employee')continue
  const actor=identities[name],membership=(await pool.query(`INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from) VALUES($1,$2,'active','legacy','Synthetic UI fixture',now()) RETURNING id`,[actor.id,companyId])).rows[0].id
  await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason) VALUES($1,'organization',$2,$3,$4,$1,'Synthetic UI fixture')`,[actor.id,companyId,membership,name==='corporate'?'organization_admin':'organization_employee'])
  if(name==='corporate')await pool.query(`INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,status,basis_type,basis_reference,approved_by_user_id,decided_at,effective_from,allowed_actions) VALUES($1,$2,'administrator','confirmed','trusted_adapter','Synthetic UI fixture',$1,now(),now()-interval '1 day',ARRAY[]::text[])`,[actor.id,companyId])
 }
}
const api=await createApp({publicOrigin:origin,databaseUrl:database,secureCookies:false,sessionTtlSeconds:3600},pool)
await api.listen(5192,'127.0.0.1')
let failReads=false
const vite=await createServer({root:join(root,'apps/web'),configFile:join(root,'apps/web/vite.config.ts'),define:{'import.meta.env.VITE_FORUM_SESSION':JSON.stringify('true')},plugins:[{name:'test-only-role-fixtures',configureServer(server){server.middlewares.use((req,res,next)=>{
 const url=new URL(req.url,origin)
 if(url.pathname.startsWith('/__fixture/login/')){
  const account=identities[url.pathname.split('/').at(-1)];if(!account){res.statusCode=404;res.end();return}
  res.setHeader('Set-Cookie',`forum_session=${account.token}; HttpOnly; SameSite=Lax; Path=/`);res.setHeader('Cache-Control','no-store');res.statusCode=303;res.setHeader('Location','/cabinet/roles/');res.end();return
 }
 if(url.pathname==='/__fixture/info'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({users:Object.fromEntries(Object.entries(identities).map(([name,actor])=>[name,actor.id])),companies}));return}
 if(url.pathname==='/__fixture/fail-reads'){failReads=url.searchParams.get('value')==='true';res.end('ok');return}
 if(failReads&&url.pathname==='/api/iam/platform-users'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end('{"code":"temporarily_unavailable"}');return}
 next()
})}}],server:{host:'127.0.0.1',port:5191,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5192'}}}})
await vite.listen()
console.log(JSON.stringify({fixtureOrigin:origin,apiOrigin:'http://127.0.0.1:5192',database:'astforum_roles_test',fixtureLogin:'/__fixture/login/admin',companies}))
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await vite.close();await api.close();await pool.end();process.exit(0)})
