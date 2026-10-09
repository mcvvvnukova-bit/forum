import {execFileSync} from 'node:child_process'
import {appendFileSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const jobs = ['layout', 'api', 'frontend', 'composition', 'publishers', 'database', 'profile', 'operational', 'web-release']
const full = () => Object.fromEntries(jobs.map(job => [job, true]))
const rules = [
  [['docs/', 'README.md', 'artifacts/README.md'], []],
  [['apps/profile-preview/'], ['profile']],
  [['apps/web/'], ['frontend', 'composition', 'publishers', 'web-release']],
  [['apps/legacy-landing/', 'apps/dev-gateway/'], ['api', 'frontend', 'composition', 'publishers', 'web-release']],
  [['apps/api/'], ['api', 'frontend', 'composition', 'database', 'web-release']],
  [['deployment/forum-db/', 'scripts/deployment/forum-db/'], ['api', 'database']],
  [['deployment/forum-api/', 'scripts/verification/forum-api/'], ['api']],
  [['deployment/mail/', 'deployment/openproject/', 'deployment/pgadmin/', 'scripts/deployment/mail/', 'scripts/deployment/pgadmin/', 'scripts/maintenance/mail/', 'scripts/maintenance/openproject/', 'scripts/verification/mail/', 'scripts/verification/check-mail-resources.py', 'tests/e2e/mail-resources.mjs'], ['operational']],
  [['scripts/deployment/primer-home/', 'scripts/deployment/audience-pages/', 'scripts/deployment/public-auth/', 'scripts/deployment/legacy-landing/', 'scripts/deployment/public_site.py'], ['frontend', 'composition', 'publishers', 'web-release']],
  [['tests/integration/test_public_site_release.py'], ['publishers']],
  [['tests/integration/test_web_release.py', 'deployment/web/', 'deployment/release-manifest.schema.json', 'scripts/deployment/build-web-release.mjs', 'scripts/deployment/web_release.py', 'scripts/verification/check-web-release.sh', 'scripts/verification/web-build-inputs.test.mjs', 'tests/e2e/public-site.', 'tests/e2e/serve-public-site.mjs'], ['web-release']],
  [['tests/integration/public-site-composition.test.tsx', 'vitest.composition.config.ts'], ['composition']],
  [['scripts/verification/primer-ui/', 'scripts/verification/check-primer-ui.py', 'tests/integration/test_primer_ui_policy.py'], ['frontend', 'composition', 'web-release']],
]

export function selectJobs({eventName, files, baseAvailable}) {
  if (eventName !== 'pull_request' || !baseAvailable || !Array.isArray(files)) return full()
  const selected = Object.fromEntries(jobs.map(job => [job, job === 'layout']))
  for (const path of files) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) return full()
    const rule = rules.find(([prefixes]) => prefixes.some(prefix => prefix.endsWith('/') || prefix === 'tests/e2e/public-site.' ? path.startsWith(prefix) : path === prefix))
    if (!rule) return full()
    for (const job of rule[1]) selected[job] = true
  }
  return selected
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  let files, baseAvailable = false
  if (eventName === 'pull_request') {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      const base = event.pull_request?.base?.sha, head = event.pull_request?.head?.sha
      if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('Missing candidate history')
      const git = (...args) => execFileSync('git', args, {encoding:'utf8', stdio:['ignore','pipe','pipe']})
      if (git('rev-parse','HEAD').trim() !== head) throw new Error('Candidate checkout mismatch')
      files = git('diff','--name-only','--no-renames','-z',`${base}...${head}`,'--').split('\0').filter(Boolean)
      baseAvailable = true
    } catch {
      // Missing/shallow history or an invalid event must never suppress checks.
      console.log('Candidate diff unavailable; selecting every check')
    }
  }
  const selection = selectJobs({eventName, files, baseAvailable})
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `selection=${JSON.stringify(selection)}\n`)
  console.log(JSON.stringify({eventName, selection}))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
