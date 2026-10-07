import type {Session} from './audience/intent'
export type SessionState = {kind:'checking'|'guest'|'authenticated'|'unknown'}
export type SessionResult = {session:Session|null; loading:boolean; unavailable:boolean}

export async function requestSession(signal: AbortSignal): Promise<SessionResult> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, {once:true})
  if (signal.aborted) controller.abort()
  const timer = window.setTimeout(abort, 10_000)
  try {
    const response = await fetch('/api/auth/session', {credentials:'same-origin', cache:'no-store', signal:controller.signal})
    if (response.status === 401) return {session:null, loading:false, unavailable:false}
    if (response.status !== 200) throw new Error('Session unavailable')
    const result = await response.json() as Session
    if (typeof result?.user?.id !== 'string' || !result.user.id.trim() || typeof result.user.displayName !== 'string' || !result.user.displayName.trim()) throw new Error('Invalid session')
    return {session:result, loading:false, unavailable:false}
  } catch {return {session:null, loading:false, unavailable:true}}
  finally {window.clearTimeout(timer); signal.removeEventListener('abort', abort)}
}
export async function checkSession(signal:AbortSignal):Promise<SessionState> {
  const value=await requestSession(signal)
  return {kind:value.unavailable?'unknown':value.session?'authenticated':'guest'}
}
