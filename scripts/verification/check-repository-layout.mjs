import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {lstatSync, readFileSync} from 'node:fs'
import {resolve, relative, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const args = process.argv.slice(2)
let root = fileURLToPath(new URL('../../', import.meta.url))
let strict = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--strict-docs') strict = true
  else if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i])
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`)
}
const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/verification/repository-layout.json')))
assert.equal(manifest.schemaVersion, 1, 'Unsupported layout schema')
assert.equal(typeof manifest.documentation.strictPlansOnly, 'boolean')
const git = (...argv) => execFileSync('git', ['-C', root, ...argv], {encoding: 'utf8'})
const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean))
const sourceFile = (path) => {
  assert(!path.includes('\\') && !path.split('/').includes('..') && !path.startsWith('/'), `Unsafe source path: ${path}`)
  const absolute = resolve(root, path)
  const parts = relative(root, absolute).split(sep)
  for (let i = 1; i <= parts.length; i++) assert(!lstatSync(resolve(root, ...parts.slice(0, i))).isSymbolicLink(), `Symlinked source: ${path}`)
  assert(lstatSync(absolute).isFile(), `Required source is not a file: ${path}`)
  assert(tracked.has(path), `Required source must be tracked: ${path}`)
  return absolute
}
const expectedPackages = new Set()
for (const owner of manifest.packages) {
  const prefix = owner.path === '.' ? '' : owner.path + '/'
  assert(!expectedPackages.has(prefix + 'package.json'), `Duplicate package: ${owner.path}`)
  expectedPackages.add(prefix + 'package.json')
  const pkg = JSON.parse(readFileSync(sourceFile(prefix + 'package.json')))
  const lock = JSON.parse(readFileSync(sourceFile(prefix + 'package-lock.json')))
  assert.equal(pkg.name, owner.name, `Package name: ${owner.path}`)
  assert.equal(lock.name, owner.name, `Lock name: ${owner.path}`)
  assert.equal(lock.packages[''].name, owner.name, `Lock root name: ${owner.path}`)
  for (const [script, command] of Object.entries(owner.scripts)) {
    assert.equal(typeof command, 'string')
    assert(command.trim(), `Empty declared script: ${owner.path}:${script}`)
    assert.equal(pkg.scripts?.[script], command, `Script contract: ${owner.path}:${script}`)
  }
  for (const path of [...owner.entrypoints, ...owner.tests]) sourceFile(prefix + path)
}
assert.deepEqual([...tracked].filter(p => p.endsWith('package.json')).sort(), [...expectedPackages].sort(), 'Unexpected or missing tracked packages')
for (const path of manifest.requiredFiles) sourceFile(path)
const forbidden = path => path.split('/').some(p => manifest.ignoredSourceDirectories.includes(p)) || path.endsWith(manifest.ignoredPrivateSuffix)
assert.deepEqual([...tracked].filter(forbidden), [], 'Private/generated paths must never be tracked source')
const probes = [...manifest.ignoredSourceDirectories.map(p => `${p}/layout-probe`), `layout-probe${manifest.ignoredPrivateSuffix}`]
const ignored = new Set(execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin', '-z'], {
  input: probes.join('\0') + '\0', encoding: 'utf8',
}).split('\0').filter(Boolean))
for (const probe of probes) assert(ignored.has(probe), `Missing ignore protection: ${probe}`)
const docs = [...tracked].filter(p => p.startsWith(manifest.documentation.root + '/'))
const outsidePlans = docs.filter(p => !p.startsWith(manifest.documentation.root + '/plans/'))
if (strict || manifest.documentation.strictPlansOnly) assert.deepEqual(outsidePlans, [], 'Strict docs/plans-only policy: migrate documents with Outline proof first')
console.log(JSON.stringify({packages: manifest.packages.map(p => p.path), documentation: {
  strictPlansOnly: strict || manifest.documentation.strictPlansOnly,
  trackedCount: docs.length, outsidePlans,
}}, null, 2))
