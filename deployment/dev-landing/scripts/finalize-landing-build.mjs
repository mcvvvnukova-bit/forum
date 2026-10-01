import {existsSync, renameSync, rmSync} from 'node:fs'
import {resolve} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const landingHtml = resolve(root, 'dist', 'site', 'landing', 'landing.html')
const indexHtml = resolve(root, 'dist', 'site', 'landing', 'index.html')

if (!existsSync(landingHtml)) {
  throw new Error(`Landing build did not produce ${landingHtml}`)
}

rmSync(indexHtml, {force: true})
renameSync(landingHtml, indexHtml)
