import {createServer} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {resolve, extname, normalize} from 'node:path'
import {chromium} from 'playwright'

const root = resolve(import.meta.dirname, '..', 'dist', 'site', 'landing')

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

function staticTarget(pathname) {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  const candidate = resolve(root, `.${normalize(decoded)}`)
  if (!candidate.startsWith(root)) {
    return null
  }
  return candidate
}

const server = createServer(async (request, response) => {
  const target = staticTarget(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  if (!target) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const fileStat = await stat(target)
    if (!fileStat.isFile()) {
      throw new Error('Not a file')
    }
    const payload = await readFile(target)
    response.writeHead(200, {'Content-Type': mimeTypes.get(extname(target)) ?? 'application/octet-stream'})
    response.end(payload)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

function listen(serverInstance) {
  return new Promise((resolveListen) => {
    serverInstance.listen(0, '127.0.0.1', () => resolveListen(serverInstance.address()))
  })
}

function close(serverInstance) {
  return new Promise((resolveClose) => serverInstance.close(resolveClose))
}

function assertNear(actual, expected, label) {
  if (Math.abs(actual - expected) > 1) {
    throw new Error(`${label}: expected ${expected}px, got ${actual}px`)
  }
}

function assertInside(innerRight, outerRight, label) {
  if (innerRight > outerRight + 1) {
    throw new Error(`${label}: content right edge ${innerRight}px exceeds panel right edge ${outerRight}px`)
  }
}

const address = await listen(server)
const browser = await chromium.launch({headless: true})

try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1200}})
  await page.goto(`http://127.0.0.1:${address.port}/`, {waitUntil: 'networkidle'})
  await page.evaluate(() => document.fonts.ready)

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) {
        throw new Error(`Missing selector: ${selector}`)
      }
      const bounds = element.getBoundingClientRect()
      return {
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        width: Math.round(bounds.width),
      }
    }

    const layer = (selector) => {
      const element = document.querySelector(selector)
      if (!element) {
        throw new Error(`Missing selector: ${selector}`)
      }
      const zIndex = getComputedStyle(element).zIndex
      return zIndex === 'auto' ? 0 : Number(zIndex)
    }

    return {
      customerPanel: rect('.audience-card--customer .audience-card__panel'),
      customerCardLayer: layer('.audience-card--customer'),
      supplierPanel: rect('.audience-card--supplier .audience-card__panel'),
      supplierCardLayer: layer('.audience-card--supplier'),
      supplierTitle: rect('.audience-card--supplier .audience-card__title'),
      supplierDescription: rect('.audience-card--supplier .audience-card__description'),
      specialistPanel: rect('.audience-card--specialist .audience-card__panel'),
      specialistCardLayer: layer('.audience-card--specialist'),
      specialistTitle: rect('.audience-card--specialist .audience-card__title'),
      specialistDescription: rect('.audience-card--specialist .audience-card__description'),
      vortexLayer: layer('.audience-vortex'),
    }
  })

  assertNear(layout.supplierPanel.width, layout.customerPanel.width, 'Supplier card panel width')
  assertNear(layout.specialistPanel.width, layout.customerPanel.width, 'Specialist card panel width')
  assertInside(layout.supplierTitle.right, layout.supplierPanel.right, 'Supplier title')
  assertInside(layout.supplierDescription.right, layout.supplierPanel.right, 'Supplier description')
  assertInside(layout.specialistTitle.right, layout.specialistPanel.right, 'Specialist title')
  assertInside(layout.specialistDescription.right, layout.specialistPanel.right, 'Specialist description')
  if (
    layout.vortexLayer <= layout.customerCardLayer ||
    layout.vortexLayer <= layout.supplierCardLayer ||
    layout.vortexLayer <= layout.specialistCardLayer
  ) {
    throw new Error(
      `Audience vortex layer: expected ${layout.vortexLayer} to be above card layers ${layout.customerCardLayer}, ${layout.supplierCardLayer}, ${layout.specialistCardLayer}`,
    )
  }

  console.log('PASS: landing audience card layout matches the desktop geometry')

  await page.setViewportSize({width: 3640, height: 900})
  const footerLayout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) {
        throw new Error(`Missing selector: ${selector}`)
      }
      const bounds = element.getBoundingClientRect()
      return {
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
        width: Math.round(bounds.width),
      }
    }

    return {
      headerContainer: rect('.landing-header__inner'),
      footerContainer: rect('.landing-footer__inner'),
    }
  })

  assertNear(footerLayout.footerContainer.width, footerLayout.headerContainer.width, 'Footer container width')
  assertNear(footerLayout.footerContainer.left, footerLayout.headerContainer.left, 'Footer container left edge')
  assertNear(footerLayout.footerContainer.right, footerLayout.headerContainer.right, 'Footer container right edge')

  console.log('PASS: landing footer stays aligned with the desktop container')
} finally {
  await browser.close()
  await close(server)
}
