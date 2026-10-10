import {fireEvent, cleanup, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {Cabinet} from './Cabinet'

afterEach(() => vi.unstubAllGlobals())
const user = {id:'owner-one',displayName:'Анна Иванова'}
const profile = {family_name:'Иванова',given_name:'Анна',email:'owner@example.test',place_of_work:'Настоящее место работы'}
function page(path='/cabinet/') {
  // jsdom has no layout; built-site E2E verifies the real scroll position.
  vi.stubGlobal('scrollTo',vi.fn())
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


it('renders saved extended profile fields and renewed login values',async()=>{
  let saved={...profile,middle_name:'Сергеевна',birthdate:'2000-02-29',gender:2,phone_number:'+79000000001',
    identification:{series:'1234',number:'555555',issued_date:'2020-03-02',issued_by:'Первый отдел',code:'123-456'},
    inn:{number:'123456789012'},snils:{number:'12345678901'},citizenship:{country_name:'Россия'},place_of_birth:'Тула',
    address_reg:{city:'Москва',street:'Первая'},address_of_actual_residence:{full_address:'Текущий адрес'},delivery_address:{full_address:'Доставка: Москва'},
    previous_family_name:'Петрова',previous_given_name:'Анна',previous_middle_name:'Павловна',previous_identification:{number:'777777'},
    international_passport:{number:'888888',issued_date:'2021-01-01',planned_end_date:'2031-01-01',name:'ANNA',surname:'IVANOVA'},
    driving_license:{number:'999999'},sts:{number:'111111'},education:{description:'Высшее'},job_title:'Инженер',work_address:{full_address:'Офис на Тверской'},marital_status:{description:'Замужем'},is_self_employed:true}
  vi.stubGlobal('fetch',async(url:string)=>url==='/api/auth/session'?Response.json({user,roles:['individual']}):Response.json({userId:user.id,profile:saved}))
  page()
  for(const value of ['29 февраля 2000','+79000000001','1234 555555','2 марта 2020','Первый отдел','123-456','123456789012','12345678901','Россия','Тула','Москва, Первая','Текущий адрес','Доставка: Москва','Петрова Анна Павловна','777777','888888','999999','111111','Замужем','Высшее']) expect(await screen.findByText(value)).toBeVisible()
  cleanup();page('/cabinet/work/')
  for(const value of ['Инженер','Офис на Тверской','Настоящее место работы']) expect(await screen.findByText(value)).toBeVisible()
  cleanup();saved={...saved,family_name:'Новая',email:'renewed@example.test',identification:{...saved.identification,number:'666666'},is_self_employed:false};page()
  expect(await screen.findByText('renewed@example.test')).toBeVisible()
  expect(await screen.findByText('1234 666666')).toBeVisible()
  expect(screen.queryByText('1234 555555')).not.toBeInTheDocument()
  expect(screen.queryByText('owner@example.test')).not.toBeInTheDocument()
  cleanup();page('/cabinet/work/')
  expect(await screen.findByText('Нет')).toBeVisible()
})
