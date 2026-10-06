import {useEffect, useState} from 'react'
import type {Session} from './intent'
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/session', {credentials:'same-origin', signal:controller.signal}).then(async response => {
      if (response.status === 401) return
      if (!response.ok) throw new Error('Session unavailable')
      const data = await response.json() as Session
      if (typeof data.user?.id !== 'string' || typeof data.user.displayName !== 'string') throw new Error('Invalid session')
      if (!controller.signal.aborted) setSession(data)
    }).catch(() => {if (!controller.signal.aborted) setUnavailable(true)}).finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [])
  return {session, loading, unavailable}
}
