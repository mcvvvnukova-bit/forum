const intentKey = 'forum.customer-intent'
const authReturnKey = 'forum.customer-auth-return'

export function preserveCustomerIntent() {
  try { sessionStorage.setItem(intentKey, JSON.stringify({audience: 'customer', action: 'create-order', returnTo: '/customers/'})) } catch { /* Configured action URLs also carry the intent. */ }
}

export function rememberCustomerAuth() {
  preserveCustomerIntent()
  try { sessionStorage.setItem(authReturnKey, 'pending') } catch { /* Browser storage may be disabled. */ }
}

export function restoreCustomerAuthReturn(search: string): string | undefined {
  const query = new URLSearchParams(search)
  if (!query.has('auth_error') && query.get('auth') !== 'success') return undefined
  try {
    if (sessionStorage.getItem(authReturnKey) !== 'pending') return undefined
    sessionStorage.removeItem(authReturnKey)
  } catch { return undefined }
  const result = new URLSearchParams()
  if (query.has('auth_error')) result.set('auth_error', query.get('auth_error') ?? 'invalid_state')
  else result.set('auth', 'success')
  return `/customers/?${result}`
}
