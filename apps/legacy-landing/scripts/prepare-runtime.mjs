import {cpSync, mkdirSync, rmSync} from 'node:fs'
import {resolve} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const runtimeDir = resolve(root, 'dist', 'site')
const staticDir = resolve(root, 'static')

rmSync(runtimeDir, {force: true, recursive: true})
mkdirSync(runtimeDir, {recursive: true})
cpSync(staticDir, runtimeDir, {recursive: true})
