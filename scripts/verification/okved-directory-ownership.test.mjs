import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'
const root=fileURLToPath(new URL('../../',import.meta.url)),receiptPath='artifacts/repository-audits/proj-177-okved-directory-ownership.json'
function fixture(t){
 const path=mkdtempSync(join(tmpdir(),'forum-okved-ownership-'));t.after(()=>rmSync(path,{recursive:true,force:true}))
 const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
 for(const file of new Set(files)){mkdirSync(dirname(join(path,file)),{recursive:true});copyFileSync(join(root,file),join(path,file))}
 return path
}
function verify(path){return spawnSync('python3',['-c','import importlib.util,pathlib,sys; p=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location("checker",p/"scripts/verification/check-operational-sources.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.ROOT=p; print(m.verify_provenance())',path],{encoding:'utf8'})}
test('reviewed directory ownership keeps historical source provenance valid',t=>{const r=verify(fixture(t));assert.equal(r.status,0,r.stderr)})
for(const mutation of ['bytes','paired-hash','scope'])test(`directory ownership rejects ${mutation} tampering`,t=>{
 const path=fixture(t),receipt=JSON.parse(readFileSync(join(path,receiptPath))),source='apps/web/src/home/OkvedDirectory.tsx'
 if(mutation==='bytes'||mutation==='paired-hash'){
  const file=join(path,source);writeFileSync(file,readFileSync(file,'utf8')+'\n// unreviewed edit\n')
  if(mutation==='paired-hash')receipt.newFiles.find(x=>x.path===source).sha256=createHash('sha256').update(readFileSync(file)).digest('hex')
 }else receipt.changes.push({...receipt.changes[0],candidatePath:'package.json'})
 writeFileSync(join(path,receiptPath),JSON.stringify(receipt))
 const r=verify(path);assert.notEqual(r.status,0);assert.match(r.stderr,/PROJ-177/)
})
