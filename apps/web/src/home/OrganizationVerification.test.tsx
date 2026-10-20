import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Organizations} from './Organizations'
import {OrganizationVerification} from './OrganizationVerification'
const inn='9709128511',userId='owner',route='/api/me/organizations/verification'
const pending={id:'addition',inn,name:null,status:'pending',members:[]}
function result(status='signature_required',source='unconfigured'){
 return {id:'attempt',inn,method:status==='signature_required'?'kep':'diadoc',status,source,reason:'not_connected',createdAt:'2026-10-20T00:00:00.000Z',checkedAt:'2026-10-20T00:00:00.000Z',expiresAt:new Date(Date.now()+600_000).toISOString(),evidence:{},legalPermissions:{registerCompany:false,submitTender:false}}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})
function page(){return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Organizations userId={userId} onExpired={vi.fn()}/></BaseStyles></ThemeProvider>)}
function responses(handler:(url:string,options?:RequestInit)=>Promise<Response>){
 vi.stubGlobal('fetch',async(url:string,options?:RequestInit)=>{
  if(url==='/api/me/organizations')return Response.json({userId,items:[pending],nextCursor:null})
  if(url===route+'/options')return Response.json({userId,enabled:true})
  return handler(url,options)
 })
}
async function open(){fireEvent.click(await screen.findByRole('button',{name:'Подтвердить организацию '+inn}));await screen.findByRole('button',{name:'Подтвердить КЭП'})}
it('offers both paths and persists the selected result when the panel is reopened',async()=>{
 let item:ReturnType<typeof result>|null=null,method=''
 responses(async(_url,options)=>{
  if(options?.method==='POST'){method=JSON.parse(String(options.body)).method;item=result()}
  return Response.json({userId,item})
 });page();await open();fireEvent.click(screen.getByRole('button',{name:'Подтвердить КЭП'}))
 expect(await screen.findByText('Для подтверждения требуется подпись КЭП')).toBeVisible();expect(method).toBe('kep')
 fireEvent.click(screen.getByRole('button',{name:'Закрыть проверку'}));await open()
 expect(await screen.findByText('Для подтверждения требуется подпись КЭП')).toBeVisible()
 expect(screen.getByText('Юридические полномочия пока не подтверждены')).toBeVisible()
})
it('labels simulated technical access separately from legal authority and never exposes company roles',async()=>{
 responses(async()=>Response.json({userId,item:result('access_confirmed','simulation')}));page();await open()
 expect(await screen.findByText('Доступ в Диадоке подтверждён')).toBeVisible()
 expect(screen.getByText('Тестовые сведения')).toBeVisible()
 expect(screen.getByText('Юридические полномочия пока не подтверждены')).toBeVisible()
 expect(screen.queryByText('Администратор компании')).not.toBeInTheDocument()
})
it('retries a lost POST response with the same operation id',async()=>{
 const ids:string[]=[]
 responses(async(_url,options)=>{
  if(options?.method==='POST'){
   ids.push(JSON.parse(String(options.body)).requestId)
   if(ids.length===1)throw new Error('Lost response')
   return Response.json({userId,item:result('connection_required')})
  }
  return Response.json({userId,item:null})
 });page();await open();fireEvent.click(screen.getByRole('button',{name:'Подключить Диадок'}))
 fireEvent.click(await screen.findByRole('button',{name:'Повторить запрос'}))
 expect(await screen.findByText('Требуется подключение учётной записи Диадока')).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
})
it('rejects a response owned by another user',async()=>{
 responses(async()=>Response.json({userId:'other-owner',item:result('access_confirmed')}));page();await open()
 expect(await screen.findByText('Не удалось получить результат проверки')).toBeVisible()
 expect(screen.queryByText('Доступ в Диадоке подтверждён')).not.toBeInTheDocument()
})
it('ignores a late response after closing the panel',async()=>{
 let finish:(value:Response)=>void=()=>{}
 responses(async()=>new Promise<Response>(resolve=>{finish=resolve}));page()
 fireEvent.click(await screen.findByRole('button',{name:'Подтвердить организацию '+inn}))
 fireEvent.click(await screen.findByRole('button',{name:'Закрыть проверку'}));finish(Response.json({userId,item:result('access_confirmed')}))
 await waitFor(()=>expect(screen.queryByText('Доступ в Диадоке подтверждён')).not.toBeInTheDocument())
})
it('expires open evidence when its TTL passes and rejects an already expired positive response',async()=>{
 vi.useFakeTimers();let item={...result('access_confirmed','simulation'),expiresAt:new Date(Date.now()+1000).toISOString()};
 vi.stubGlobal('fetch',async()=>Response.json({userId,item}));
 const element=<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><OrganizationVerification inn={inn} userId={userId} onClose={vi.fn()} onExpired={vi.fn()}/></BaseStyles></ThemeProvider>;
 let view:ReturnType<typeof render>;
 await act(async()=>{view=render(element)});
 expect(screen.getByText('Доступ в Диадоке подтверждён')).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(1001)});
 expect(screen.queryByText('Доступ в Диадоке подтверждён')).not.toBeInTheDocument();expect(screen.getByText('Срок проверки истёк. Получите актуальные сведения.')).toBeVisible();
 view!.unmount();item={...item,expiresAt:new Date(Date.now()-1000).toISOString()};
 await act(async()=>{render(element)});
 expect(screen.queryByText('Доступ в Диадоке подтверждён')).not.toBeInTheDocument();
});
it('restores keyboard focus after a disabled action completes',async()=>{
 let finish:(response:Response)=>void=()=>{};
 responses(async(_url,options)=>options?.method==='POST'?new Promise<Response>(resolve=>{finish=resolve}):Response.json({userId,item:null}));
 page();await open();const button=screen.getByRole('button',{name:'Подтвердить КЭП'});await waitFor(()=>expect(button).toBeEnabled());button.focus();expect(button).toHaveFocus();fireEvent.click(button);document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');expect(button).not.toHaveFocus();
 await act(async()=>{finish(Response.json({userId,item:result()}))});
 await waitFor(()=>expect(button).toHaveFocus());
});
