import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync, spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const checker = join(root, 'scripts/verification/check-repository-layout.mjs')
const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean)
// Copy actual tracked source, never a hand-written mirror of the manifest.
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'forum-layout-test-'))
  t.after(() => rmSync(path, {recursive: true, force: true}))
  for (const file of new Set([...files, 'scripts/verification/repository-layout.json'])) {
    mkdirSync(dirname(join(path, file)), {recursive: true})
    copyFileSync(join(root, file), join(path, file))
  }
  execFileSync('git', ['init', '-q'], {cwd: path})
  execFileSync('git', ['add', '.'], {cwd: path})
  return path
}
const run = (path, ...args) => spawnSync(process.execPath, [checker, '--root', path, ...args], {encoding: 'utf8'})
test('actual migrated candidate passes the strict documentation policy', t => {
  const path = fixture(t)
  assert.equal(run(path).status, 0)
  assert.equal(run(path, '--strict-docs').status, 0)
})
for (const [file, error] of [
  ['docs/product/layout-probe.md', /Strict docs\/plans-only/],
  ['docs/plans/layout-probe.pdf', /Technical plans must be Markdown/],
  ['docs/plans/requirements/layout-probe.md', /Product archives cannot be hidden/],
  ['docs/plans/archive/layout-probe.md', /Product archives cannot be hidden/],
  ['apps/primer-home/requirements/layout-probe.md', /Product copies and private report/],
]) {
  test(`documentation retention rejects ${file}`, t => {
    const path = fixture(t)
    mkdirSync(dirname(join(path, file)), {recursive: true})
    writeFileSync(join(path, file), 'synthetic prohibited source')
    execFileSync('git', ['add', '-f', file], {cwd: path})
    assert.match(run(path).stderr, error)
  })
}
for (const missing of ['apps/legacy-landing/package.json', 'package-lock.json', 'apps/web/src/auth/PublicAuth.test.tsx', 'apps/profile-preview/package.json', 'apps/profile-preview/src/profile.test.ts', 'apps/web/production-static/index.html', 'deployment/vps/outline/Caddyfile.example', 'deployment/forum-api/sber-dns.override.yaml', 'deployment/pgadmin/compose.yaml', 'scripts/deployment/forum-db/bootstrap_forum_db.sh', 'scripts/deployment/forum-db/configure_forum_app_role.sh', 'scripts/deployment/pgadmin/configure-admin.py', 'scripts/deployment/mail/stalwart_api.py', 'scripts/maintenance/mail/backup.sh', 'scripts/maintenance/openproject/backup.sh', 'scripts/verification/mail/verify.py', 'scripts/verification/forum-api/test-callback-relay.mjs']) {
  test(`required source cannot be skipped: ${missing}`, t => {
    const path = fixture(t)
    rmSync(join(path, missing))
    assert.notEqual(run(path).status, 0)
  })
}
test('actual package script drift is rejected', t => {
  const path = fixture(t)
  const file = join(path, 'apps/web/package.json')
  const pkg = JSON.parse(readFileSync(file))
  pkg.scripts.lint = 'true'
  writeFileSync(file, JSON.stringify(pkg))
  assert.match(run(path).stderr, /Script contract/)
})
test('ignored dependency and private source cannot enter the tracked layout', t => {
  const path = fixture(t)
  for (const file of ['node_modules/hidden.js', 'access.private.json', 'receipt.private.svg']) {
    mkdirSync(dirname(join(path, file)), {recursive: true})
    writeFileSync(join(path, file), 'synthetic forbidden fixture')
    execFileSync('git', ['add', '-f', file], {cwd: path})
  }
  assert.match(run(path).stderr, /Private\/generated/)
})
for (const file of ['.outline-migration/payload.json', 'outline-uploads/form.json', '.gitnexus/context.json', '.gitnexus-cache/cache.json']) {
  test(`force-added migration and cache source is rejected: ${file}`, t => {
    const path = fixture(t)
    mkdirSync(dirname(join(path, file)), {recursive: true})
    writeFileSync(join(path, file), 'synthetic forbidden fixture')
    execFileSync('git', ['add', '-f', file], {cwd: path})
    const result = run(path)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Private\/generated/)
  })
}
test('final quality check requires every exact result to be success', () => {
  const jobs = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database', 'profile', 'operational', 'web-release']
  const results = Object.fromEntries(jobs.map(job => [job, {result: 'success'}]))
  const gate = data => spawnSync(process.execPath, [join(root, 'scripts/verification/quality-gate.mjs')], {
    env: {...process.env, QUALITY_RESULTS: JSON.stringify(data)}, encoding: 'utf8',
  })
  assert.equal(gate(results).status, 0)
  for (const result of ['failure', 'skipped', 'cancelled']) {
    for (const job of jobs) assert.notEqual(gate({...results, [job]: {result}}).status, 0)
  }
  const missing = {...results}
  delete missing.api
  assert.notEqual(gate(missing).status, 0)
})

