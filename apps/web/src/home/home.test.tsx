import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {App} from './App'
import {SessionProvider} from '../SessionProvider'

afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals()})

function renderPage(url = '/', sharedSession = false) {
  window.history.replaceState(null, '', url)
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles>{sharedSession ? <SessionProvider><App /></SessionProvider> : <App />}</BaseStyles></ThemeProvider>)
}

describe('PUB.01.01.01', () => {
  it('opens the cabinet from a real session and shows the assigned individual role', async () => {
    vi.stubGlobal('fetch', async () => Response.json({user:{id:'person-one',displayName:'Анна Иванова'},roles:['individual']}))
    renderPage('/cabinet/?auth=success')
    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument()
    expect(screen.getByText('Физлицо')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Выйти'})).toBeInTheDocument()
    expect(screen.queryByText('В этой локальной версии вход и создание учётной записи не подключены.')).not.toBeInTheDocument()
  })
  it('returns a confirmed guest cabinet visit to the homepage', async () => {
    vi.stubGlobal('fetch',async () => new Response('',{status:401}))
    renderPage('/cabinet/?auth=success', true)
    expect(await screen.findByRole('heading',{name:'Заказы, исполнители и работа в строительстве'})).toBeInTheDocument()
    expect(location.pathname).toBe('/')
    expect(location.search).toBe('')
    expect(screen.queryByRole('heading',{name:'Личный кабинет'})).not.toBeInTheDocument()
    expect(screen.queryByText('Войдите через Сбер ID, чтобы открыть личный кабинет')).not.toBeInTheDocument()
    expect(screen.queryByText('Физлицо')).not.toBeInTheDocument()
  })
  it('returns successful logout to the homepage with a guest header', async () => {
    let loggedIn=true
    vi.stubGlobal('fetch',async (url: string, init?: RequestInit) => {
      if (url==='/api/auth/logout' && init?.method==='POST') {loggedIn=false;return new Response(null,{status:204})}
      return loggedIn ? Response.json({user:{id:'person-one',displayName:'Анна Иванова'},roles:['individual']}) : new Response('',{status:401})
    })
    renderPage('/cabinet/', true)
    fireEvent.click(await screen.findByRole('button',{name:'Выйти'}))
    expect(await screen.findByRole('heading',{name:'Заказы, исполнители и работа в строительстве'})).toBeInTheDocument()
    expect(location.pathname).toBe('/')
    expect(screen.getByRole('link',{name:'Войти'})).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:'В кабинет'})).not.toBeInTheDocument()
    expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument()
    expect(screen.queryByText('Физлицо')).not.toBeInTheDocument()
    expect(screen.queryByText('Войдите через Сбер ID, чтобы открыть личный кабинет')).not.toBeInTheDocument()
  })
  it('keeps the authenticated cabinet when logout fails', async () => {
    vi.stubGlobal('fetch',async (url:string) => url==='/api/auth/logout' ? new Response('',{status:503}) : Response.json({user:{id:'person-one',displayName:'Анна Иванова'},roles:['individual']}))
    renderPage('/cabinet/',true)
    fireEvent.click(await screen.findByRole('button',{name:'Выйти'}))
    expect(await screen.findByText('Не удалось выйти. Повторите попытку')).toBeInTheDocument()
    expect(location.pathname).toBe('/cabinet/')
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Выйти'})).toBeEnabled()
  })
  it('offers a retry when the cabinet session endpoint is unavailable', async () => {
    vi.stubGlobal('fetch',async () => new Response('',{status:503}))
    renderPage('/cabinet/')
    expect(await screen.findByText('Не удалось проверить вход')).toBeInTheDocument()
    vi.stubGlobal('fetch',async () => Response.json({user:{id:'person-one',displayName:'Анна Иванова'},roles:['individual']}))
    fireEvent.click(screen.getByRole('button',{name:'Повторить'}))
    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument()
  })
  it('does not trust the preview query as a live authenticated session', () => {
    vi.stubEnv('VITE_FORUM_SESSION', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false}))
    renderPage('/?previewSession=authorized&auth_error=__proto__')
    expect(screen.getByRole('link', {name: 'Войти'})).toBeInTheDocument()
    expect(screen.queryByRole('link', {name: 'В кабинет'})).not.toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Заказы, исполнители и работа в строительстве')
  })

  it('retries login for an obsolete registration-required callback', () => {
    vi.stubEnv('VITE_FORUM_SESSION', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false}))
    renderPage('/?auth_error=registration_required')
    expect(screen.getByRole('link', {name: 'Повторить вход'})).toHaveAttribute('href','/login')
    expect(screen.getByText('Не удалось завершить вход. Повторите вход через Сбер ID.')).toBeInTheDocument()
  })
  it('preserves required section order, headline, metrics and company contacts', () => {
    const {container} = renderPage()
    expect([...container.querySelectorAll('[data-section]')].map(element => element.getAttribute('data-section')))
      .toEqual(['hero', 'audiences', 'metrics', 'rules', 'demo', 'partners', 'faq'])
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Заказы, исполнители и работа в строительстве')
    for (const copy of ['28', '679 млн', '130', 'ИНН 9709128511', 'ОГРН 1257700433935']) expect(screen.getByText(copy)).toBeInTheDocument()
    expect(container.querySelectorAll('.partner-logo')).toHaveLength(13)
  })

  it('sends start and sign-in to the same auth screen, and maps the three audiences', () => {
    renderPage()
    expect(screen.getByRole('link', {name: 'Начать работу'})).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', {name: 'Войти'})).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', {name: 'Я заказчик'})).toHaveAttribute('href', '/customers/')
    expect(screen.getByRole('link', {name: 'Я подрядчик'})).toHaveAttribute('href', '/suppliers/')
    expect(screen.getByRole('link', {name: 'Я ищу работу'})).toHaveAttribute('href', '/work/')
    expect(screen.getByRole('link', {name: 'О платформе'})).toHaveAttribute('href', '/#rules')
  })

  it.each(['Записаться на демо', 'Выбрать время'])('opens the same booking widget from %s and closes with Escape', async name => {
    renderPage()
    const trigger = screen.getByRole('button', {name})
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', {name: 'Выберите удобное время'})
    expect(within(dialog).getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')).toHaveAttribute('src', expect.stringContaining('https://cal.astforum.ru/demo/60min'))
    fireEvent.keyDown(dialog, {key: 'Escape', code: 'Escape'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows the calendar failure actions and retries with a fresh frame', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', {name: 'Записаться на демо'}))
    const frame = screen.getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')
    fireEvent.error(frame)
    expect(screen.getByText('Не удалось загрузить календарь. Попробуйте ещё раз или откройте страницу записи')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Открыть страницу записи'})).toHaveAttribute('href', 'https://cal.astforum.ru/demo/60min')
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}))
    expect(screen.getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')).not.toBe(frame)
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка календаря…')
  })

  it('uses the required logged-in label in the explicit preview state', () => {
    renderPage('/?previewSession=authorized')
    expect(screen.getByRole('link', {name: 'В кабинет'})).toHaveAttribute('href', '/cabinet/')
    expect(screen.queryByRole('link', {name: 'Войти'})).not.toBeInTheDocument()
  })

  it('opens a local destination without fabricating accounts or legal text', () => {
    renderPage('/authorization/')
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Вход и регистрация')
    expect(screen.getByText('В этой локальной версии вход и создание учётной записи не подключены.')).toBeInTheDocument()
  })
})
