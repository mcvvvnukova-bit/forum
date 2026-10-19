import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Cabinet} from './Cabinet'
vi.mock('@primer/live-region-element',()=>({announce:vi.fn(async()=>{}),announceFromElement:vi.fn(async()=>{})}))
const session={user:{id:'11111111-1111-4111-8111-111111111111',displayName:'Администратор'},roles:['individual'],participant:null,platformRoles:['platform_admin'],accessVersion:1,csrfToken:'a'.repeat(43)}
const result={items:[{code:'01.11.11.110',name:'Пшеница твердая'}],total:1,page:1,pageSize:50,source:{edition:'148/2026',publishedDate:'2026-10-02',checkedAt:'2026-10-19T18:00:00.000Z',url:'https://rosstat.gov.ru/storage/mediabank/OKPD2.rar'}}
function page(options:{roles?:string[];reply?:(url:string)=>Response|Promise<Response>}={}){
 const f=vi.fn(async(input:string|URL|Request)=>{
  const url=String(input)
  if(url==='/api/auth/session')return Response.json({...session,platformRoles:options.roles??session.platformRoles})
  if(url==='/api/profile')return Response.json({userId:session.user.id,profile:{}})
  if(url.startsWith('/api/references/okpd'))return options.reply?.(url)??Response.json(result)
  throw new Error('Unexpected request '+url)
 });vi.stubGlobal('fetch',f);vi.stubGlobal('scrollTo',vi.fn());history.replaceState(null,'','/cabinet/references/okpd/')
 render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet/></BaseStyles></ThemeProvider>);return f
}
afterEach(()=>vi.unstubAllGlobals())
it('administrator opens active references navigation and reads codes without requesting profile',async()=>{
 const f=page();expect(await screen.findByRole('heading',{name:'ОКПД2'})).toBeVisible();expect(await screen.findByText(result.items[0].name)).toBeVisible()
 expect(screen.getByRole('link',{name:'Справочники'})).toHaveAttribute('aria-current','page')
 expect(screen.getByText(/Редакция 148\/2026/)).toBeVisible();expect(screen.getByRole('link',{name:'ОКВЭД2'})).toHaveAttribute('href','/cabinet/references/okved/#main')
 expect(screen.getByRole('columnheader',{name:'Код'})).toBeVisible();expect(screen.getByRole('columnheader',{name:'Наименование'})).toBeVisible()
 expect(f.mock.calls.some(([url])=>url==='/api/profile')).toBe(false)
})
it('search combines fields and reset restores the full directory',async()=>{
 page();await screen.findByText(result.items[0].name)
 fireEvent.change(screen.getByLabelText('Код'),{target:{value:'01'}});fireEvent.change(screen.getByLabelText('Наименование'),{target:{value:' рис '}})
 fireEvent.click(screen.getByRole('button',{name:'Найти'}));await screen.findByText(result.items[0].name)
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([u])=>String(u).includes('code=01')&&String(u).includes('name=%D1%80%D0%B8%D1%81'))).toBe(true))
 fireEvent.click(screen.getByRole('button',{name:'Сбросить фильтры'}));expect(screen.getByLabelText('Код')).toHaveValue('');expect(screen.getByLabelText('Наименование')).toHaveValue('')
})
it('pagination advances and a new search starts at page one',async()=>{
 page({reply:u=>Response.json({...result,total:51,page:new URL(u,'http://local').searchParams.get('page')==='2'?2:1})});await screen.findByText(result.items[0].name)
 fireEvent.click(screen.getByRole('button',{name:'Следующая страница'}));await screen.findByText('Страница 2')
 fireEvent.change(screen.getByLabelText('Код'),{target:{value:'01'}});fireEvent.click(screen.getByRole('button',{name:'Найти'}));await screen.findByText('Страница 1')
})
it('empty search has a useful message and preserves editable filters',async()=>{
 page({reply:()=>Response.json({...result,items:[],total:0})});expect(await screen.findByText('По выбранным условиям ничего не найдено')).toBeVisible();expect(screen.getByLabelText('Код')).toBeEnabled()
})
it.each([{roles:[]},{roles:['platform_moderator']},{roles:['organization_admin']}])('non-administrator $roles cannot request the protected directory',async({roles})=>{
 const f=page({roles});expect(await screen.findByText('Нет доступа к справочнику')).toBeVisible();expect(f.mock.calls.some(([u])=>String(u).startsWith('/api/references/okpd'))).toBe(false)
})
it('server denial clears the directory even if the cached session still says administrator',async()=>{
 page({reply:()=>new Response(null,{status:403})});expect(await screen.findByText('Нет доступа к справочнику')).toBeVisible();expect(screen.queryByText(result.items[0].name)).not.toBeInTheDocument()
})
it('transient failure can be retried',async()=>{
 let failed=true;page({reply:()=>failed?new Response(null,{status:503}):Response.json(result)});await screen.findByText('Не удалось загрузить справочник')
 failed=false;fireEvent.click(screen.getAllByRole('button',{name:'Повторить'})[0]);expect(await screen.findByText(result.items[0].name)).toBeVisible()
})
it('late response cannot overwrite the later filter result',async()=>{
 let finish:(response:Response)=>void=()=>{}
 page({reply:u=>u.includes('code=01')?new Promise(resolve=>{finish=resolve}):Response.json(result)});await screen.findByText(result.items[0].name)
 fireEvent.change(screen.getByLabelText('Код'),{target:{value:'01'}});fireEvent.click(screen.getByRole('button',{name:'Найти'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([u])=>String(u).includes('code=01'))).toBe(true))
 fireEvent.change(screen.getByLabelText('Код'),{target:{value:'02'}});fireEvent.click(screen.getByRole('button',{name:'Найти'}));await screen.findByText(result.items[0].name)
 await act(async()=>{finish(Response.json({...result,items:[{code:'01',name:'Устаревший ответ'}]}))});expect(screen.queryByText('Устаревший ответ')).not.toBeInTheDocument()
})
