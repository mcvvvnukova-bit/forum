import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {Cabinet} from './Cabinet'
const user={id:'owner-one',displayName:'Анна Иванова'}
const pending={id:'addition-1',inn:'9709128511',name:null,status:'pending',members:[]}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
function page(){vi.stubGlobal('scrollTo',vi.fn());history.replaceState(null,'','/cabinet/organizations/');return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet/></BaseStyles></ThemeProvider>)}
describe('my organizations',()=>{
 it('loads independently from provider profile and saves a single pending row with Enter form submit',async()=>{
  let saved=false
  vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
   if(url==='/api/auth/session')return Response.json({user})
   if(url==='/api/profile')return new Response('',{status:503})
   if(options?.method==='POST'){saved=true;return Response.json({userId:user.id,item:pending},{status:201})}
   return Response.json({userId:user.id,items:saved?[pending]:[],nextCursor:null})
  });page()
  expect(await screen.findByRole('heading',{level:1,name:'Мои организации'})).toBeVisible()
  expect(screen.getByRole('link',{name:'Мои организации'})).toHaveAttribute('aria-current','page')
  await screen.findByText('У вас пока нет организаций')
  fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128511'}})
  fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
  expect(await screen.findByText('9709128511')).toBeVisible()
  expect(screen.getByText('Название появится после подтверждения')).toBeVisible()
  expect(screen.getByText('Ожидает подтверждения')).toBeVisible()
  expect(screen.getByLabelText('ИНН')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128511'}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
  await waitFor(()=>expect(screen.getAllByText('9709128511')).toHaveLength(1))
 })
 it('associates checksum errors and preserves input after retryable save failure',async()=>{
  vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>url==='/api/auth/session'?Response.json({user}):options?.method==='POST'?new Response('',{status:503}):Response.json({userId:user.id,items:[],nextCursor:null}));page()
  await screen.findByText('У вас пока нет организаций')
  fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128512'}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
  expect(screen.getByText('Проверьте ИНН: 10 или 12 цифр и контрольную сумму')).toBeVisible()
  expect(screen.getByLabelText('ИНН')).toHaveAttribute('aria-invalid','true')
  fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128511'}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
  expect(await screen.findByText('Не удалось сохранить организацию. Повторите попытку')).toBeVisible()
  expect(screen.getByLabelText('ИНН')).toHaveValue('9709128511')
 })
 it('displays multiple members and all roles but excludes pending member data',async()=>{
  const member={userId:'m1',fullName:'Борис Петров',roles:['organization_admin','organization_employee']}
  vi.stubGlobal('fetch',async(url:string)=>url==='/api/auth/session'?Response.json({user}):Response.json({userId:user.id,items:[{...pending,id:'active',inn:'500100732259',name:'Компания',status:'active',members:[member,{userId:'m2',fullName:'Мария Иванова',roles:['organization_signer']}]},{...pending,members:[{...member,fullName:'Чужой участник'}]}],nextCursor:null}));page()
  expect(await screen.findByText('Борис Петров')).toBeVisible()
  expect(screen.getByText('Мария Иванова')).toBeVisible()
  for(const role of ['Администратор компании','Сотрудник компании','Лицо с правом подписи'])expect(screen.getByText(role)).toBeVisible()
  expect(screen.queryByText('Чужой участник')).not.toBeInTheDocument()
 })
 it('retries list errors and clears organization data when session expires',async()=>{
  let fail=true,expired=false
  vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
   if(url==='/api/auth/session')return expired?new Response('',{status:401}):Response.json({user})
   if(options?.method==='POST'){expired=true;return new Response('',{status:401})}
   if(fail){fail=false;return new Response('',{status:503})}
   return Response.json({userId:user.id,items:[pending],nextCursor:null})
  });page()
  await screen.findByText('Не удалось загрузить организации');fireEvent.click(screen.getAllByRole('button',{name:'Повторить'})[0])
  await screen.findByText('9709128511')
  fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'500100732259'}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
  await waitFor(()=>expect(location.pathname).toBe('/'))
  expect(screen.queryByText('9709128511')).not.toBeInTheDocument()
 })
})
it('keeps confirmed saving visible when list refresh fails and blocks repeated submit while saving',async()=>{
 let resolveSave:(value:Response)=>void=()=>{},posted=false
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
  if(url==='/api/auth/session')return Response.json({user})
  if(options?.method==='POST'){posted=true;return await new Promise<Response>(resolve=>{resolveSave=resolve})}
  return posted?new Response('',{status:503}):Response.json({userId:user.id,items:[],nextCursor:null})
 });page();await screen.findByText('У вас пока нет организаций')
 fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128511'}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))
 expect(screen.getByRole('button',{name:'Сохраняем…'})).toBeDisabled()
 resolveSave(Response.json({userId:user.id,item:pending},{status:201}))
 expect(await screen.findByText('Организация сохранена')).toBeVisible()
 expect(await screen.findByText('Не удалось загрузить организации')).toBeVisible()
 expect(screen.queryByText('Не удалось сохранить организацию. Повторите попытку')).not.toBeInTheDocument()
 expect(screen.getByText('9709128511')).toBeVisible()
})
function earlierCards(count:number){
 return Array.from({length:count},(_,i)=>{
  const digits=String(300000000+i),weights=[2,4,10,3,5,9,4,6,8]
  const inn=digits+String(weights.reduce((sum,w,j)=>sum+w*Number(digits[j]),0)%11%10)
  return {...pending,id:`earlier-${i}`,inn}
 })
}
function add(){fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:pending.inn}});fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}))}
it('keeps a saved card beyond fifty earlier cards and deduplicates its later page',async()=>{
 const first=earlierCards(50);let posted=false
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
  if(url==='/api/auth/session')return Response.json({user})
  if(options?.method==='POST'){posted=true;return Response.json({userId:user.id,item:pending},{status:201})}
  return Response.json({userId:user.id,items:url.includes('?')?[pending]:first,nextCursor:url.includes('?')?null:'second'})
 });page();await screen.findByText(first[49].inn);add()
 await waitFor(()=>expect(posted&&screen.getByLabelText('ИНН').getAttribute('disabled')===null).toBe(true))
 expect(screen.getByText(pending.inn)).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Показать ещё'}))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Показать ещё'})).not.toBeInTheDocument())
 expect(screen.getAllByText(pending.inn)).toHaveLength(1)
})
it('refreshes loaded later pages while replacing stale membership snapshots',async()=>{
 const first=earlierCards(50),later=earlierCards(60).slice(50);let posted=false
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
  if(url==='/api/auth/session')return Response.json({user})
  if(options?.method==='POST'){posted=true;return Response.json({userId:user.id,item:pending},{status:201})}
  const items=url.includes('?')?(posted?later:later.map(card=>({...card,status:'active',members:[{userId:'old',fullName:'Старый доступ',roles:['organization_employee']}]}))):first
  return Response.json({userId:user.id,items,nextCursor:url.includes('?')?'third':'second'})
 });page();await screen.findByText(first[49].inn);fireEvent.click(screen.getByRole('button',{name:'Показать ещё'}));await screen.findAllByText('Старый доступ');add()
 await waitFor(()=>expect(screen.queryByText('Старый доступ')).not.toBeInTheDocument())
 expect(screen.getByText(later[9].inn)).toBeVisible();expect(screen.getByText(pending.inn)).toBeVisible()
})
it.each(['initial','retry','pagination'])('ignores a late %s response invalidated by saving',async(kind)=>{
 let lateResolve:(value:Response)=>void=()=>{},reads=0,posted=false
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
  if(url==='/api/auth/session')return Response.json({user})
  if(options?.method==='POST'){posted=true;return Response.json({userId:user.id,item:pending},{status:201})}
  reads++
  if(!posted&&((kind==='initial'&&reads===1)||(kind==='retry'&&reads===2)||(kind==='pagination'&&url.includes('?'))))return await new Promise<Response>(resolve=>{lateResolve=resolve})
  if(kind==='retry'&&reads===1)return new Response('',{status:503})
  return Response.json({userId:user.id,items:posted?[pending]:kind==='pagination'?earlierCards(1):[],nextCursor:kind==='pagination'&&!posted?'next':null})
 });page();await screen.findByRole('heading',{name:'Мои организации'})
 if(kind==='retry'){await screen.findByText('Не удалось загрузить организации');fireEvent.click(screen.getAllByRole('button',{name:'Повторить'})[0])}
 if(kind==='pagination'){await screen.findByText(earlierCards(1)[0].inn);fireEvent.click(screen.getByRole('button',{name:'Показать ещё'}))}
 add();await screen.findByText('Организация сохранена');await waitFor(()=>expect(screen.getByLabelText('ИНН')).not.toBeDisabled())
 await act(async()=>{lateResolve(Response.json({userId:user.id,items:kind==='pagination'?[{...pending,status:'active',members:[{userId:'old',fullName:'Устаревший участник',roles:['organization_employee']}]}]:[],nextCursor:null}));await Promise.resolve()})
 expect(screen.getByText(pending.inn)).toBeVisible();expect(screen.queryByText('У вас пока нет организаций')).not.toBeInTheDocument()
 expect(screen.queryByText('Устаревший участник')).not.toBeInTheDocument()
})
it('uses the FormControl disabled contract during saving without an input warning',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{})
 let resolveSave:(value:Response)=>void=()=>{}
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>url==='/api/auth/session'?Response.json({user}):options?.method==='POST'?await new Promise<Response>(resolve=>{resolveSave=resolve}):Response.json({userId:user.id,items:[],nextCursor:null}))
 page();await screen.findByText('У вас пока нет организаций');add();expect(screen.getByLabelText('ИНН')).toBeDisabled()
 expect([...warning.mock.calls,...error.mock.calls].flat().join(' ')).not.toContain("instead of passing the 'disabled' prop directly")
 await act(async()=>{resolveSave(Response.json({userId:user.id,item:pending},{status:201}))})
})
