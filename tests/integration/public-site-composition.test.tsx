import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {App} from '../../apps/web/src/audience/App'
import {App as HomeApp} from '../../apps/web/src/home/App'
import {PublicAuth} from '../../apps/web/src/auth/PublicAuth'

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
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()})

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

describe('work examples and modal hash restoration', () => {
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  let scroll: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scroll=vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {configurable:true, value:scroll})
    history.replaceState({foreign:'work-fixture'}, '', '/work/#order-example')
  })
  afterEach(() => {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })
  it.each(['Close','Back'])('keeps scroll and the independently selected carousel slide through %s and Forward', async action => {
    mount(); await settle(0)
    expect(scroll).toHaveBeenCalledExactlyOnceWith({block:'start'})
    const slide=document.getElementById('work-example-slide')!
    fireEvent.click(screen.getByRole('button', {name:'Следующий пример'}))
    expect(slide).toHaveAttribute('aria-label', '2 из 2: Работа в штате')
    scroll.mockClear()
    const opener=await openLogin(); await settle(1)
    expect(scroll).not.toHaveBeenCalled()
    if (action==='Close') {
      await act(async () => {
        const restored=new Promise<void>(resolve => window.addEventListener('hashchange', () => resolve(), {once:true}))
        fireEvent.click(screen.getByRole('button', {name:'Закрыть окно'}))
        await restored
      })
    } else await traverse('back', '/work/')
    expect(location.hash).toBe('#order-example')
    expect(document.getElementById('work-example-slide')).toBe(slide)
    expect(scroll).not.toHaveBeenCalled()
    expect(slide).toHaveAttribute('aria-label', '2 из 2: Работа в штате')
    await waitFor(() => expect(opener).toHaveFocus())
    await traverse('forward', '/login')
    expect(scroll).not.toHaveBeenCalled()
    expect(slide).toHaveAttribute('aria-label', '2 из 2: Работа в штате')
    await settle(2)
    await traverse('back', '/work/')
    expect(location.hash).toBe('#order-example')
    expect(scroll).not.toHaveBeenCalled()
    expect(slide).toHaveAttribute('aria-label', '2 из 2: Работа в штате')
  })
  it('keeps normal #job-example, #order-example and #skills navigation and carousel controls', async () => {
    history.replaceState(null, '', '/work/')
    mount(); await settle(0)
    expect(scroll).not.toHaveBeenCalled()
    for (const [hash, label] of [['#job-example','2 из 2: Работа в штате'], ['#order-example','1 из 2: Заказы и подработка'], ['#skills','1 из 2: Заказы и подработка']]) {
      scroll.mockClear()
      await act(async () => {
        const changed=new Promise<void>(resolve => window.addEventListener('hashchange', () => resolve(), {once:true}))
        location.hash=hash
        await changed
      })
      expect(location.hash).toBe(hash)
      expect(document.getElementById('work-example-slide')).toHaveAttribute('aria-label', label)
      expect(scroll).toHaveBeenCalledExactlyOnceWith({block:'start'})
    }
    scroll.mockClear()
    fireEvent.click(screen.getByRole('button', {name:'Следующий пример'}))
    expect(document.getElementById('work-example-slide')).toHaveAttribute('aria-label', '2 из 2: Работа в штате')
    fireEvent.click(screen.getByRole('button', {name:'Предыдущий пример'}))
    expect(document.getElementById('work-example-slide')).toHaveAttribute('aria-label', '1 из 2: Заказы и подработка')
    expect(scroll).not.toHaveBeenCalled()
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


describe('actual homepage + public authentication composition', () => {
  const homeTitle = 'Заказы, исполнители и работа в строительстве'
  const background = '/?campaign=fixture#rules'
  function mountHome() {
    return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles>
      <HomeApp /><PublicAuth navigate={navigate} />
    </BaseStyles></ThemeProvider>)
  }
  function homeHeading() {return screen.getByText(homeTitle, {selector:'h1'})}
  function retainedHome(heading: HTMLElement) {
    expect(homeHeading()).toBe(heading)
    expect(screen.queryByText('Страница не найдена')).not.toBeInTheDocument()
    expect(history.state.publicAuthBackground).toBe(background)
  }
  beforeEach(() => {
    vi.stubEnv('VITE_FORUM_SESSION', 'true')
    history.replaceState({foreign:{retained:42}}, '', background)
  })
  it.each([
    ['login', 'Close'], ['login', 'Back'], ['register', 'Close'], ['register', 'Back'],
  ])('retains the homepage through pending successful session, %s modal, %s and Forward', async (mode, action) => {
    mountHome(); const heading=homeHeading()
    expect(requests).toHaveLength(1)
    if (mode==='login') await openLogin()
    else {
      fireEvent.click(screen.getByRole('link', {name:'Начать работу'}))
      await screen.findByRole('dialog', {name:'Создайте аккаунт'})
    }
    expect(location.pathname).toBe('/'+mode)
    retainedHome(heading)
    await settle(0,200)
    retainedHome(heading)
    // The independent auth session stays guest, so provider controls remain testable.
    await settle(1)
    expect(screen.getByRole('button', {name:mode==='login'?'Войти по Сбер ID':'Зарегистрироваться по Сбер ID'})).toBeEnabled()
    if (action==='Close') {
      fireEvent.click(screen.getByRole('button', {name:'Закрыть окно'}))
      await waitFor(() => expect(location.pathname+location.search+location.hash).toBe(background))
    } else await traverse('back', '/')
    expect(location.pathname+location.search+location.hash).toBe(background)
    expect(homeHeading()).toBe(heading)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await traverse('forward', '/'+mode)
    retainedHome(heading)
    expect(screen.getByRole('dialog', {name:mode==='login'?'Войти в аккаунт':'Создайте аккаунт'})).toBeInTheDocument()
    await settle(2)
    await traverse('back', '/')
    expect(homeHeading()).toBe(heading)
    expect(location.pathname+location.search+location.hash).toBe(background)
    expect(navigate).not.toHaveBeenCalled()
  })
  it('retains the homepage when switching modes before its successful session resolves', async () => {
    mountHome(); const heading=homeHeading(); await openLogin()
    const length=history.length
    fireEvent.click(screen.getByRole('link', {name:'Зарегистрироваться'}))
    expect(location.pathname).toBe('/register')
    expect(history.length).toBe(length)
    await settle(0,200); await settle(2)
    retainedHome(heading)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', {name:'Войти'}))
    expect(location.pathname).toBe('/login')
    await settle(3)
    retainedHome(heading)
    expect(history.state.foreign).toEqual({retained:42})
    await traverse('back', '/')
    expect(homeHeading()).toBe(heading)
    await traverse('forward', '/login')
    retainedHome(heading)
    expect(screen.getByRole('dialog', {name:'Войти в аккаунт'})).toBeInTheDocument()
  })
  it.each([401,500])('retains guest/error homepage behavior when both sessions return %s', async status => {
    mountHome(); const heading=homeHeading(); await openLogin()
    await settle(0,status); await settle(1,status)
    retainedHome(heading)
    expect(within(screen.getByRole('banner', {hidden:true})).getByRole('link', {name:'Войти', hidden:true})).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Войти по Сбер ID'})).toHaveProperty('disabled',status!==401)
  })
  it.each(['/login','/register'])('restores the saved homepage background on remount at %s', async path => {
    history.replaceState({publicAuth:true,publicAuthBackground:background}, '', path)
    mountHome(); const heading=homeHeading()
    await settle(0,200); await settle(1)
    retainedHome(heading)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('uses the effective background query for the documented local preview state', async () => {
    vi.stubEnv('VITE_FORUM_SESSION', 'false')
    history.replaceState({publicAuth:true,publicAuthBackground:'/?previewSession=authorized'}, '', '/login')
    mountHome(); await settle(0)
    expect(homeHeading()).toBeInTheDocument()
    expect(within(screen.getByRole('banner', {hidden:true})).getByRole('link', {name:'В кабинет', hidden:true})).toBeInTheDocument()
    expect(screen.getByRole('dialog', {name:'Войти в аккаунт'})).toBeInTheDocument()
  })
  it('updates genuine homepage destinations on popstate without a session rerender', async () => {
    mountHome(); await settle(0)
    history.pushState({foreign:'destination'}, '', '/privacy/')
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate', {state:history.state})))
    expect(screen.getByRole('heading', {level:1, name:'Политика обработки персональных данных'})).toBeInTheDocument()
    await traverse('back', '/')
    expect(homeHeading()).toBeInTheDocument()
  })
  it.each(['/authorization/','/unknown/'])('preserves genuine standalone destination %s', async path => {
    history.replaceState({foreign:'destination'}, '', path)
    mountHome(); await settle(0,200)
    expect(screen.getByRole('heading', {level:1})).toHaveTextContent(path==='/authorization/'?'Вход и регистрация':'Страница не найдена')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
