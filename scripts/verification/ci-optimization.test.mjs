import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const jobs = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database', 'profile', 'operational', 'web-release']
const full = {layout:true, api:true, frontend:true, composition:true, publishers:true, database:true, profile:true, operational:true, 'web-release':true}
const layoutOnly = {layout:true, api:false, frontend:false, composition:false, publishers:false, database:false, profile:false, operational:false, 'web-release':false}
const outcomes = selection => ({changes:{result:'success', outputs:{selection:JSON.stringify(selection)}}, ...Object.fromEntries(jobs.map(job => [job, {result:selection[job] ? 'success' : 'skipped'}]))})
const gate = results => spawnSync(process.execPath, [join(root, 'scripts/verification/quality-gate.mjs')], {env:{...process.env, QUALITY_RESULTS:JSON.stringify(results)}, encoding:'utf8'})

test('component changes select their checks and actual integration consumers', async () => {
  const {selectJobs} = await import('./ci-selection.mjs')
  const cases = [
    [['docs/plans/change.md'], []],
    [['apps/profile-preview/src/profile.ts'], ['profile']],
    [['apps/web/src/home/App.tsx'], ['frontend','composition','publishers','web-release']],
    [['apps/legacy-landing/src/main.tsx'], ['api','frontend','composition','publishers','web-release']],
    [['apps/api/src/iam/auth.controller.ts'], ['api','frontend','composition','database','web-release']],
    [['deployment/forum-db/tests/test_role.py'], ['api','database']],
    [['deployment/mail/templates/email.html'], ['operational']],
    [['apps/profile-preview/src/profile.ts','apps/web/src/home/App.tsx'], ['frontend','composition','publishers','profile','web-release']],
  ]
  for (const [files, expected] of cases) {
    assert.deepEqual(selectJobs({eventName:'pull_request', files, baseAvailable:true}), {...layoutOnly, ...Object.fromEntries(expected.map(job => [job,true]))})
  }
  for (const files of [['package-lock.json'], ['packages/public-navigation.ts'], ['new-component/file.ts'], ['.github/workflows/quality.yml']]) assert.deepEqual(selectJobs({eventName:'pull_request', files, baseAvailable:true}), full)
  for (const eventName of ['push','workflow_dispatch']) assert.deepEqual(selectJobs({eventName, files:['docs/plans/change.md'], baseAvailable:true}), full)
  assert.deepEqual(selectJobs({eventName:'pull_request', files:[], baseAvailable:false}), full)
})

test('change selector uses real Git history, both rename paths, and fails closed on missing history', () => {
  const path = mkdtempSync(join(tmpdir(),'forum-ci-git-'))
  try {
    const git = (...args) => execFileSync('git', args, {cwd:path,encoding:'utf8'}).trim()
    git('init','-q'); git('config','user.email','tests@example.invalid'); git('config','user.name','CI tests')
    mkdirSync(join(path,'apps/profile-preview'),{recursive:true})
    writeFileSync(join(path,'apps/profile-preview/example.ts'),'tracked\n')
    git('add','.'); git('commit','-qm','base'); const base = git('rev-parse','HEAD')
    mkdirSync(join(path,'docs/plans'),{recursive:true})
    git('mv','apps/profile-preview/example.ts','docs/plans/renamed.md')
    writeFileSync(join(path,'docs/plans/name\nwith newline.md'),'another\n')
    git('add','.'); git('commit','-qm','rename'); const head = git('rev-parse','HEAD')
    const eventPath = join(path,'event.json'); const output = join(path,'output.txt')
    const invoke = sha => {
      writeFileSync(eventPath,JSON.stringify({pull_request:{base:{sha},head:{sha:head}}}))
      writeFileSync(output,'')
      const result = spawnSync(process.execPath,[join(root,'scripts/verification/ci-selection.mjs')],{cwd:path,env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output},encoding:'utf8'})
      assert.equal(result.status,0,result.stderr)
      return JSON.parse(readFileSync(output,'utf8').trim().slice('selection='.length))
    }
    assert.deepEqual(invoke(base),{...layoutOnly,profile:true})
    assert.deepEqual(invoke('0'.repeat(40)),full)
  } finally {rmSync(path,{recursive:true,force:true})}
})

test('quality accepts explicitly unselected jobs and rejects actual failed checks', () => {
  assert.equal(gate(outcomes(layoutOnly)).status, 0)
  assert.equal(gate(outcomes(full)).status, 0)
  for (const result of ['failure', 'cancelled']) {
    for (const job of jobs) assert.notEqual(gate({...outcomes(layoutOnly), [job]:{result}}).status, 0)
  }
  assert.notEqual(gate({...outcomes(full), api:{result:'skipped'}}).status, 0)
})

