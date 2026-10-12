import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve('../..');
const verify=(path:string)=>spawnSync('python3',['-c',
  "import importlib.util,pathlib,sys; p=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location('v',p/'scripts/verification/check-operational-sources.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.verify_provenance()",path],{encoding:'utf8'});

for(const mutation of ['scope','paired_dependency_repin','new_source']) {
  test(`OKVED integration ownership rejects ${mutation}`,t=>{
    const path=mkdtempSync(join(tmpdir(),'forum-okved-ownership-'));t.after(()=>rmSync(path,{recursive:true,force:true}));
    for(const file of execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)) {
      cpSync(join(root,file),join(path,file),{recursive:true});
    }
    const receiptPath=join(path,'artifacts/repository-audits/proj-172-okved-fns-ownership.json');
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    if(mutation==='scope')receipt.changes[0].candidatePath='apps/api/src/main.ts';
    if(mutation==='paired_dependency_repin') {
      const item=receipt.changes.find((x:{candidatePath:string})=>x.candidatePath==='package-lock.json');
      const file=join(path,item.candidatePath);writeFileSync(file,readFileSync(file,'utf8')+'\n');
      item.candidateSha256=createHash('sha256').update(readFileSync(file)).digest('hex');
    }
    if(mutation==='new_source') {
      const file=join(path,'apps/api/src/references/okved-model.ts');writeFileSync(file,readFileSync(file,'utf8')+'\n// unexpected\n');
    }
    writeFileSync(receiptPath,JSON.stringify(receipt));
    const result=verify(path);assert.notEqual(result.status,0);assert.match(result.stderr,/PROJ-172/);
  });
}
