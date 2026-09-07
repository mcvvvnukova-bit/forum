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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads once and opens the requested self-hosted demo modal after the script is ready', async () => {
    const cal = vi.fn()
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
