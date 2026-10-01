import {renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {useForumSession} from './useForumSession'

afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals()})

describe('existing Forum session', () => {
  it('uses the same-origin API session for the cabinet label', async () => {
    vi.stubEnv('VITE_FORUM_SESSION', 'true')
    const fetchSession = vi.fn().mockResolvedValue({ok: true, json: async () => ({user: {id: 'user-id'}})})
    vi.stubGlobal('fetch', fetchSession)
    const {result, unmount} = renderHook(useForumSession)
    await waitFor(() => expect(result.current).toBe(true))
    expect(fetchSession).toHaveBeenCalledWith('/api/auth/session', {credentials: 'same-origin', signal: expect.any(AbortSignal)})
    const signal = fetchSession.mock.calls[0][1].signal
    unmount()
    expect(signal.aborted).toBe(true)
  })
  it.each([
    {ok: false},
    {ok: true, json: async () => ({user: {id: ''}})},
  ])('keeps sign-in for an expired or invalid session %#', async response => {
    vi.stubEnv('VITE_FORUM_SESSION', 'true')
    const fetchSession = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchSession)
    const {result} = renderHook(useForumSession)
    await waitFor(() => expect(fetchSession).toHaveBeenCalledOnce())
    expect(result.current).toBe(false)
  })
  it('keeps the local preview independent of the remote API', () => {
    vi.stubEnv('VITE_FORUM_SESSION', '')
    const fetchSession = vi.fn()
    vi.stubGlobal('fetch', fetchSession)
    const {result} = renderHook(useForumSession)
    expect(result.current).toBe(false)
    expect(fetchSession).not.toHaveBeenCalled()
  })
})
