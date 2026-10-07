// Shared by the independently built public page and authentication entrypoints.
// This is navigation state only: no product intent or provider context is stored.
export const publicNavigationEvent = 'forum:public-navigation'

export function publicAuthBackground(): string | null {
  const state = history.state
  const authPath = location.pathname.replace(/\/$/, '')
  if (authPath !== '/login' && authPath !== '/register' || state?.publicAuth !== true) return null
  const background: unknown = state.publicAuthBackground
  if (typeof background !== 'string' || !background.startsWith('/') || background.startsWith('//')) return null
  try {
    const url = new URL(background, location.origin)
    const path = url.pathname.replace(/\/$/, '')
    if (url.origin !== location.origin || path === '/login' || path === '/register') return null
    return url.pathname + url.search + url.hash
  } catch {return null}
}

export function publicPageUrl(): string {
  return publicAuthBackground() ?? location.pathname + location.search + location.hash
}

export function openPublicAuth(mode: 'login' | 'register', opener: HTMLElement | null = null) {
  const background = publicPageUrl()
  history.pushState({...history.state, publicAuth:true, publicAuthBackground:background}, '', '/'+mode)
  window.dispatchEvent(new CustomEvent(publicNavigationEvent, {detail:{opener}}))
}
