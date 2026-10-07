import {Banner, Button} from '@primer/react'
import {destinations} from './config'

const messages: Record<string, string> = {
  access_denied: 'Вы отменили вход через Сбер ID. Можно попробовать ещё раз.',
  registration_required: 'Аккаунт ещё не создан. Зарегистрируйтесь через Сбер ID.',
  invalid_state: 'Время ожидания входа истекло. Попробуйте ещё раз.',
  account_deactivated: 'Доступ к аккаунту закрыт. Обратитесь в поддержку.',
  account_conflict: 'Не удалось связать данные Сбер ID с аккаунтом. Обратитесь в поддержку.',
  sber_unavailable: 'Вход через Сбер ID пока недоступен. Попробуйте позже.',
  temporarily_unavailable: 'Сервис входа временно недоступен. Попробуйте позже.',
}

export function AuthNotice() {
  const error = new URLSearchParams(window.location.search).get('auth_error') || ''
  const message = Object.hasOwn(messages, error) ? messages[error] : null
  if (!message) return null
  const registration = error === 'registration_required'
  return (
    <div className="container section">
      <Banner title={message} variant="warning">
        <Button as="a" href={registration ? destinations.start : destinations.login}>
          {registration ? 'Зарегистрироваться через Сбер ID' : 'Повторить вход'}
        </Button>
      </Banner>
    </div>
  )
}
