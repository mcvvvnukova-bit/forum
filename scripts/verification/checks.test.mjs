import assert from 'node:assert/strict'
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
test('actual candidate layout passes, while strict docs policy remains explicit', t => {
  const path = fixture(t)
  assert.equal(run(path).status, 0)
  const strict = run(path, '--strict-docs')
  assert.notEqual(strict.status, 0)
  assert.match(strict.stderr, /Strict docs\/plans-only/)
})
for (const missing of ['deployment/dev-landing/package.json', 'apps/api/package-lock.json', 'deployment/public-auth/src/PublicAuth.test.tsx', 'local-previews/user-profile/package-lock.json', 'local-previews/user-profile/src/profile.test.ts', 'deployment/astforum-static/index.html', 'deployment/vps/outline/Caddyfile.example', 'deployment/forum-api/sber-dns.override.yaml', 'deployment/pgadmin/compose.yaml']) {
  test(`required source cannot be skipped: ${missing}`, t => {
    const path = fixture(t)
    rmSync(join(path, missing))
    assert.notEqual(run(path).status, 0)
  })
}
test('actual package script drift is rejected', t => {
  const path = fixture(t)
  const file = join(path, 'deployment/primer-home/package.json')
  const pkg = JSON.parse(readFileSync(file))
  pkg.scripts.lint = 'true'
  writeFileSync(file, JSON.stringify(pkg))
  assert.match(run(path).stderr, /Script contract/)
})
test('ignored dependency and private source cannot enter the tracked layout', t => {
  const path = fixture(t)
  for (const file of ['node_modules/hidden.js', 'access.private.json']) {
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
