import assert from 'node:assert/strict'
import {readdir, readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {chromium} from '@playwright/test'

const owner = fileURLToPath(new URL('../../deployment/mail/templates/', import.meta.url))
const sources = ['email.html', 'index.html', ...(await readdir(resolve(owner, 'remaining'))).filter(p => p.endsWith('.html')).map(p => `remaining/${p}`)]
assert.equal(sources.length, 8)
const server = createServer(async (request, response) => {
  try {
    const path = resolve(owner, '.' + new URL(request.url, 'http://localhost').pathname)
    assert(path.startsWith(owner))
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'image/webp')
    response.end(await readFile(path))
  } catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({viewport: {width: 390, height: 900}})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // External link destinations are not visited and network resources are blocked.
  await page.route(/^https?:/, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  for (const source of sources) {
    await page.goto(`${origin}/${source}`)
    for (const frame of page.frames()) {
      const images = await frame.locator('img').evaluateAll(elements => elements.map(img => ({loaded: img.complete && img.naturalWidth > 0, source: img.getAttribute('src')})))
      for (const img of images) assert(img.loaded, `${source}: ${img.source}`)
      assert(await frame.locator('body').isVisible(), source)
    }
    console.log(JSON.stringify({source, viewport: 390, bodyVisible: true, localImagesLoaded: true}))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
