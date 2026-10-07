import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {resolve, relative, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import Ajv from 'ajv/dist/2020.js'

const root=fileURLToPath(new URL('../../',import.meta.url))
const [environment, outputArgument, expectedSha]=process.argv.slice(2)
assert(['dev','production'].includes(environment), 'Usage: node scripts/deployment/build-web-release.mjs dev|production OUT EXACT_SHA')
assert(/^[a-f0-9]{40}$/.test(expectedSha), 'Exact committed source SHA required')
const output=resolve(outputArgument)
assert(!existsSync(output), 'Output must be new')
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
assert.equal(git('rev-parse','HEAD'),expectedSha,'Source checkout mismatch')
assert.equal(git('status','--porcelain','--untracked-files=all'),'','Build requires a clean committed source')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const inventory=directory=>{
 const result={}
 const walk=path=>{for(const name of readdirSync(path).sort()){
  const file=resolve(path,name);const stat=lstatSync(file)
  assert(!stat.isSymbolicLink(),'Symlink in artifact')
  if(stat.isDirectory())walk(file)
  else result[relative(directory,file).replaceAll('\\','/')]=sha(readFileSync(file))
 }}
 walk(directory);return result
}
const fingerprint=items=>sha(JSON.stringify(items))
const config=JSON.parse(readFileSync(resolve(root,'deployment/web/build-config.json')))[environment]
// Only launcher/filesystem context is inherited. Build semantics come from fixed
// values and the tracked VITE_* map; ambient NODE_ENV/NODE_OPTIONS/npm_config_*
// cannot silently select different emitted code or npm lifecycle behavior.
const inheritedKeys=['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','COMSPEC','PATHEXT']
const buildEnv={
 ...Object.fromEntries(inheritedKeys.filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])),
 NODE_ENV:'production', TZ:'UTC', LANG:'C', LC_ALL:'C',
 npm_config_userconfig:resolve(root,'deployment/web/build-user.npmrc'),
 npm_config_globalconfig:resolve(root,'deployment/web/build-global.npmrc'),
 ...config,
}
const owned=git('ls-files','-z','apps/web','packages/public-navigation.ts','package.json','package-lock.json','deployment/web','deployment/release-manifest.schema.json','scripts/deployment/build-web-release.mjs').split('\0').filter(Boolean).sort()
const inputs=Object.fromEntries(owned.map(name=>[name,sha(readFileSync(resolve(root,name)))]))
// Fingerprint installed payloads, including native build tools. Exclude only npm's
// mutable lock receipt, root-level tool caches and executable symlinks; resolve package symlink workspaces
// through the explicit source inputs above, never dump dependencies in artifacts.
const dependencyHashes={}
function dependencies(directory){
 for(const name of readdirSync(directory).sort()){
  if(directory.endsWith('node_modules') && name.startsWith('.')) continue
  const file=resolve(directory,name);const stat=lstatSync(file)
  if(stat.isSymbolicLink()) continue
  if(stat.isDirectory()) dependencies(file)
  else if(name!=='.package-lock.json') dependencyHashes[relative(root,file)]=sha(readFileSync(file))
 }
}
dependencies(resolve(root,'node_modules'))
for (const workspace of JSON.parse(readFileSync(resolve(root,'package.json'))).workspaces) {
 const directory=resolve(root,workspace,'node_modules');if(existsSync(directory)) dependencies(directory)
}
const dependencyFingerprint=fingerprint(dependencyHashes)
mkdirSync(output,{recursive:true})
const site=resolve(output,'site')
if(environment==='dev'){
 execFileSync('npm',['run','build','--workspace','@astforum/web'],{cwd:root,env:buildEnv,stdio:'inherit'})
 cpSync(resolve(root,'apps/web/dist'),site,{recursive:true})
 for(const route of ['customers','suppliers','work','participate','login','register']){
  mkdirSync(resolve(site,route),{recursive:true});cpSync(resolve(site,'index.html'),resolve(site,route,'index.html'))
 }
}else cpSync(resolve(root,'apps/web/production-static'),site,{recursive:true})
const files=inventory(site)
for(const name of Object.keys(files)) assert(/^(?:index\.html|(?:customers|suppliers|work|participate|login|register)\/index\.html|(?:web-assets|web-media|fonts)\/[a-zA-Z0-9_./-]+\.(?:js|css|png|svg|webp|jpg|woff2)|favicon\.png|forum-hard-hat\.png)$/.test(name),'Unexpected artifact file: '+name)
assert.equal(git('status','--porcelain','--untracked-files=all'),'','Build modified committed source')
const manifest={schemaVersion:2,recordKind:'build',reconciliationStatus:'build-only',environment,sourceSha:expectedSha,sourceTree:git('rev-parse','HEAD^{tree}'),sourceFingerprint:fingerprint(inputs),inputs,config,configFingerprint:fingerprint(config),lockFingerprint:sha(readFileSync(resolve(root,'package-lock.json'))),installedDependencyFingerprint:dependencyFingerprint,toolchain:{node:process.version,npm:execFileSync('npm',['--version'],{cwd:root,env:buildEnv,encoding:'utf8'}).trim(),vite:JSON.parse(readFileSync(resolve(root,'node_modules/vite/package.json'))).version},buildMode:environment==='dev'?'vite':'static-copy',files,artifactFingerprint:fingerprint(files),routes:environment==='dev'?['/','/customers/','/suppliers/','/work/','/participate/','/login','/register']:['/']}
const schema=JSON.parse(readFileSync(resolve(root,'deployment/release-manifest.schema.json')))
const validate=new Ajv({strict:false,validateFormats:false}).compile(schema)
assert(validate(manifest),JSON.stringify(validate.errors))
writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({environment,sourceSha:expectedSha,artifactFingerprint:manifest.artifactFingerprint,files:Object.keys(files).length,output}))
