import {useEffect, useState} from 'react'

export function useForumSession(): boolean {
  const [authorized, setAuthorized] = useState(false)
  useEffect(() => {
    if (import.meta.env.VITE_FORUM_SESSION !== 'true') return
    const controller = new AbortController()
    void fetch('/api/auth/session', {credentials: 'same-origin', signal: controller.signal})
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        if (!controller.signal.aborted && typeof result?.user?.id === 'string' && result.user.id) setAuthorized(true)
      })
      // Unavailable or expired sessions retain the sign-in action.
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  return authorized
}
