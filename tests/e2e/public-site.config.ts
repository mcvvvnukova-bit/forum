import {defineConfig} from '@playwright/test'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const portText=process.env.FORUM_WEB_E2E_PORT ?? '5297'
if(!/^[0-9]+$/.test(portText) || Number(portText)<1024 || Number(portText)>65535) throw new Error('Invalid FORUM_WEB_E2E_PORT')
const port=Number(portText)
export default defineConfig({
  outputDir:join(tmpdir(),'forum-public-site-test-results'),
  testDir: '.', testMatch:'public-site.spec.ts', fullyParallel:false, workers:1,
  timeout:30000, use:{baseURL:`http://127.0.0.1:${port}`,browserName:'chromium'},
  webServer:{cwd:fileURLToPath(new URL('../../',import.meta.url)),command:'node tests/e2e/serve-public-site.mjs',url:`http://127.0.0.1:${port}`,reuseExistingServer:false},
})