test('every checkout uses the explicit candidate head expression', () => {
  const workflow = readFileSync(join(root, '.github/workflows/quality.yml'), 'utf8')
  const checkouts = [...workflow.matchAll(/- uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=      - |\n  \w|$)/g)]
  assert.equal(checkouts.length, 10)
  for (const [, block] of checkouts) assert.match(block, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
})

test('operational READMEs retain examples without personal delivery/access evidence', () => {
  for (const owner of ['mail', 'openproject']) {
    const readme = readFileSync(join(root, `deployment/${owner}/README.md`), 'utf8')
    assert.doesNotMatch(readme, /@gmail\.com|queueId|Message-ID:|\/Users\/|\/backups\/[^`\s]*\d{8}T\d{6}/)
  }
  assert.match(readFileSync(join(root, 'deployment/mail/README.md'), 'utf8'), /recipient@example\.invalid/)
})

// Exercise current documentation/policy ownership without invoking any administrator.
const provenance = path => spawnSync('python3', ['-c',
  'import importlib.util,pathlib,sys; p=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location("checker",p/"scripts/verification/check-operational-sources.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.ROOT=p; m.verify_provenance()', path,
], {encoding: 'utf8'})
test('Task6 ownership proves current hashes while keeping the Task5 snapshot immutable', t => {
  const path = fixture(t)
  assert.equal(provenance(path).status, 0)
  const parity = join(path, 'artifacts/repository-audits/task-5-source-parity.json')
  writeFileSync(parity, readFileSync(parity, 'utf8') + ' ')
  assert.match(provenance(path).stderr, /Historical Task5 parity snapshot changed/)
})
for (const section of ['currentDocumentationOwnership', 'currentVerificationOwnership']) {
  test(`Task6 ${section} cannot hide runtime source or hash drift`, t => {
    const path = fixture(t)
    const file = join(path, 'artifacts/repository-audits/accepted-source-matrix.json')
    const matrix = JSON.parse(readFileSync(file))
    const owner = matrix.task6[section][0]
    writeFileSync(join(path, owner.candidatePath), readFileSync(join(path, owner.candidatePath), 'utf8') + '\nsynthetic drift\n')
    assert.notEqual(provenance(path).status, 0)
    const clean = fixture(t)
    const source = JSON.parse(readFileSync(join(clean, 'artifacts/repository-audits/accepted-source-matrix.json')))
    source.task6[section][0].previousCandidatePath = 'apps/api/src/auth/auth-store.ts'
    writeFileSync(join(clean, 'artifacts/repository-audits/accepted-source-matrix.json'), JSON.stringify(source))
    assert.match(provenance(clean).stderr, /Unknown or runtime/)
  })
}

test('fresh metadata hashes cannot replace immutable source pins', t => {
  const path = fixture(t)
  const file = join(path, 'artifacts/repository-audits/accepted-source-matrix.json')
  const matrix = JSON.parse(readFileSync(file))
  matrix.components[0].sourceSha = '0'.repeat(40)
  writeFileSync(file, JSON.stringify(matrix))
  const receipt = join(path, 'artifacts/repository-audits/task-6-source-ownership.json')
  const ownership = JSON.parse(readFileSync(receipt))
  ownership.acceptedSourceMatrixSha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  writeFileSync(receipt, JSON.stringify(ownership))
  assert.match(provenance(path).stderr, /Immutable source pins changed/)
})

test('Task7 current runtime ownership detects changed bytes and rejects unrelated overrides', t => {
  const path=fixture(t)
  assert.equal(provenance(path).status,0)
  const source=join(path,'apps/web/src/App.tsx')
  writeFileSync(source,readFileSync(source,'utf8')+'\n// unexpected runtime drift\n')
  assert.notEqual(provenance(path).status,0)
  const clean=fixture(t)
  const file=join(clean,'artifacts/repository-audits/task-7-source-ownership.json')
  const receipt=JSON.parse(readFileSync(file))
  receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
  writeFileSync(file,JSON.stringify(receipt))
  assert.match(provenance(clean).stderr,/Out-of-scope Task7/)
})

for (const mutation of ['hash', 'pin', 'scope', 'mode', 'path', 'duplicate', 'source']) {
  test(`PROJ-154 governance ownership rejects ${mutation} tampering`, t => {
    const path = fixture(t)
    const file = join(path, 'artifacts/repository-audits/proj-154-verification-ownership.json')
    const receipt = JSON.parse(readFileSync(file))
    if (mutation === 'hash') receipt.changes[0].candidateSha256 = '0'.repeat(64)
    if (mutation === 'pin') receipt.changes[0].previousSha256 = '0'.repeat(64)
    if (mutation === 'scope') receipt.changes[0].previousCandidatePath = 'apps/api/src/app.ts'
    if (mutation === 'mode') receipt.changes[0].candidateMode = '100755'
    if (mutation === 'path') receipt.changes[0].candidatePath = '../package.json'
    if (mutation === 'duplicate') receipt.changes.push(receipt.changes[0])
    if (mutation === 'source') receipt.newFiles[0].sha256 = '0'.repeat(64)
    writeFileSync(file, JSON.stringify(receipt))
    assert.notEqual(provenance(path).status, 0)
  })
}

for (const mutation of ['hash', 'pin', 'scope', 'mode', 'path', 'duplicate', 'base']) {
  test(`PROJ-31 public entry ownership rejects ${mutation} tampering`, t => {
    const path = fixture(t)
    assert.equal(provenance(path).status, 0)
    const file = join(path, 'artifacts/repository-audits/proj-31-public-entry-ownership.json')
    const receipt = JSON.parse(readFileSync(file))
    if (mutation === 'hash') receipt.changes[0].candidateSha256 = '0'.repeat(64)
    if (mutation === 'pin') receipt.changes[0].previousSha256 = '0'.repeat(64)
    if (mutation === 'scope') receipt.changes[0].previousCandidatePath = 'apps/api/src/app.ts'
    if (mutation === 'mode') receipt.changes[0].candidateMode = '100755'
    if (mutation === 'path') receipt.changes[0].candidatePath = '../package.json'
    if (mutation === 'duplicate') receipt.changes.push(receipt.changes[0])
    if (mutation === 'base') receipt.baseSha = '0'.repeat(40)
    writeFileSync(file, JSON.stringify(receipt))
    assert.notEqual(provenance(path).status, 0)
  })
}

for (const mutation of ['hash','pin','scope','mode','duplicate','base','source']) {
  test(`PROJ-155 auth ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-155-sber-auth-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','duplicate','base','source']) {
  test(`PROJ-156 main auth ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-156-main-auth-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/web/src/home/App.tsx'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-157 login ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-157-login-entry-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-158 provider button ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-158-sber-button-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-160 cabinet profile ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-160-cabinet-profile-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-159 skip link ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-159-skip-link-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-38 logout homepage ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-38-logout-home-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/app.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}

for (const mutation of ['hash','pin','scope','mode','path','duplicate','base','source']) {
  test(`PROJ-162 organization ownership rejects ${mutation} tampering`, t => {
    const path=fixture(t)
    assert.equal(provenance(path).status,0)
    const file=join(path,'artifacts/repository-audits/proj-162-my-organizations-ownership.json')
    const receipt=JSON.parse(readFileSync(file))
    if(mutation==='hash')receipt.changes[0].candidateSha256='0'.repeat(64)
    if(mutation==='pin')receipt.changes[0].previousSha256='0'.repeat(64)
    if(mutation==='scope')receipt.changes[0].previousCandidatePath='apps/api/src/iam/crypto.ts'
    if(mutation==='mode')receipt.changes[0].candidateMode='100755'
    if(mutation==='path')receipt.changes[0].candidatePath='../package.json'
    if(mutation==='duplicate')receipt.changes.push(receipt.changes[0])
    if(mutation==='base')receipt.baseSha='0'.repeat(40)
    if(mutation==='source')receipt.newFiles[0].sha256='0'.repeat(64)
    writeFileSync(file,JSON.stringify(receipt))
    assert.notEqual(provenance(path).status,0)
  })
}
