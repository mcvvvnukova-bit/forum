import {fireEvent, render, screen} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {LandingApp} from './LandingApp'

const {getCalApi} = vi.hoisted(() => ({getCalApi: vi.fn()}))

vi.mock('@calcom/embed-react', () => ({getCalApi}))

beforeEach(() => {
  vi.clearAllMocks()
  document.querySelectorAll('script[src="https://cal.astforum.ru/embed/embed.js"]').forEach((script) => script.remove())
})

describe('LandingApp', () => {
  it('renders the Figma landing sections and primary actions', () => {
    render(<LandingApp />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 1, name: 'Форум'})).toBeInTheDocument()
    expect(screen.getByText('электронная строительная площадка')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Начать работу'})).toHaveAttribute('href', '/register')
    expect(screen.getAllByRole('link', {name: 'Записаться на демо'})[0]).toHaveAttribute('href', '#demo')

    expect(screen.getByRole('heading', {level: 2, name: /Одна площадка для всех/})).toBeInTheDocument()
    expect(screen.getByText('Заказчик')).toBeInTheDocument()
    expect(screen.getByText('Поставщик')).toBeInTheDocument()
    expect(screen.getByText('Исполнитель')).toBeInTheDocument()
    expect(screen.getByText('Частный специалист')).toBeInTheDocument()

    expect(screen.getByText('679 млн')).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Посмотрите «Форум» в работе'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Нам доверяют'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Частые вопросы'})).toBeInTheDocument()
    expect(screen.getByText(/Зарегистрироваться могут юридические лица/)).toBeInTheDocument()
  })

  it('keeps a public booking link and intercepts a standard click for the native popup', async () => {
    const cal = vi.fn()
    getCalApi.mockImplementation(() => {
      const script = document.createElement('script')
      script.src = 'https://cal.astforum.ru/embed/embed.js'
      document.head.append(script)
      queueMicrotask(() => script.dispatchEvent(new Event('load')))
      return Promise.resolve(cal)
    })
    render(<LandingApp />)

    const link = screen.getByRole('link', {name: 'Выбрать время'})
    const click = new MouseEvent('click', {bubbles: true, cancelable: true})
    link.dispatchEvent(click)

    await vi.waitFor(() => {
      expect(cal).toHaveBeenLastCalledWith('modal', {
        calLink: 'demo/60min',
        calOrigin: 'https://cal.astforum.ru',
        config: {layout: 'month_view'},
      })
    })
    expect(link).toHaveAttribute('href', 'https://cal.astforum.ru/demo/60min')
    expect(click.defaultPrevented).toBe(true)
  })

  it('preserves modified booking-link clicks for normal browser navigation', () => {
    render(<LandingApp />)

    const link = screen.getByRole('link', {name: 'Выбрать время'})
    const href = link.getAttribute('href')
    link.removeAttribute('href')
    const click = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true})
    link.dispatchEvent(click)
    const navigationWasPreserved = !click.defaultPrevented
    link.setAttribute('href', href ?? '')

    expect(navigationWasPreserved).toBe(true)
    expect(getCalApi).not.toHaveBeenCalled()
  })
})
