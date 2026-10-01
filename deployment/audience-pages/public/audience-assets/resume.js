/* Continue the public-page intent after the existing Sber callback to /. */
(() => {
  const query = new URLSearchParams(window.location.search)
  if (window.location.pathname !== '/' || (!query.has('auth') && !query.has('auth_error'))) return
  try {
    const value = JSON.parse(sessionStorage.getItem('forum.public.intent') || 'null')
    if (!value || value.audience !== 'individual' || value.action !== 'find-orders' || value.direction !== 'orders' || value.returnTo !== '/work/') return
    const next = new URL('/participate/', window.location.origin)
    const error = query.get('auth_error')
    if (error && /^[a-z_]{1,64}$/.test(error)) next.searchParams.set('auth_error', error)
    next.searchParams.set('resume', '1')
    window.location.replace(next.pathname + next.search)
  } catch { /* Browsing remains available when storage is unavailable or invalid. */ }
})()
