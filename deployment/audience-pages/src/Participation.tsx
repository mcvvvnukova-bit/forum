import {Banner, Button, Heading, Link, Spinner, Stack, Text} from '@primer/react'
import type {Intent} from './AudiencePage'
import {isSupplierDirection, sessionContext, supplierDirectionLabels} from './intent'
import type {Session} from './intent'
export function Participation({intent, session, loading, unavailable, onDemo, onReturn}: {intent: Intent; session: Session | null; loading: boolean; unavailable: boolean; onDemo: (trigger: HTMLButtonElement, audience: string) => void; onReturn: () => void}) {
  const individual = intent.audience === 'individual'
  const context = sessionContext(session)
  const direction = individual ? intent.direction === 'jobs' ? 'Поиск вакансий' : intent.direction === 'orders' ? 'Поиск подходящих заказов' : 'Поиск работы и подработки' : isSupplierDirection(intent.direction) ? supplierDirectionLabels[intent.direction] : intent.audience === 'customer' ? 'Размещение заказа' : 'Поиск подходящих заказов'
  const error = new URLSearchParams(window.location.search).get('auth_error')
  return <Stack gap="spacious">
    <Text as="p" weight="semibold">{direction}</Text>
    {error && <Banner title="Вход не завершён" variant="warning"><Text as="p">{error === 'access_denied' ? 'Вы отменили вход через Сбер ID.' : 'Не удалось завершить вход. Попробуйте ещё раз.'} Выбранное направление сохранено.</Text></Banner>}
    {loading ? <Stack direction="horizontal" gap="normal" align="center"><Spinner size="small" /><Text role="status">Проверяем вход…</Text></Stack> : individual && context === 'individual' ? <>
      <Text as="p">Вы вошли как {session?.user.displayName}.</Text><Text as="p">Ваш следующий шаг — заполнение профиля: навыки, опыт и география работы. Выбранное направление сохранено.</Text>
    </> : <>
      {context !== 'anonymous' && <Banner title="Выберите подходящий контекст" variant="info"><Text as="p">Вы уже вошли в аккаунт. Для этого действия нужен {individual ? 'личный профиль исполнителя' : intent.audience === 'customer' ? 'участник компании-заказчика' : 'участник компании-исполнителя'}. Текущий участник не переключается автоматически.</Text></Banner>}
      {unavailable && <Banner title="Не удалось проверить вход" variant="warning"><Text as="p">Попробуйте позже. Выбранное направление сохранено.</Text></Banner>}
      {individual && context === 'anonymous' ? <>
        <Text as="p">Войдите в существующий аккаунт или зарегистрируйтесь через Сбер ID. После входа подтвердите электронную почту и заполните профиль.</Text>
        <Stack gap="normal"><Button as="a" href="/auth/sber-id/start?intent=register&subject=individual" variant="primary">Зарегистрироваться через Сбер ID</Button><Button as="a" href="/auth/sber-id/start?intent=login">Войти через Сбер ID</Button></Stack>
      </> : !individual ? <Banner title="Регистрация компаний — скоро" variant="info"><Text as="p">Мы готовим регистрацию через Контур.Диадок. Пока можно познакомиться с платформой на демонстрации.</Text></Banner> : null}
      {!individual && <Button onClick={e => onDemo(e.currentTarget, intent.audience === 'customer' ? 'Заказчик' : 'Компания-исполнитель')}>Записаться на демо</Button>}
    </>}
    <Button onClick={onReturn}>Вернуться к странице</Button>
  </Stack>
}
export function ParticipationPage({children}: {children: React.ReactNode}) {
  return <main id="main" tabIndex={-1} className="container destination-main"><Stack gap="spacious" className="destination-content"><Link href="/">На главную</Link><Heading as="h1" variant="large">Продолжить работу</Heading>{children}</Stack></main>
}
