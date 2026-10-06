import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {CustomerLanding} from './CustomerLanding'

function show(destinations?: {registration?: string; newOrder?: string}) {
  return render(<ThemeProvider colorMode="light"><BaseStyles><CustomerLanding destinations={destinations} /></BaseStyles></ThemeProvider>)
}

beforeEach(() => {
  // jsdom has no layout observer; real browser checks cover dialog overflow.
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}})
  sessionStorage.clear()
  window.history.replaceState({}, '', '/customers/')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 401}))
})

describe('CustomerLanding action boundaries', () => {
  it('starts with company registration and preserves intent when closed', async () => {
    show({registration: '/register/company'})
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Разместить заказ'})[0]).toBeEnabled())
    const trigger = screen.getAllByRole('button', {name: 'Разместить заказ'})[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', {name: 'Регистрация компании-заказчика'})
    expect(within(dialog).getByRole('radio', {name: 'Юридическое лицо'})).toBeChecked()
    expect(within(dialog).queryByText(/Сбер ID/)).not.toBeInTheDocument()
    const href = within(dialog).getByRole('link', {name: 'Продолжить через Контур.Диадок'}).getAttribute('href')!
    expect(new URL(href, window.location.origin).searchParams.get('audience')).toBe('customer')
    expect(new URL(href, window.location.origin).searchParams.get('next')).toBe('create-order')
    fireEvent.click(within(dialog).getByRole('button', {name: 'Close'}))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(JSON.parse(sessionStorage.getItem('forum.customer-intent')!)).toEqual({audience: 'customer', action: 'create-order', returnTo: '/customers/'})
  })

  it('never silently turns a provider into a customer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({user: {id: 'u1', displayName: 'Участник'}, participant: {id: 'p1', role: 'provider', status: 'active'}})}))
    show({registration: '/register/company', newOrder: '/orders/new'})
    await screen.findByRole('button', {name: 'В кабинет'})
    fireEvent.click(screen.getAllByRole('button', {name: 'Разместить заказ'})[0])
    const dialog = await screen.findByRole('dialog', {name: 'Выберите участника-заказчика'})
    expect(within(dialog).getByText(/Текущий участник работает как исполнитель/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', {name: 'Создать заказ'})).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', {name: 'Зарегистрировать компанию-заказчика'})).toBeInTheDocument()
  })

  it('continues in a known active customer context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({user: {id: 'u1', displayName: 'Заказчик'}, participant: {id: 'customer-1', role: 'customer', status: 'active'}})}))
    show({newOrder: '/orders/new'})
    await screen.findByRole('button', {name: 'В кабинет'})
    await waitFor(() => expect(screen.getAllByRole('link', {name: 'Разместить заказ'})[0]).toHaveAttribute('href', '/orders/new?participant=customer-1&audience=customer&next=create-order&returnTo=%2Fcustomers%2F'))
  })

  it('does not send visitors to an unavailable registration endpoint', async () => {
    show()
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Разместить заказ'})[0]).toBeEnabled())
    fireEvent.click(screen.getAllByRole('button', {name: 'Разместить заказ'})[0])
    const dialog = await screen.findByRole('dialog', {name: 'Регистрация компании-заказчика'})
    expect(within(dialog).getByText(/Регистрация компаний пока недоступна/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', {name: 'Продолжить через Контур.Диадок'})).not.toBeInTheDocument()
    expect(within(dialog).getByRole('link', {name: 'Записаться на демо'}).getAttribute('href')).toContain('audience=')
  })

  it('keeps FAQ public and sends the customer audience to booking', () => {
    show()
    expect(screen.getByRole('heading', {level: 1, name: 'Находите поставщиков и подрядчиков для ваших строительных объектов'})).toBeInTheDocument()
    const question = screen.getByText('Кто увидит мою смету?')
    expect(question.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(question.closest('summary')!)
    expect(screen.getByText(/Полная смета и внутренние сведения проекта не становятся публичными/)).toBeInTheDocument()
    const demo = screen.getByRole('region', {name: 'Посмотрите «Форум» в работе'})
    // The responsive stylesheet hides <br>; the adjacent words must stay separated.
    expect(within(demo).getByText(/За час покажем сценарии/)).toHaveTextContent('подскажем, как запустить работу')
    const url = new URL(within(demo).getByRole('link', {name: 'Выбрать время'}).getAttribute('href')!)
    expect(url.hostname).toBe('cal.astforum.ru')
    expect(url.searchParams.get('audience')).toBe('Заказчик')
    expect(url.searchParams.get('notes')).toContain('Аудитория: Заказчик')
  })
})
