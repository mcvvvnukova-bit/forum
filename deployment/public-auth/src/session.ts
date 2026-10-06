export type SessionState = {kind: 'checking' | 'guest' | 'authenticated' | 'unknown'}
export async function checkSession(signal: AbortSignal): Promise<SessionState> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, {once: true})
  if (signal.aborted) controller.abort()
  const timer = window.setTimeout(abort, 10_000)
  try {
    const response = await fetch('/api/auth/session', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
    if (response.status === 401) return {kind: 'guest'}
    if (response.status !== 200) return {kind: 'unknown'}
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('user' in result)) return {kind: 'unknown'}
    const user = result.user as {id?: unknown; displayName?: unknown} | null
    return {kind: user && typeof user.id === 'string' && user.id.trim() && typeof user.displayName === 'string' && user.displayName.trim() ? 'authenticated' : 'unknown'}
  } catch {return {kind: 'unknown'}}
  finally {window.clearTimeout(timer); signal.removeEventListener('abort', abort)}
}
