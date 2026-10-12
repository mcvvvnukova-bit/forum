import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,expect,it,vi} from 'vitest'
import {UserAccessSection} from './UserAccessSection'
const owner='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222'
const session={user:{id:owner,displayName:'Администратор'},roles:['individual'],participant:null,platformRoles:['platform_admin'],accessVersion:1,csrfToken:'a'.repeat(43)}
const active={userId:target,displayName:'Проверенный пользователь',status:'active',version:1}
const props={session,revision:0,disabled:false,onBusyChange:vi.fn(),onChanged:vi.fn(),onExpired:vi.fn(),onForbidden:vi.fn()}
function page(){return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><UserAccessSection {...props}/></BaseStyles></ThemeProvider>)}
function api(custom?:(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined){
 return vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input),response=await custom?.(url,init);if(response)return response
  return Response.json({items:[active,{...active,userId:owner,displayName:'Администратор'}],nextCursor:null})
 })
}
async function select(id=target){await screen.findByRole('option',{name:'Проверенный пользователь — вход разрешён'});fireEvent.change(screen.getByLabelText('Пользователь для блокировки'),{target:{value:id}})}
async function confirm(label='Заблокировать вход'){
 fireEvent.click(screen.getByRole('button',{name:label}))
 const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:label}))
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
it('confirms block and unblock with current version and complete security headers',async()=>{
 const f=api((url,init)=>init?.method==='PATCH'?Response.json({item:{...active,status:JSON.parse(String(init.body)).status,version:url.endsWith(target)?Number(JSON.parse(new Headers(init.headers).get('If-Match')!))+1:0}}):undefined)
 vi.stubGlobal('fetch',f);page();await select();await confirm()
 expect(await screen.findByText(/Вход пользователя.*заблокирован\. Действующие сеансы завершены/)).toBeVisible()
 expect(screen.getByText('Статус входа: заблокирован')).toBeVisible()
 const call=f.mock.calls.find(([,init])=>init?.method==='PATCH')!,headers=new Headers(call[1]!.headers)
 expect(call[0]).toBe(`/api/iam/platform-user-access/${target}`)
 expect(JSON.parse(String(call[1]!.body))).toEqual({status:'deactivated'})
 expect(headers.get('X-Forum-Context')).toBe('platform');expect(headers.get('X-Forum-CSRF')).toBe(session.csrfToken)
 expect(headers.get('If-Match')).toBe('"1"');expect(headers.get('Idempotency-Key')).toBeTruthy()
 expect(call[1]!.credentials).toBe('same-origin');expect(call[1]!.cache).toBe('no-store')
 expect(props.onChanged).toHaveBeenCalledWith(target,'deactivated')
 await confirm('Разблокировать вход')
 expect(await screen.findByText(/Для продолжения работы нужно войти заново/)).toBeVisible()
 expect(new Headers(f.mock.calls.filter(([,init])=>init?.method==='PATCH')[1][1]!.headers).get('If-Match')).toBe('"2"')
 expect(props.onChanged).toHaveBeenCalledWith(target,'active')
})
it('cancel does not send a mutation and self blocking is disabled',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page();await select()
 fireEvent.click(screen.getByRole('button',{name:'Заблокировать вход'}))
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Отмена'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 expect(f.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(0)
 fireEvent.change(screen.getByLabelText('Пользователь для блокировки'),{target:{value:owner}})
 expect(screen.getByRole('button',{name:'Заблокировать вход'})).toBeDisabled()
 expect(screen.getByText('Нельзя заблокировать свой вход на платформу.')).toBeVisible()
})
it('prevents double submission and keeps idempotency key after uncertain failure',async()=>{
 let complete:(value:Response)=>void=()=>{}
 const f=api((url,init)=>init?.method==='PATCH'?new Promise(resolve=>{complete=resolve}):undefined)
 vi.stubGlobal('fetch',f);page();await select();await confirm()
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'Сохраняем…'})).toBeDisabled()
 expect(props.onBusyChange).toHaveBeenCalledWith(true)
 complete(new Response(null,{status:503}));await screen.findByText('Не удалось изменить доступ. Повторите попытку')
 await confirm();complete(Response.json({item:{...active,status:'deactivated',version:2}}))
 await screen.findByText(/Действующие сеансы завершены/)
 const calls=f.mock.calls.filter(([,init])=>init?.method==='PATCH');expect(calls).toHaveLength(2)
 expect(new Headers(calls[0][1]!.headers).get('Idempotency-Key')).toBe(new Headers(calls[1][1]!.headers).get('Idempotency-Key'))
})
it.each([401,403,404,412])('mutation refusal %s clears protected data and cannot silently retry',async status=>{
 vi.stubGlobal('fetch',api((url,init)=>init?.method==='PATCH'?Response.json({code:'refused'},{status}):undefined));page();await select();await confirm()
 await screen.findByText(status===412?'Доступ изменился. Загрузите актуальные данные':'Нет доступа к блокировке пользователей')
 expect(screen.queryByLabelText('Пользователь для блокировки')).not.toBeInTheDocument()
 expect(props.onChanged).not.toHaveBeenCalled()
 if(status===401)expect(props.onExpired).toHaveBeenCalledOnce()
 if(status===403)expect(props.onForbidden).toHaveBeenCalledOnce()
})
it.each(['invalid-status','invalid-version','repeated-cursor','duplicate-user'])('rejects %s list without exposing mutation controls',async kind=>{
 const items=kind==='duplicate-user'?[active,active]:[{...active,status:kind==='invalid-status'?'revoked':'active',version:kind==='invalid-version'?0:1}]
 vi.stubGlobal('fetch',api(()=>Response.json({items,nextCursor:kind==='repeated-cursor'?'repeated':null})));page()
 expect(await screen.findByText('Не удалось загрузить доступ пользователей')).toBeVisible()
 expect(screen.queryByLabelText('Пользователь для блокировки')).not.toBeInTheDocument()
})
it('ignores late mutation completion after unmount and releases shared busy state',async()=>{
 let complete:(value:Response)=>void=()=>{}
 vi.stubGlobal('fetch',api((url,init)=>init?.method==='PATCH'?new Promise(resolve=>{complete=resolve}):undefined))
 const view=page();await select();await confirm();view.unmount()
 complete(Response.json({item:{...active,status:'deactivated',version:2}}))
 await waitFor(()=>expect(props.onBusyChange).toHaveBeenLastCalledWith(false))
 expect(props.onChanged).not.toHaveBeenCalled()
})
