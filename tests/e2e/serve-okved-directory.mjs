// Local acceptance fixture only. This file is never imported by application code.
import {randomBytes,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {createServer} from 'vite'
import {Pool} from 'pg'
import {createApp} from '../../apps/api/dist/app.js'
import {migrate} from '../../apps/api/dist/migrate.js'
import {AuthStore} from '../../apps/api/dist/iam/auth-store.js'
const database='postgres://postgres:quality-tests-only@127.0.0.1:55477/forum_okved_preview_test'
if(process.env.TEST_DATABASE_URL!==database||process.env.TEST_DATABASE_CONTAINER!=='forum-okved-view-test')throw new Error('Use only the dedicated local OKVED preview database')
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='http://127.0.0.1:5195',pool=new Pool({connectionString:database})
process.chdir(join(root,'apps/api'))
await migrate(pool)
await pool.query('CREATE TABLE IF NOT EXISTS public.okveds(okved varchar(8) PRIMARY KEY,level smallint NOT NULL,section char(1) NOT NULL,name text NOT NULL,is_active boolean NOT NULL DEFAULT true)')
if(process.env.OKVED_PREVIEW_DATA){
 const data=JSON.parse(await readFile(process.env.OKVED_PREVIEW_DATA,'utf8'))
 if(!Array.isArray(data)||data.length>20000||data.some(row=>!row||typeof row.okved!=='string'||!/^[0-9.]{2,8}$/.test(row.okved)||typeof row.name!=='string'||!row.name||!Number.isInteger(row.level)||typeof row.section!=='string'||!/^[A-U]$/.test(row.section)))throw new Error('Invalid local acceptance snapshot')
 await pool.query(`INSERT INTO public.okveds(okved,name,level,section) SELECT okved,name,level,section FROM jsonb_to_recordset($1::jsonb) AS x(okved varchar(8),name text,level smallint,section char(1)) ON CONFLICT(okved) DO UPDATE SET name=excluded.name`,[JSON.stringify(data)])
}
const store=new AuthStore(pool),identities={}
for(const name of ['admin','ordinary']){
 const token=randomBytes(32).toString('base64url')
 await store.authenticate({subject:'okved-ui-'+randomUUID(),alternateSubjects:[],displayName:name==='admin'?'Тестовый администратор':'Тестовый пользователь',email:null,emailConfirmed:false,claims:{},profile:{}},'login',token,3600)
 identities[name]={token,id:(await store.session(token)).user.id}
}
await pool.query(`INSERT INTO public.iam_role_assignments(user_id,scope_type,role_code,created_by_user_id,reason) VALUES($1,'platform','platform_admin',$1,'Local acceptance fixture')`,[identities.admin.id])
const api=await createApp({publicOrigin:origin,databaseUrl:database,secureCookies:false,sessionTtlSeconds:3600},pool)
await api.listen(5196,'127.0.0.1')
const vite=await createServer({root:join(root,'apps/web'),cacheDir:join(root,'node_modules/.vite-okved-preview'),optimizeDeps:{force:true},configFile:join(root,'apps/web/vite.config.ts'),define:{'import.meta.env.VITE_FORUM_SESSION':JSON.stringify('true')},plugins:[{name:'test-only-okved-login',configureServer(server){server.middlewares.use((req,res,next)=>{
 const url=new URL(req.url,origin)
 if(url.pathname.startsWith('/__fixture/login/')){
  const account=identities[url.pathname.split('/').at(-1)]
  if(!account){res.statusCode=404;res.end();return}
  res.setHeader('Set-Cookie',`forum_session=${account.token}; HttpOnly; SameSite=Lax; Path=/`);res.setHeader('Cache-Control','no-store');res.statusCode=303;res.setHeader('Location','/cabinet/references/okved/');res.end();return
 }
 next()
})}}],server:{host:'127.0.0.1',port:5195,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5196'}}}})
await vite.listen()
console.log(JSON.stringify({fixtureOrigin:origin,fixtureLogin:'/__fixture/login/admin',dataSource:process.env.OKVED_PREVIEW_DATA?'Local copied snapshot':'Local database',syntheticSession:true}))
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await vite.close();await api.close();await pool.end();process.exit(0)})
