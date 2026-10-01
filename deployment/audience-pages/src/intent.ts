import type {Intent} from './AudiencePage'
export const intentKey = 'forum.public.intent'
export type Session = {user: {id: string; displayName: string; emailConfirmed?: boolean}; participant?: {id: string; role: string; status: string; legalStatus?: string; kind?: string}}
export function validIntent(value: unknown): value is Intent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.audience === 'customer') return v.action === 'create-order' && v.returnTo === '/customers/' && v.direction === undefined
  if (v.audience === 'supplier') return v.action === 'find-orders' && v.returnTo === '/suppliers/' && (v.direction === undefined || v.direction === 'goods' || v.direction === 'services')
  return v.audience === 'individual' && v.action === 'find-orders' && v.returnTo === '/work/' && v.direction === 'orders'
}
export function saveIntent(intent: Intent) {if (validIntent(intent)) {try {sessionStorage.setItem(intentKey, JSON.stringify(intent))} catch { /* Keep the in-memory intent if browser storage is unavailable. */ }}}
export function readIntent(): Intent | null {
  try {const v: unknown = JSON.parse(sessionStorage.getItem(intentKey) || 'null'); return validIntent(v) ? v : null} catch {return null}
}
export function sessionContext(session: unknown): 'individual'|'other'|'anonymous' {
  if (!session || typeof session !== 'object' || !('user' in session)) return 'anonymous'
  const s = session as Session
  if (typeof s.user?.id !== 'string') return 'anonymous'
  return s.participant?.legalStatus === 'individual_person' && s.participant.role === 'provider' && s.participant.status !== 'deactivated' ? 'individual' : 'other'
}
