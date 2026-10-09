import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {Cabinet} from './Cabinet'
const user={id:'owner-one',displayName:'Анна Иванова'}
const pending={id:'addition-1',inn:'9709128511',name:null,status:'pending',members:[]}
afterEach(()=>vi.unstubAllGlobals())
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
