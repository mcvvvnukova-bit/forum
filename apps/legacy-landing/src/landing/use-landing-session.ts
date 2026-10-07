import {useEffect, useState} from 'react'

type Session = {user: {id: string; displayName: string}; participant?: {id: string; role: string; status: string}}

export const authErrorMessages: Record<string, string> = {
  access_denied: 'Вы отменили вход через Сбер ID. Можно попробовать ещё раз.',
  registration_required: 'Аккаунт ещё не создан. Зарегистрируйтесь через Сбер ID.',
  invalid_state: 'Время ожидания входа истекло. Попробуйте ещё раз.',
  account_deactivated: 'Доступ к аккаунту закрыт. Обратитесь в поддержку.',
  account_conflict: 'Не удалось связать данные Сбер ID с аккаунтом. Обратитесь в поддержку.',
  sber_unavailable: 'Вход через Сбер ID пока недоступен. Попробуйте позже.',
}

export function useLandingSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/auth/session', {credentials: 'same-origin', signal: controller.signal})
      .then(async (response) => {
        if (!response.ok) return
        const result = await response.json() as Session
        if (!controller.signal.aborted && typeof result.user?.id === 'string' && typeof result.user.displayName === 'string') {
          setSession(result)
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false) })
    return () => controller.abort()
  }, [])

  async function logout() {
    setIsLoggingOut(true)
    setLogoutError(null)
    try {
      const response = await fetch('/api/auth/logout', {method: 'POST', credentials: 'same-origin'})
      if (!response.ok) throw new Error('Logout failed')
      setSession(null)
    } catch {
      setLogoutError('Не удалось выйти из аккаунта. Попробуйте ещё раз.')
    } finally { setIsLoggingOut(false) }
  }

  return {session, isLoading, logout, isLoggingOut, logoutError}
}
