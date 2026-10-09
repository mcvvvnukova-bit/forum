import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {test} from 'node:test'

const root=resolve(process.env.FORUM_WEB_SOURCE_ROOT || fileURLToPath(new URL('../../',import.meta.url)))
const require=createRequire(join(root,'package.json'))
test('real exact-source release ignores inherited development mode',()=>{
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
 const temporary=mkdtempSync(join(tmpdir(),'forum-build-inputs-'))
 try {
  const builds=['production','development'].map(mode=>{
   const output=join(temporary,mode)
   execFileSync(process.execPath,['scripts/deployment/build-web-release.mjs','dev',output,sha],{cwd:root,env:{...process.env,NODE_ENV:mode,...(mode==='development'?{BABEL_ENV:'development',VITE_FORUM_SESSION:'false',VITE_LOGIN_URL:'/unexpected',npm_config_ignore_scripts:'true'}:{})},stdio:'pipe'})
   return JSON.parse(readFileSync(join(output,'manifest.json')))
  })
  assert.equal(builds[0].configFingerprint,builds[1].configFingerprint)
  assert.equal(builds[0].artifactFingerprint,builds[1].artifactFingerprint,'Ambient NODE_ENV must not change release bytes')
  assert.deepEqual(builds[0].files,builds[1].files)
  for(const name of ['apps/profile-preview/src/ProfilePage.tsx','apps/profile-preview/src/profile.ts']){
   assert.equal(builds[0].inputs[name],createHash('sha256').update(readFileSync(join(root,name))).digest('hex'))
  }
  assert.equal(builds[0].inputs['apps/profile-preview/src/fixtures.ts'],undefined)
  for(const name of ['cabinet/index.html','cabinet/work/index.html','cabinet/settings/index.html'])assert.equal(builds[0].files[name],builds[0].files['index.html'])
 }finally{rmSync(temporary,{recursive:true,force:true})}
})
test('real Vite serve returns both public asset families byte-for-byte',async()=>{
 const {createServer}=await import(pathToFileURL(require.resolve('vite')))
 const server=await createServer({configFile:join(root,'apps/web/vite.config.ts'),server:{host:'127.0.0.1',port:0,watch:null,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]}})
 try {
  await server.listen();const {port}=server.httpServer.address()
  const observed=[]
  for(const name of ['assets/forum-logo-square.svg','audience-assets/media/audience-customer.png']){
   const response=await fetch(`http://127.0.0.1:${port}/${name}`,{headers:{Accept:'image/*'}})
   const bytes=Buffer.from(await response.arrayBuffer())
   observed.push({name,status:response.status,bytesMatch:bytes.equals(readFileSync(join(root,'apps/web/public',name)))})
  }
  assert.deepEqual(observed,[{name:'assets/forum-logo-square.svg',status:200,bytesMatch:true},{name:'audience-assets/media/audience-customer.png',status:200,bytesMatch:true}])
 }finally{await server.close()}
})

test('real builder rejects wrong source and dirty checkout before creating output',()=>{
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
 const temporary=mkdtempSync(join(tmpdir(),'forum-source-guards-'))
 const marker=join(root,`.web-release-dirty-probe-${process.pid}`)
 const run=(source,output)=>execFileSync(process.execPath,['scripts/deployment/build-web-release.mjs','dev',output,source],{cwd:root,stdio:'pipe'})
 try {
  assert.throws(()=>run('0'.repeat(40),join(temporary,'wrong')),/Source checkout mismatch/)
  assert.equal(existsSync(join(temporary,'wrong')),false)
  writeFileSync(marker,'synthetic source cleanliness probe\n',{flag:'wx'})
  assert.throws(()=>run(sha,join(temporary,'dirty')),/Build requires a clean committed source/)
  assert.equal(existsSync(join(temporary,'dirty')),false)
 }finally{rmSync(marker,{force:true});rmSync(temporary,{recursive:true,force:true})}
})
