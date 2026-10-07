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
for (const missing of ['apps/legacy-landing/package.json', 'package-lock.json', 'apps/public-auth/src/PublicAuth.test.tsx', 'apps/profile-preview/package.json', 'apps/profile-preview/src/profile.test.ts', 'apps/web/production-static/index.html', 'deployment/vps/outline/Caddyfile.example', 'deployment/forum-api/sber-dns.override.yaml', 'deployment/pgadmin/compose.yaml', 'scripts/deployment/forum-db/bootstrap_forum_db.sh', 'scripts/deployment/forum-db/configure_forum_app_role.sh', 'scripts/deployment/pgadmin/configure-admin.py', 'scripts/deployment/mail/stalwart_api.py', 'scripts/maintenance/mail/backup.sh', 'scripts/maintenance/openproject/backup.sh', 'scripts/verification/mail/verify.py', 'scripts/verification/forum-api/test-callback-relay.mjs']) {
  test(`required source cannot be skipped: ${missing}`, t => {
    const path = fixture(t)
    rmSync(join(path, missing))
    assert.notEqual(run(path).status, 0)
  })
}
test('actual package script drift is rejected', t => {
  const path = fixture(t)
  const file = join(path, 'apps/primer-home/package.json')
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
test('final quality check requires every exact result to be success', () => {
  const jobs = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database', 'profile', 'operational']
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
  assert.equal(checkouts.length, 9)
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
