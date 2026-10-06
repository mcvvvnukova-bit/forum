import {getCalApi} from '@calcom/embed-react'
import type {MouseEvent} from 'react'

const BOOKING_URL = 'https://cal.astforum.ru/demo/60min'
const CAL_LINK = 'demo/60min'
const CAL_ORIGIN = 'https://cal.astforum.ru'
const EMBED_SCRIPT_URL = 'https://cal.astforum.ru/embed/embed.js'
const NAMESPACE = '60min'
const SCRIPT_TIMEOUT_MS = 10_000

type CalApi = (command: string, payload: Record<string, unknown>) => void

let readyCalPromise: Promise<CalApi> | undefined
let openingPromise: Promise<void> | undefined

function findEmbedScript() {
  return Array.from(document.scripts).find((script) => script.src === EMBED_SCRIPT_URL)
}

function isEmbedReady() {
  const calWindow = window as Window & {Cal?: {ns?: Record<string, {instance?: unknown}>}}
  return Boolean(calWindow.Cal?.ns?.[NAMESPACE]?.instance)
}

function waitForEmbedScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    let script: HTMLScriptElement | undefined
    let observer: MutationObserver | undefined
    let timeout: number | undefined

    const finish = (error?: Error) => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      observer?.disconnect()
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }

    const onLoad = () => {
      if (script) script.dataset.calDiyReady = 'true'
      finish()
    }
    const onError = () => finish(new Error('Cal.diy embed script failed to load'))

    const watchScript = (nextScript: HTMLScriptElement) => {
      script = nextScript
      if (script.dataset.calDiyReady === 'true' || isEmbedReady()) {
        finish()
        return
      }
      script.addEventListener('load', onLoad, {once: true})
      script.addEventListener('error', onError, {once: true})
    }

    const existingScript = findEmbedScript()
    if (existingScript) {
      watchScript(existingScript)
    } else {
      observer = new MutationObserver(() => {
        const appendedScript = findEmbedScript()
        if (appendedScript) {
          observer?.disconnect()
          watchScript(appendedScript)
        }
      })
      observer.observe(document.head, {childList: true})
    }

    timeout = window.setTimeout(() => finish(new Error('Cal.diy embed script timed out')), SCRIPT_TIMEOUT_MS)
  })
}

function loadCalApi() {
  if (readyCalPromise) return readyCalPromise

  const calPromise = getCalApi({namespace: NAMESPACE, embedJsUrl: EMBED_SCRIPT_URL}) as Promise<CalApi>
  const loading = Promise.all([calPromise, waitForEmbedScript()]).then(([cal]) => {
    cal('init', {origin: CAL_ORIGIN})
    cal('ui', {theme: 'light', layout: 'month_view'})
    return cal
  })
  readyCalPromise = loading
  void loading.then(
    () => undefined,
    () => {
      if (readyCalPromise === loading) readyCalPromise = undefined
    },
  )
  return loading
}

function waitForNativePopupClose() {
  const existingModals = new Set(document.querySelectorAll('cal-modal-box'))

  return new Promise<void>((resolve) => {
    let observer: MutationObserver
    const watchModal = (modal: Element) => {
      observer.disconnect()
      modal.addEventListener('close', () => resolve(), {once: true})
    }
    const findNewModal = () =>
      Array.from(document.querySelectorAll('cal-modal-box')).find((modal) => !existingModals.has(modal))

    observer = new MutationObserver(() => {
      const modal = findNewModal()
      if (modal) watchModal(modal)
    })
    observer.observe(document.body, {childList: true, subtree: true})

    const modal = findNewModal()
    if (modal) watchModal(modal)
  })
}

export function openDemoBooking(config: Record<string, string> = {}) {
  if (openingPromise) return openingPromise

  const opening = loadCalApi().then((cal) => {
    const popupClosed = waitForNativePopupClose()
    cal('modal', {
      calLink: CAL_LINK,
      calOrigin: CAL_ORIGIN,
      config: {layout: 'month_view', ...config},
    })
    return popupClosed
  })
  openingPromise = opening
  void opening.then(
    () => {
      if (openingPromise === opening) openingPromise = undefined
    },
    () => {
      if (openingPromise === opening) openingPromise = undefined
    },
  )
  return opening
}

export function onDemoBookingClick(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  event.preventDefault()
  const fallbackUrl = event.currentTarget.href || BOOKING_URL
  void openDemoBooking().catch(() => window.location.assign(fallbackUrl))
}

export {BOOKING_URL}
