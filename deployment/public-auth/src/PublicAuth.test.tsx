import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {PublicAuth} from './PublicAuth'
function mount(navigate = vi.fn()) {
  render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><PublicAuth navigate={navigate} /></BaseStyles></ThemeProvider>)
  return navigate
}
beforeEach(() => {
  history.replaceState(null, '', '/')
  sessionStorage.clear()
  vi.stubGlobal('fetch', async () => new Response('', {status: 401}))
})
afterEach(() => {vi.unstubAllGlobals(); document.querySelector('[data-fixture]')?.remove()})
function trigger() {
  const a = document.createElement('a'); a.href='/auth/sber-id/start?intent=login'; a.textContent='Войти'; a.dataset.fixture='true'; document.body.append(a); return a
}
describe('public authentication', () => {
  it('opens header login over its public page and uses a bookmarkable URL', async () => {
    const a = trigger(); mount()
    fireEvent.click(a)
    expect(await screen.findByRole('dialog', {name: 'Войти в аккаунт'})).toBeInTheDocument()
    expect(location.pathname).toBe('/login')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', {name: 'Войти по Сбер ID'})).toBeEnabled()
  })
  it('switches mode without starting IAM, then submits only registration parameters once', async () => {
    history.replaceState(null, '', '/login'); sessionStorage.setItem('forum.public.intent', '{"action":"find-jobs"}')
    const navigate=mount()
    fireEvent.click(await screen.findByRole('link', {name:'Зарегистрироваться'}))
    expect(location.pathname).toBe('/register')
    expect(screen.getByRole('heading', {name:'Создайте аккаунт'})).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    const button=await screen.findByRole('button', {name:'Зарегистрироваться через Сбер ID'})
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button); fireEvent.click(button)
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/auth/sber-id/start?intent=register&subject=individual')
    expect(sessionStorage.getItem('forum.public.intent')).toBeNull()
    expect(button).toBeDisabled()
  })
  it('renders a standalone form on a direct registration URL', async () => {
    history.replaceState(null, '', '/register?returnTo=https://outside.invalid')
    mount()
    expect(screen.getByRole('heading', {name:'Создайте аккаунт'})).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('link', {name:'АСТ Форум'})).toHaveAttribute('href','/')
    expect(location.search).toBe('')
    expect(await screen.findByRole('button', {name:'Зарегистрироваться через Сбер ID'})).toBeEnabled()
  })
  it('shows a retry when the session cannot be verified instead of enabling IAM', async () => {
    history.replaceState(null, '', '/login')
    vi.stubGlobal('fetch', async () => new Response('', {status:500}))
    mount()
    expect(await screen.findByText('Не удалось проверить вход. Повторите попытку')).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Войти по Сбер ID'})).toBeDisabled()
    vi.stubGlobal('fetch', async () => new Response('', {status:401}))
    fireEvent.click(screen.getByRole('button', {name:'Повторить'}))
    await waitFor(() => expect(screen.getByRole('button', {name:'Войти по Сбер ID'})).toBeEnabled())
  })
  it('does not claim success from query and safely renders callback errors', async () => {
    history.replaceState(null, '', '/?auth=success&auth_error=access_denied&error_description=%3Cscript%3E')
    mount()
    expect(await screen.findByText('Вы отменили подтверждение. Можно попробовать ещё раз')).toBeInTheDocument()
    expect(screen.queryByText('Вы уже вошли в аккаунт')).not.toBeInTheDocument()
    expect(location.search).toBe('')
  })
  it.each(['account_deactivated','account_conflict'])('blocks registration bypass for %s', async code => {
    history.replaceState(null, '', '/login?auth_error='+code); mount()
    expect(await screen.findByRole('link', {name:'Тех. поддержка'})).toHaveAttribute('href','mailto:info@astforum.ru')
    expect(screen.queryByRole('link', {name:'Зарегистрироваться'})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Войти по Сбер ID'})).toBeDisabled()
  })
  it('treats sber unavailability as a disabled provider with manual retry', async () => {
    history.replaceState(null, '', '/register?auth_error=sber_unavailable'); mount()
    expect(await screen.findByText('Регистрация через Сбер ID пока недоступна')).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Зарегистрироваться через Сбер ID'})).toBeDisabled()
    expect(screen.getByRole('link', {name:'Записаться на демо'})).toHaveAttribute('href', '/#demo')
  })
  it('closes a modal after Back and retains public content', async () => {
    const a=trigger(); mount(); fireEvent.click(a)
    await screen.findByRole('dialog')
    await act(async () => {history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'))})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(a).toBeInTheDocument()
  })
})

it('preserves page anchors while opening and switching the auth dialog', async () => {
  const a=trigger(); const section=document.createElement('a'); section.href='#demo'; section.textContent='Демо'; a.append(section)
  mount(); fireEvent.click(a); await screen.findByRole('dialog')
  await act(async () => {await Promise.resolve()})
  expect(section.getAttribute('href')).toBe('#demo')
  fireEvent.click(screen.getByRole('link',{name:'Зарегистрироваться'}));
  await act(async () => {await Promise.resolve()})
  expect(section.getAttribute('href')).toBe('#demo')
})
it('retries a completed provider attempt on explicit retry exactly once', async () => {
  history.replaceState(null, '', '/login?auth_error=access_denied'); const navigate=mount()
  await waitFor(() => expect(screen.getByRole('button',{name:'Войти по Сбер ID'})).toBeEnabled())
  const retry=screen.getByRole('button',{name:'Повторить'}); fireEvent.click(retry); fireEvent.click(retry)
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/auth/sber-id/start?intent=login')
})
