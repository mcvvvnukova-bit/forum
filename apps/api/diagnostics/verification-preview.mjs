// Local, synthetic preview only. Never imported by the production application.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createServer} from 'vite';
import {createApp} from '../.test-build/src/app.js';
import {AuthStore} from '../.test-build/src/iam/auth-store.js';
import {migrate} from '../.test-build/src/migrate.js';
import {OrganizationStore} from '../.test-build/src/organizations/organization-store.js';
import {DiadocClient} from '../.test-build/src/organizations/diadoc-client.js';
import {testDatabaseUrl} from '../.test-build/test/test-database.js';
import {startDiadocSimulator,simulatorInn} from '../.test-build/test/fixtures/diadoc-simulator.js';

if(process.env.NODE_ENV==='production')throw new Error('Preview is local-only');
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const database=process.env.TEST_DATABASE_URL??(process.env.TEST_DATABASE_CONFIG_FILE?JSON.parse(await readFile(process.env.TEST_DATABASE_CONFIG_FILE,'utf8')).url:undefined);
const pool=new Pool({connectionString:testDatabaseUrl(database)});await migrate(pool);
const simulator=await startDiadocSimulator();
const transport=(input,options)=>{const url=new URL(String(input));return fetch(simulator.url+url.pathname+url.search,options)};
const client=new DiadocClient('staging','synthetic-token',transport);
const origin='http://127.0.0.1:4185',auth=new AuthStore(pool),users=new Map();
for(const name of ['alice','bob']){
 const token=randomBytes(32).toString('base64url');
 await auth.authenticate({subject:'verification-preview-'+name,alternateSubjects:[],displayName:name==='alice'?'Тестовая Алиса':'Тестовый Борис',email:null,emailConfirmed:false,claims:{}},'register',token,86400);
 users.set(name,{token,id:(await auth.session(token)).user.id});
}
await new OrganizationStore(pool).add(users.get('alice').id,simulatorInn);
const app=await createApp({publicOrigin:origin,databaseUrl:'',secureCookies:false,sessionTtlSeconds:86400,organizationVerificationEnabled:true},pool,
 async(_userId,inn,method)=>method==='kep'?{status:'signature_required',source:'unconfigured',reason:'not_connected'}:{...await client.verify(inn),source:'simulation'});
await app.listen(4186,'127.0.0.1');
const web=await createServer({configFile:fileURLToPath(new URL('../../web/vite.config.ts',import.meta.url)),server:{host:'127.0.0.1',port:4185,strictPort:true,proxy:{'/api':'http://127.0.0.1:4186'}},plugins:[{
 name:'verification-preview-session',configureServer(server){server.middlewares.use('/__preview/login',(req,res)=>{
  const url=new URL(req.url,origin),name=url.searchParams.get('user')??'alice',user=users.get(name);
  if(!user){res.writeHead(400).end('Unknown synthetic user');return}
  try{simulator.setScenario(url.searchParams.get('scenario')??'ok')}catch{res.writeHead(400).end('Unknown synthetic scenario');return}
  res.writeHead(303,{'Set-Cookie':`forum_session=${user.token}; Path=/; HttpOnly; SameSite=Strict`,'Location':'/cabinet/organizations/','Cache-Control':'no-store'}).end();
 })}
}]});
await web.listen();console.log('Synthetic verification preview: '+origin+'/__preview/login');
async function close(){await web.close();await app.close();await simulator.close();await pool.end();process.exit(0)}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
