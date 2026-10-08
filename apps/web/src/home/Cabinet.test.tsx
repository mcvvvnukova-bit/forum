import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {Cabinet} from './Cabinet'

afterEach(() => vi.unstubAllGlobals())
const user = {id:'owner-one',displayName:'Анна Иванова'}
const profile = {family_name:'Иванова',given_name:'Анна',email:'owner@example.test',place_of_work:'Настоящее место работы'}
function page(path='/cabinet/') {
  history.replaceState(null,'',path)
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet/></BaseStyles></ThemeProvider>)
}
function mockProfile(status=200) {
  return vi.fn(async (url: string) => url==='/api/auth/session'
    ? Response.json({user,roles:['individual']})
    : status===200 ? Response.json({userId:user.id,profile}) : new Response('',{status}))
}
describe('authenticated profile',()=>{
  it('opens approved personal cards with only the session owner data',async()=>{
    const fetcher=mockProfile();vi.stubGlobal('fetch',fetcher);page()
    expect(await screen.findByRole('heading',{name:'Личные данные',level:1})).toBeVisible()
    expect(await screen.findByText('owner@example.test')).toBeVisible()
    expect(screen.getAllByText('Не передано').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Смирнов|Демонстрационный профиль/)).not.toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Работа'})).toHaveAttribute('href','/cabinet/work/#main')
    expect(fetcher.mock.calls.some(([url])=>url==='/api/profile')).toBe(true)
  })
  it('shows the work cards on a direct work route',async()=>{
    vi.stubGlobal('fetch',mockProfile());page('/cabinet/work/')
    expect(await screen.findByRole('heading',{name:'Работа',level:1})).toBeVisible()
    expect(await screen.findByText('Настоящее место работы')).toBeVisible()
    expect(screen.queryByRole('region',{name:'Паспорт'})).not.toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Личные данные'})).toHaveAttribute('href','/cabinet/#personal')
  })
  it('offers retry without substituting fixtures when profile request fails',async()=>{
    vi.stubGlobal('fetch',mockProfile(503));page()
    expect(await screen.findByText('Не удалось загрузить профиль')).toBeVisible()
    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument()
    vi.stubGlobal('fetch',mockProfile());fireEvent.click(screen.getAllByRole('button',{name:'Повторить'})[0])
    expect(await screen.findByText('owner@example.test')).toBeVisible()
  })
  it('clears the cabinet on an expired profile session',async()=>{
    let expired=false
    vi.stubGlobal('fetch',async(url:string)=>{if(url==='/api/auth/session')return expired?new Response('',{status:401}):Response.json({user});expired=true;return new Response('',{status:401})});page()
    await waitFor(()=>expect(location.pathname).toBe('/'))
    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument()
  })
  it('refuses a response for another user',async()=>{
    vi.stubGlobal('fetch',async(url:string)=>url==='/api/auth/session'?Response.json({user}):Response.json({userId:'other',profile}));page()
    expect(await screen.findByText('Не удалось загрузить профиль')).toBeVisible()
    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument()
  })
  it('opens the mobile navigation and restores the opener after closing',async()=>{
    vi.stubGlobal('fetch',mockProfile());page()
    await screen.findByText('owner@example.test')
    const opener=screen.getByRole('button',{name:'Открыть меню профиля'});fireEvent.click(opener)
    const dialog=screen.getByRole('dialog',{name:'Разделы профиля'})
    expect(within(dialog).getByRole('link',{name:'Работа'})).toHaveAttribute('href','/cabinet/work/#main')
    fireEvent.click(within(dialog).getByRole('button',{name:'Close'}))
    await waitFor(()=>expect(opener).toHaveFocus())
  })
  it('preserves data and offers a clear warning when logout fails',async()=>{
    vi.stubGlobal('fetch',async(url:string)=>url==='/api/auth/logout'?new Response('',{status:503}):mockProfile()(url));page()
    await screen.findByText('owner@example.test')
    fireEvent.click(screen.getByRole('button',{name:'Выйти'}))
    expect(await screen.findByText('Не удалось выйти. Повторите попытку')).toBeVisible()
    expect(screen.getByText('owner@example.test')).toBeVisible()
  })
  it('revokes the session and navigates to the public homepage after logout',async()=>{
    let loggedIn=true
    vi.stubGlobal('fetch',async(url:string)=>{
      if(url==='/api/auth/logout'){loggedIn=false;return new Response(null,{status:204})}
      if(!loggedIn)return new Response('',{status:401})
      return mockProfile()(url)
    })
    const navigate=vi.fn();history.replaceState(null,'','/cabinet/')
    render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet navigate={navigate}/></BaseStyles></ThemeProvider>)
    await screen.findByText('owner@example.test')
    fireEvent.click(screen.getByRole('button',{name:'Выйти'}))
    await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/'))
    await waitFor(()=>expect(screen.queryByRole('heading',{name:'Личные данные',level:1})).not.toBeInTheDocument())
    expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument()
  })
})
