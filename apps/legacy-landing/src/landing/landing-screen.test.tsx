import {fireEvent, render, screen, within} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {LandingApp} from './LandingApp'

describe('landing screen assets', () => {
  it('uses exported Figma imagery for the hero and audience map', () => {
    render(<LandingApp />)

    expect(screen.getByRole('img', {name: 'Интерфейс строительной площадки Форум'})).toHaveAttribute(
      'src',
      expect.stringContaining('hero-illustration-process-interface-v1'),
    )
    expect(screen.getByRole('img', {name: 'Заказчик со строительной сметой'})).toHaveAttribute(
      'src',
      expect.stringContaining('audience-customer'),
    )
    expect(screen.getByRole('img', {name: 'Логотип Rentaero'})).toBeInTheDocument()
    const demo = screen.getByRole('region', {name: 'Посмотрите «Форум» в работе'})
    expect(within(demo).getByRole('link', {name: 'Выбрать время'})).toHaveAttribute('href', 'https://cal.astforum.ru/demo/60min')
  })
})

describe('landing auth dialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
  })

  it('shows provider errors after the callback so login can be retried', () => {
    window.history.replaceState({}, '', '/?auth_error=access_denied')
    render(<LandingApp />)

    expect(screen.getByRole('dialog', {name: 'Войти в аккаунт'})).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Вы отменили вход через Сбер ID')
    expect(window.location.search).toBe('')
  })

  it('shows the authenticated user and clears the session after logout', async () => {
    vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? new Response(null, {status: 204})
      : new Response(JSON.stringify({user: {id: 'user-1', displayName: 'Анна Иванова'}}), {status: 200}))
    render(<LandingApp />)

    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: 'Войти'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Выйти'}))
    expect(await screen.findByRole('link', {name: 'Войти'})).toBeInTheDocument()
    expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument()
  })

  it('opens the individual registration dialog from the landing call to action', () => {
    render(<LandingApp />)

    fireEvent.click(screen.getByRole('link', {name: 'Регистрация'}))

    const dialog = screen.getByRole('dialog', {name: 'Создайте аккаунт'})
    expect(within(dialog).getByLabelText('Физическое лицо')).toBeChecked()
    expect(within(dialog).getByRole('link', {name: 'Зарегистрироваться по Сбер ID'})).toHaveAttribute(
      'href',
      '/auth/sber-id/start?intent=register&subject=individual',
    )

    fireEvent.click(within(dialog).getByRole('button', {name: 'Закрыть окно авторизации'}))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('switches the registration provider and subject when the account type changes', () => {
    render(<LandingApp />)

    fireEvent.click(screen.getByRole('link', {name: 'Регистрация'}))

    const dialog = within(screen.getByRole('dialog', {name: 'Создайте аккаунт'}))
    const cases = [
      {
        accountType: 'Юридическое лицо',
        provider: 'Подтвердить через Контур.Диадок',
        href: '/auth/diadoc/start?intent=register&subject=legal',
      },
      {
        accountType: 'Индивидуальный предприниматель',
        provider: 'Подтвердить через Контур.Диадок',
        href: '/auth/diadoc/start?intent=register&subject=entrepreneur',
      },
      {
        accountType: 'Физическое лицо',
        provider: 'Зарегистрироваться по Сбер ID',
        href: '/auth/sber-id/start?intent=register&subject=individual',
      },
    ]

    for (const {accountType, provider, href} of cases) {
      fireEvent.click(dialog.getByText(accountType))

      expect(dialog.getByRole('radio', {name: accountType})).toBeChecked()
      expect(dialog.getAllByRole('radio', {checked: true})).toHaveLength(1)
      expect(dialog.getAllByRole('link')).toHaveLength(1)
      expect(dialog.getByRole('link', {name: provider})).toHaveAttribute('href', href)
    }
  })

  it('opens the login dialog with Sber ID and Diadoc entry points from the header', () => {
    render(<LandingApp />)

    fireEvent.click(screen.getByRole('link', {name: 'Войти'}))

    const dialog = screen.getByRole('dialog', {name: 'Войти в аккаунт'})
    expect(within(dialog).getByRole('link', {name: 'Войти по Сбер ID'})).toHaveAttribute(
      'href',
      '/auth/sber-id/start?intent=login',
    )
    expect(within(dialog).getByRole('link', {name: 'Войти через Контур.Диадок'})).toHaveAttribute(
      'href',
      '/auth/diadoc/start?intent=login',
    )
  })
})
