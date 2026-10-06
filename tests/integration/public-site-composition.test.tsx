import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {App} from '../../deployment/audience-pages/src/App'
import {PublicAuth} from '../../deployment/public-auth/src/PublicAuth'

const customerTitle = 'Находите поставщиков и подрядчиков для ваших строительных объектов'
const pageTitle = 'Для заказчиков — АСТ Форум'
type Pending = {resolve: (response: Response) => void; signal?: AbortSignal}
let requests: Pending[]
let navigate: ReturnType<typeof vi.fn>
function mount(withAudience = true) {
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles>
    {withAudience && <App />}<PublicAuth navigate={navigate} />
  </BaseStyles></ThemeProvider>)
}
async function settle(index: number, status = 401) {
  await act(async () => {
    requests[index].resolve(new Response(status === 200 ? JSON.stringify({user:{id:'synthetic-user', displayName:'Тестовый участник'}}) : '', {status}))
  })
}
function customerHeading() {
  // The real Primer Dialog makes the background inert, so inspect its preserved
  // DOM as well as the accessible dialog rather than querying accessible roles.
  return screen.getByText(customerTitle, {selector:'h1'})
}
async function openLogin() {
  const opener = within(screen.getByRole('banner')).getByRole('link', {name:'Войти'})
  opener.focus()
  fireEvent.click(opener)
  await screen.findByRole('dialog', {name:'Войти в аккаунт'})
  return opener
}
async function traverse(direction: 'back' | 'forward', path: string) {
  await act(async () => {
    const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), {once:true}))
    history[direction]()
    await popped
  })
  expect(location.pathname).toBe(path)
}
beforeEach(() => {
  history.replaceState({foreign:{retained:42}}, '', '/customers/?campaign=fixture#benefits')
  requests=[]; navigate=vi.fn()
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    if (url !== '/api/auth/session') throw new Error('Unexpected network boundary')
    return new Promise<Response>(resolve => requests.push({resolve, signal:options?.signal}))
  }))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(window, 'scrollY', {configurable:true, value:640})
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe('actual audience + public authentication composition', () => {
  it('retains the customer DOM, title, focus and scroll when both pending session checks return 401, including Close, Back and Forward', async () => {
    mount()
    const heading=customerHeading()
    expect(requests).toHaveLength(1)
    const opener=await openLogin()
    expect(requests).toHaveLength(2)
    await settle(0)
    await settle(1)
    expect(customerHeading()).toBe(heading)
    expect(screen.queryByText('Страница не найдена')).not.toBeInTheDocument()
    expect(document.title).toBe(pageTitle)
    expect(location.pathname).toBe('/login')
    expect(screen.getByRole('button', {name:'Войти по Сбер ID'})).toBeEnabled()
    fireEvent.click(screen.getByRole('button', {name:'Закрыть окно'}))
    await waitFor(() => expect(location.pathname).toBe('/customers/'))
    expect(location.search+location.hash).toBe('?campaign=fixture#benefits')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(customerHeading()).toBe(heading)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(window.scrollY).toBe(640)
    expect(window.scrollTo).not.toHaveBeenCalled()
    await traverse('forward', '/login')
    expect(screen.getByRole('dialog', {name:'Войти в аккаунт'})).toBeInTheDocument()
    expect(customerHeading()).toBe(heading)
    await settle(2)
    await traverse('back', '/customers/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(customerHeading()).toBe(heading)
    expect(document.title).toBe(pageTitle)
    await waitFor(() => expect(opener).toHaveFocus())
  })
  it('replaces modal mode while preserving background URL, foreign history fields and one Back entry', async () => {
    mount(); const heading=customerHeading(); const opener=await openLogin()
    const length=history.length
    const background=history.state.publicAuthBackground
    expect(background).toBe('/customers/?campaign=fixture#benefits')
    expect(history.state.foreign).toEqual({retained:42})
    fireEvent.click(screen.getByRole('link', {name:'Зарегистрироваться'}))
    expect(location.pathname).toBe('/register')
    expect(screen.getByRole('dialog', {name:'Создайте аккаунт'})).toBeInTheDocument()
    expect(history.length).toBe(length)
    expect(history.state.publicAuthBackground).toBe(background)
    expect(history.state.foreign).toEqual({retained:42})
    await settle(0); await settle(2)
    expect(customerHeading()).toBe(heading)
    expect(document.title).toBe(pageTitle)
    await traverse('back', '/customers/')
    expect(history.state).toEqual({foreign:{retained:42}})
    await waitFor(() => expect(opener).toHaveFocus())
    await traverse('forward', '/register')
    expect(screen.getByRole('dialog', {name:'Создайте аккаунт'})).toBeInTheDocument()
    expect(customerHeading()).toBe(heading)
    expect(navigate).not.toHaveBeenCalled()
  })
  it.each([401,500,200])('keeps the background through audience and auth session response %s', async status => {
    mount(); const heading=customerHeading(); await openLogin()
    await settle(0,status); await settle(1,status)
    expect(customerHeading()).toBe(heading)
    expect(screen.queryByText('Страница не найдена')).not.toBeInTheDocument()
    expect(document.title).toBe(pageTitle)
    const dialog=screen.getByRole('dialog', {name:'Войти в аккаунт'})
    if (status===200) expect(within(dialog).getByText('Вы уже вошли в аккаунт')).toBeInTheDocument()
    else expect(within(dialog).getByRole('button', {name:'Войти по Сбер ID'})).toHaveProperty('disabled',status!==401)
  })
  it('restores the persisted modal background when both apps remount at the modal URL', async () => {
    history.replaceState({publicAuth:true, publicAuthBackground:'/customers/?campaign=fixture#benefits', foreign:'keep'}, '', '/login')
    mount(); await settle(0); await settle(1)
    expect(customerHeading()).toBeInTheDocument()
    expect(screen.getByRole('dialog', {name:'Войти в аккаунт'})).toBeInTheDocument()
    expect(history.state.foreign).toBe('keep')
    expect(document.title).toBe(pageTitle)
  })
  it('updates the actual audience route on popstate without relying on a session rerender', async () => {
    mount(); await settle(0)
    history.pushState({foreign:'supplier'}, '', '/suppliers/')
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate', {state:history.state})))
    expect(screen.getByRole('heading', {level:1, name:'Находите новые заказы для вашей компании'})).toBeInTheDocument()
    expect(document.title).toBe('Для поставщиков и подрядчиков — АСТ Форум')
  })
})

describe('standalone and history validation', () => {
  it.each(['/login','/register'])('keeps direct %s standalone and foreign history fields during mode switches', async path => {
    history.replaceState({foreign:'keep'}, '', path+'?returnTo=https://outside.invalid')
    mount(false); await settle(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(history.state).toEqual({foreign:'keep'})
    expect(location.search).toBe('')
    fireEvent.click(screen.getByRole('link', {name:path==='/login'?'Зарегистрироваться':'Войти'}))
    expect(location.pathname).toBe(path==='/login'?'/register':'/login')
    expect(history.state).toEqual({foreign:'keep'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it.each(['https://outside.invalid/customers/','//outside.invalid/customers/','/register'])('rejects invalid modal background %s', async background => {
    history.replaceState({publicAuth:true,publicAuthBackground:background,foreign:'keep'}, '', '/login')
    mount(false); await settle(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', {name:'Войти в аккаунт'})).toBeInTheDocument()
    expect(history.state.foreign).toBe('keep')
  })
})