test('quality rejects missing, malformed or unsuccessful selection', () => {
  for (const selection of [{}, {...full, layout:false}, {...full, api:'true'}, {...full, extra:false}]) assert.notEqual(gate(outcomes(selection)).status, 0)
  for (const result of ['failure', 'cancelled', 'skipped']) assert.notEqual(gate({...outcomes(full), changes:{result, outputs:{selection:JSON.stringify(full)}}}).status, 0)
  const missing = outcomes(full); delete missing.api
  assert.notEqual(gate(missing).status, 0)
  const noChanges = outcomes(full); delete noChanges.changes
  assert.notEqual(gate(noChanges).status, 0)
  assert.notEqual(gate({...outcomes(full), changes:{result:'success', outputs:{selection:'invalid'}}}).status, 0)
})

test('one provenance verification reads each ownership receipt at most twice', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util,pathlib,collections
p=pathlib.Path('scripts/verification/check-operational-sources.py').resolve()
s=importlib.util.spec_from_file_location('checker',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
counts=collections.Counter(); original=pathlib.Path.read_text
def counted(path,*args,**kwargs):
    if path.name in ['task-7-source-ownership.json','proj-154-verification-ownership.json']:
        counts[path.name]+=1
    return original(path,*args,**kwargs)
pathlib.Path.read_text=counted
m.verify_provenance()
assert counts and max(counts.values())<=2,dict(counts)
`,], {cwd:root, encoding:'utf8'})
  assert.equal(result.status, 0, result.stderr)
})

function fixture(t) {
  const path = mkdtempSync(join(tmpdir(),'forum-ci-provenance-'))
  t.after(() => rmSync(path,{recursive:true,force:true}))
  const files = execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
  for (const file of new Set([...files,'scripts/verification/ci-selection.mjs','scripts/verification/ci-optimization.test.mjs','artifacts/repository-audits/proj-164-ci-ownership.json','artifacts/repository-audits/proj-160-main-integration-ownership.json'])) {
    mkdirSync(dirname(join(path,file)),{recursive:true}); copyFileSync(join(root,file),join(path,file))
  }
  return path
}
const provenance = path => spawnSync('python3',['-c',`import importlib.util,pathlib,sys
p=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('checker',p/'scripts/verification/check-operational-sources.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.verify_provenance()`,path],{encoding:'utf8'})

for (const mutation of ['parent','predecessor','hash','scope','mode','duplicate','source']) {
  test(`main integration rejects ${mutation} tampering`, t => {
    const path = fixture(t), file = join(path,'artifacts/repository-audits/proj-160-main-integration-ownership.json')
    const receipt = JSON.parse(readFileSync(file,'utf8'))
    if (mutation === 'parent') receipt.parents[0] = '0'.repeat(40)
    if (mutation === 'predecessor') receipt.changes[0].predecessorSha256[0] = '0'.repeat(64)
    if (mutation === 'hash') receipt.changes[0].candidateSha256 = '0'.repeat(64)
    if (mutation === 'scope') receipt.changes[0].candidatePath = '../package.json'
    if (mutation === 'mode') receipt.changes[0].candidateMode = '100755'
    if (mutation === 'duplicate') receipt.changes.push(receipt.changes[0])
    if (mutation === 'source') appendFileSync(join(path,receipt.changes[0].candidatePath),'\n# drift\n')
    writeFileSync(file,JSON.stringify(receipt))
    const result = provenance(path)
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/PROJ-160 integration/)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','source']) {
  test(`CI ownership rejects ${mutation} tampering`, t => {
    const path = fixture(t), file = join(path,'artifacts/repository-audits/proj-164-ci-ownership.json')
    const receipt = JSON.parse(readFileSync(file,'utf8'))
    if (mutation === 'hash') receipt.changes[0].candidateSha256 = '0'.repeat(64)
    if (mutation === 'pin') receipt.changes[0].previousSha256 = '0'.repeat(64)
    if (mutation === 'scope') receipt.changes[0].previousCandidatePath = 'apps/api/src/main.ts'
    if (mutation === 'mode') receipt.changes[0].candidateMode = '100755'
    if (mutation === 'path') receipt.changes[0].candidatePath = '../package.json'
    if (mutation === 'duplicate') receipt.changes.push(receipt.changes[0])
    if (mutation === 'source') receipt.newFiles[0].sha256 = '0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    const result = provenance(path)
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/PROJ-164/)
  })
}

test('provenance clears cached receipts between calls, roots and failed checks', t => {
  const first = fixture(t), second = fixture(t)
  const result = spawnSync('python3',['-c',`
import importlib.util,pathlib,sys,json
p=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('checker',p/'scripts/verification/check-operational-sources.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.verify_provenance();m.ROOT=pathlib.Path(sys.argv[2]);m.verify_provenance()
file=m.ROOT/'artifacts/repository-audits/proj-154-verification-ownership.json'
original=file.read_text();receipt=json.loads(original);receipt['changes'][0]['candidateSha256']='0'*64;file.write_text(json.dumps(receipt))
try:m.verify_provenance()
except AssertionError:pass
else:raise AssertionError('Changed receipt was cached across verifications')
file.write_text(original);m.verify_provenance()
source=m.ROOT/'scripts/verification/ci-selection.mjs';source.write_text(source.read_text()+'\\n// unexpected drift\\n')
try:m.verify_provenance()
except AssertionError:pass
else:raise AssertionError('Changed source was accepted')
`,first,second],{encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
})
