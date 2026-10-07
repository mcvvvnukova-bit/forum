import {fireEvent, render, screen, within} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

function open(path: string) {window.history.replaceState({}, '', path); render(<ThemeProvider colorMode="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)}
beforeEach(() => {sessionStorage.clear()})
// Public entry CTA behavior is covered with the real auth controller in
// tests/integration/public-site-composition.test.tsx.
describe('Audience landing behavior', () => {
  it('cycles one visible work example forward and backward', () => {
    open('/work/')
    const carousel=screen.getByRole('region',{name:'Примеры работы и подработки'})
    expect(within(carousel).getAllByRole('group')).toHaveLength(1)
    expect(within(carousel).getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
    fireEvent.click(within(carousel).getByRole('button',{name:'Следующий пример'}))
    expect(within(carousel).getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
    expect(within(carousel).getAllByRole('group')).toHaveLength(1)
    fireEvent.click(within(carousel).getByRole('button',{name:'Следующий пример'}))
    expect(within(carousel).getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
    fireEvent.click(within(carousel).getByRole('button',{name:'Предыдущий пример'}))
    expect(within(carousel).getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
  })
  it('opens the legacy vacancy hash and responds to order hash navigation', () => {
    open('/work/#job-example')
    expect(screen.getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
    window.history.replaceState({}, '', '/work/#order-example')
    fireEvent(window,new Event('hashchange'))
    expect(screen.getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
  })
  it('keeps ordinary login available after closing a company action', () => {sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'customer',action:'create-order',returnTo:'/customers/'}));open('/participate/');expect(screen.getByRole('link',{name:'Войти через Сбер ID'})).toHaveAttribute('href','/auth/sber-id/start?intent=login');expect(screen.getByRole('link',{name:'Я ищу работу'})).toBeInTheDocument()})
  it('routes handoff navigation to an existing explanation', () => {open('/participate/');expect(screen.getByRole('link',{name:'О платформе'})).toHaveAttribute('href','/#rules')})
})
