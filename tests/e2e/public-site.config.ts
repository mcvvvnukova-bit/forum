import {defineConfig} from '@playwright/test'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
export default defineConfig({
  outputDir:join(tmpdir(),'forum-public-site-test-results'),
  testDir: '.', testMatch:'public-site.spec.ts', fullyParallel:false, workers:1,
  timeout:30000, use:{baseURL:'http://127.0.0.1:5297',browserName:'chromium'},
  webServer:{cwd:fileURLToPath(new URL('../../',import.meta.url)),command:'node tests/e2e/serve-public-site.mjs',url:'http://127.0.0.1:5297',reuseExistingServer:false},
})
