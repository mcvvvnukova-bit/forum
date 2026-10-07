import {afterEach, describe, expect, it, vi} from 'vitest'
import {checkSession} from './session'
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers()})
describe('session boundary', () => {
  it('recognizes only 401 as guest', async () => {
    vi.stubGlobal('fetch', async () => new Response('', {status: 401}))
    expect(await checkSession(new AbortController().signal)).toEqual({kind: 'guest'})
  })
  it.each([500, 403, 200])('does not offer sign-in after uncertain response %s', async status => {
    vi.stubGlobal('fetch', async () => new Response('{}', {status}))
    expect(await checkSession(new AbortController().signal)).toEqual({kind: 'unknown'})
  })
  it('requires a valid server identity', async () => {
    vi.stubGlobal('fetch', async () => Response.json({user: {id: 'user-1', displayName: 'Тест'}}))
    expect(await checkSession(new AbortController().signal)).toEqual({kind: 'authenticated'})
  })
  it('ends an unresponsive session check after ten seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    const pending = checkSession(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toEqual({kind: 'unknown'})
  })
})
