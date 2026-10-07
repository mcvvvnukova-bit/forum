import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {getCalApi} = vi.hoisted(() => ({getCalApi: vi.fn()}))

vi.mock('@calcom/embed-react', () => ({getCalApi}))

function appendEmbedScript() {
  const script = document.createElement('script')
  script.src = 'https://cal.astforum.ru/embed/embed.js'
  document.head.append(script)
  return script
}

describe('Cal.diy demo embed', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.querySelectorAll('script[src="https://cal.astforum.ru/embed/embed.js"]').forEach((script) => script.remove())
    document.querySelectorAll('cal-modal-box').forEach((modal) => modal.remove())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads once and opens the requested self-hosted demo modal after the script is ready', async () => {
    const cal = vi.fn((command: string) => {
      if (command === 'modal') document.body.append(document.createElement('cal-modal-box'))
    })
    let script: HTMLScriptElement | undefined
    getCalApi.mockImplementation(() => {
      script = appendEmbedScript()
      return Promise.resolve(cal)
    })
    const {openDemoBooking} = await import('./cal-diy-embed')

    const firstOpen = openDemoBooking()
    const secondOpen = openDemoBooking()

    expect(getCalApi).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('script[src="https://cal.astforum.ru/embed/embed.js"]')).toHaveLength(1)
    expect(cal).not.toHaveBeenCalled()

    script?.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(document.querySelector('cal-modal-box')).toBeInTheDocument())
    document.querySelector('cal-modal-box')?.dispatchEvent(new Event('close'))
    await Promise.all([firstOpen, secondOpen])

    expect(getCalApi).toHaveBeenCalledWith({
      namespace: '60min',
      embedJsUrl: 'https://cal.astforum.ru/embed/embed.js',
    })
    expect(cal).toHaveBeenCalledTimes(3)
    expect(cal).toHaveBeenNthCalledWith(1, 'init', {origin: 'https://cal.astforum.ru'})
    expect(cal).toHaveBeenNthCalledWith(2, 'ui', {theme: 'light', layout: 'month_view'})
    expect(cal).toHaveBeenNthCalledWith(3, 'modal', {
      calLink: 'demo/60min',
      calOrigin: 'https://cal.astforum.ru',
      config: {layout: 'month_view'},
    })
  })

  it('keeps the native popup guard through close, then allows a later reopen', async () => {
    const cal = vi.fn((command: string) => {
      if (command === 'modal') document.body.append(document.createElement('cal-modal-box'))
    })
    let script: HTMLScriptElement | undefined
    getCalApi.mockImplementation(() => {
      script = appendEmbedScript()
      return Promise.resolve(cal)
    })
    const {openDemoBooking} = await import('./cal-diy-embed')

    const firstOpen = openDemoBooking()
    script?.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(document.querySelectorAll('cal-modal-box')).toHaveLength(1))

    const secondOpen = openDemoBooking()
    expect(secondOpen).toBe(firstOpen)
    expect(cal).toHaveBeenCalledTimes(3)

    const firstModal = document.querySelector('cal-modal-box')
    firstModal?.dispatchEvent(new Event('close'))
    await firstOpen

    const reopened = openDemoBooking()
    await vi.waitFor(() => expect(document.querySelectorAll('cal-modal-box')).toHaveLength(2))
    expect(cal).toHaveBeenCalledTimes(4)
    document.querySelectorAll('cal-modal-box')[1]?.dispatchEvent(new Event('close'))
    await reopened
  })

  it('rejects when the remote script errors', async () => {
    let script: HTMLScriptElement | undefined
    getCalApi.mockImplementation(() => {
      script = appendEmbedScript()
      return Promise.resolve(vi.fn())
    })
    const {openDemoBooking} = await import('./cal-diy-embed')

    const opening = openDemoBooking()
    script?.dispatchEvent(new Event('error'))

    await expect(opening).rejects.toThrow('Cal.diy embed script failed to load')
  })

  it('rejects when the remote script does not become ready before the timeout', async () => {
    vi.useFakeTimers()
    getCalApi.mockImplementation(() => {
      appendEmbedScript()
      return Promise.resolve(vi.fn())
    })
    const {openDemoBooking} = await import('./cal-diy-embed')

    const opening = openDemoBooking()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(opening).rejects.toThrow('Cal.diy embed script timed out')
  })
})
