import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Cabinet} from './Cabinet'
import {ManagedReferenceDirectory} from './ManagedReferenceDirectory'
vi.mock('@primer/live-region-element',()=>({announce:vi.fn(async()=>{}),announceFromElement:vi.fn(async()=>{})}))
const session={user:{id:'11111111-1111-4111-8111-111111111111',displayName:'Администратор'},roles:['individual'],platformRoles:['platform_admin'],csrfToken:'a'.repeat(43),accessVersion:1}
const definitions=[['regions','Субъекты РФ'],['offer-types','Типы предложения'],['business-segments','Бизнес-сегменты'],['commercial-roles','Коммерческие роли'],['units','Единицы измерения'],['rejection-reasons','Причины отклонения'],['company-statuses','Статусы организаций']]
function page(kind='units',roles=['platform_admin'],status=200,mutationStatus=200){
 let item:{code:string;name:string;description:string|null;symbol:string|null;version:number}|null={code:'01',name:'Проверочное значение',description:'Описание',symbol:'шт.',version:1}
 const f=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET'
  if(url==='/api/auth/session')return Response.json({...session,platformRoles:roles})
  if(url==='/api/profile')return Response.json({userId:session.user.id,profile:{}})
  if(!url.startsWith('/api/references/managed/'+kind))throw new Error('Unexpected '+url)
  if(status!==200)return Response.json({code:status===412?'stale_version':'forbidden'},{status})
  if(method!=='GET'&&mutationStatus!==200){if(mutationStatus===404)item=null;return Response.json({code:'stale_version'},{status:mutationStatus})}
  if(method==='DELETE'&&(init?.headers as Record<string,string>)?.['Content-Type']==='application/json'&&!init?.body)return Response.json({code:'FST_ERR_CTP_EMPTY_JSON_BODY'},{status:400})
  if(method==='DELETE'){item=null;return Response.json({item:{code:'01',version:3,deleted:true}})}
  if(method==='POST'||method==='PATCH'){
   const body=JSON.parse(String(init?.body));item={code:body.code??'01',description:null,symbol:null,...body,version:method==='POST'?1:2};
   return Response.json({item:{code:item!.code,version:item!.version}},{status:method==='POST'?201:200})
  }
  return Response.json(url.split('?')[0].endsWith('/01')?{item}:{items:item?[item]:[],total:item?1:0,page:1,pageSize:50})
 });vi.stubGlobal('fetch',f);vi.stubGlobal('scrollTo',vi.fn());history.replaceState(null,'','/cabinet/references/'+kind+'/')
 render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet/></BaseStyles></ThemeProvider>);return f
}
afterEach(()=>vi.unstubAllGlobals())
it.each(definitions)('%s opens its own screen and active sidebar item',async(kind,title)=>{
 const f=page(kind);expect(await screen.findByRole('heading',{name:title})).toBeVisible();await screen.findByText('Проверочное значение')
 const nav=within(screen.getByRole('navigation',{name:'Навигация личного кабинета'}));expect(nav.getByRole('link',{name:title})).toHaveAttribute('aria-current','page')
 for(const [,name] of definitions)expect(nav.getByRole('link',{name})).toBeVisible()
 expect(f.mock.calls.some(([u])=>u==='/api/profile')).toBe(false)
})
it('views, edits immutable code, and soft deletes through explicit confirmation',async()=>{
 const f=page();await screen.findByText('Проверочное значение');fireEvent.click(screen.getByRole('button',{name:'Открыть значение 01'}))
 const view=await screen.findByRole('dialog',{name:'Просмотр значения'});expect(await within(view).findByText('Описание')).toBeVisible()
 fireEvent.click(within(view).getByRole('button',{name:'Редактировать'}))
 const edit=screen.getByRole('dialog',{name:'Редактирование значения'});expect(within(edit).getByLabelText(/^Код/)).toBeDisabled()
 fireEvent.change(within(edit).getByLabelText(/^Наименование/),{target:{value:'Изменённое значение'}});fireEvent.click(within(edit).getByRole('button',{name:'Сохранить'}))
 await screen.findByText('Изменённое значение');expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Открыть значение 01'}));fireEvent.click(await screen.findByRole('button',{name:'Удалить значение'}))
 const confirmation=screen.getByRole('dialog',{name:'Удаление значения'});expect(within(confirmation).getByText(/Значение будет скрыто/)).toBeVisible()
 fireEvent.click(within(confirmation).getByRole('button',{name:'Удалить'}));await waitFor(()=>expect(screen.queryByText('Изменённое значение')).not.toBeInTheDocument())
 const patch=f.mock.calls.find(([,o])=>o?.method==='PATCH')!,del=f.mock.calls.find(([,o])=>o?.method==='DELETE')!
 expect(patch[1]?.headers).toMatchObject({'X-Forum-CSRF':session.csrfToken,'If-Match':'"1"'});expect(del[1]?.headers).toMatchObject({'If-Match':'"2"'})
 expect(JSON.parse(String(patch[1]?.body))).not.toHaveProperty('code');expect(del[1]?.body).toBeUndefined()
})
it('creates with required fields, measurement symbol and a retry identity',async()=>{
 const f=page();await screen.findByText('Проверочное значение');fireEvent.click(screen.getByRole('button',{name:'Добавить значение'}))
 const dialog=screen.getByRole('dialog',{name:'Добавление значения'}),form=within(dialog)
 expect(form.getByLabelText(/^Код/)).toBeRequired();expect(form.getByLabelText(/^Наименование/)).toBeRequired()
 fireEvent.change(form.getByLabelText(/^Код/),{target:{value:'02'}});fireEvent.change(form.getByLabelText(/^Наименование/),{target:{value:'Метр'}});fireEvent.change(form.getByLabelText('Обозначение'),{target:{value:'м'}})
 fireEvent.click(form.getByRole('button',{name:'Сохранить'}));await screen.findByText('Метр')
 const call=f.mock.calls.find(([,o])=>o?.method==='POST')!;expect(JSON.parse(String(call[1]?.body))).toMatchObject({code:'02',name:'Метр',symbol:'м'})
 expect((call[1]?.headers as Record<string,string>)['Idempotency-Key']).toMatch(/^[\w-]{8,128}$/)
})
it.each(definitions)('%s filters immediately while typing and clearing fields restores values',async kind=>{
 const f=page(kind);await screen.findByText('Проверочное значение');const requests=f.mock.calls.length
 expect(screen.queryByText('Просмотр и управление значениями справочника')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Найти'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Сбросить фильтры'})).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:'02'}});expect(screen.queryByText('Проверочное значение')).not.toBeInTheDocument();expect(screen.getByText('Найдено: 0')).toBeVisible()
 fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:' 01 '}});fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:' ПРОВЕРОЧНОЕ '}});expect(screen.getByText('Проверочное значение')).toBeVisible()
 fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:'_%'}});expect(screen.queryByText('Проверочное значение')).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:''}});fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:''}});expect(screen.getByText('Проверочное значение')).toBeVisible();expect(f.mock.calls).toHaveLength(requests)
})

function pagedDirectory(secondPage='ready'){
 const rows=Array.from({length:89},(_,i)=>({code:String(i+1).padStart(2,'0'),name:'Субъект '+String(i+1).padStart(2,'0'),description:null,symbol:null,version:1}))
 const expired=vi.fn(),f=vi.fn(async(input:string|URL|Request)=>{
  const url=new URL(String(input),'https://dev.astforum.ru');if(url.pathname!=='/api/references/managed/regions')throw new Error('Unexpected path')
  const page=Number(url.searchParams.get('page'))
  if(page===2&&['error','expired','denied'].includes(secondPage))return Response.json({code:'unavailable'},{status:secondPage==='expired'?401:secondPage==='denied'?403:502})
  return Response.json({items:page===1?rows.slice(0,50):secondPage==='duplicate'?[rows[0],...rows.slice(51)]:rows.slice(50,secondPage==='truncated'?88:89),total:page===2&&secondPage==='changed'?88:89,page,pageSize:50})
 });vi.stubGlobal('fetch',f)
 render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><ManagedReferenceDirectory dictionary="regions" session={session} onExpired={expired}/></BaseStyles></ThemeProvider>);return {f,expired}
}
it('shows all 89 values without pagination and filters the last API page immediately',async()=>{
 pagedDirectory();await screen.findByText('Субъект 89');expect(screen.getAllByRole('row')).toHaveLength(90);expect(screen.getByText('Найдено: 89')).toBeVisible()
 expect(screen.queryByRole('navigation',{name:'Страницы справочника'})).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:'8'}});expect(screen.getByText('Найдено: 10')).toBeVisible();expect(screen.getByText('Субъект 89')).toBeVisible();expect(screen.queryByText('Субъект 01')).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:' 89 '}});expect(screen.getByText('Найдено: 1')).toBeVisible()
 fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:'01'}});expect(screen.getByText('Найдено: 0')).toBeVisible()
 fireEvent.change(screen.getByLabelText(/^Наименование/),{target:{value:''}});fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:''}});expect(screen.getAllByRole('row')).toHaveLength(90)
})
it.each(['error','changed','duplicate','truncated','expired','denied'])('does not show partial results when page 2 is %s',async issue=>{
 const {expired}=pagedDirectory(issue)
 if(issue==='expired')await waitFor(()=>expect(expired).toHaveBeenCalledOnce())
 else await screen.findByText(issue==='denied'?'Нет доступа к справочнику':'Не удалось загрузить справочник')
 expect(screen.queryByText('Субъект 01')).not.toBeInTheDocument();expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
it('moderator sees only reasons and no user administration or classifiers',async()=>{
 page('rejection-reasons',['platform_moderator']);await screen.findByText('Проверочное значение')
 const nav=within(screen.getByRole('navigation',{name:'Навигация личного кабинета'}));expect(nav.getByRole('link',{name:'Причины отклонения'})).toBeVisible()
 for(const title of ['Пользователи','ОКВЭД2','ОКПД2','Единицы измерения'])expect(nav.queryByRole('link',{name:title})).not.toBeInTheDocument()
})
it('server denial clears values and mutation controls',async()=>{
 page('units',['platform_admin'],403);await screen.findByText('Нет доступа к справочнику')
 expect(screen.queryByText('Проверочное значение')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Добавить значение'})).not.toBeInTheDocument()
})

it.each([409,412])('mutation error %i retains the form and entered values',async status=>{
 page('units',['platform_admin'],200,status);await screen.findByText('Проверочное значение');fireEvent.click(screen.getByRole('button',{name:'Открыть значение 01'}));fireEvent.click(await screen.findByRole('button',{name:'Редактировать'}))
 const form=within(screen.getByRole('dialog',{name:'Редактирование значения'}));fireEvent.change(form.getByLabelText(/^Наименование/),{target:{value:'Моя правка'}});fireEvent.click(form.getByRole('button',{name:'Сохранить'}))
 await form.findByText(status===412?/Значение изменено другим пользователем/:/Код или наименование уже заняты/);expect(form.getByLabelText(/^Наименование/)).toHaveValue('Моя правка');expect(form.getByRole('button',{name:'Сохранить'})).toBeEnabled()
})
it.each(definitions)('%s exposes only its configured editable fields',async(kind)=>{
 page(kind);await screen.findByText('Проверочное значение');fireEvent.click(screen.getByRole('button',{name:'Добавить значение'}))
 const form=within(screen.getByRole('dialog',{name:'Добавление значения'}))
 expect(Boolean(form.queryByLabelText('Описание'))).toBe(!['regions','company-statuses'].includes(kind))
 expect(Boolean(form.queryByLabelText('Обозначение'))).toBe(kind==='units')
})

it('a confirmed concurrent deletion closes the stale form and clears deleted values',async()=>{
 const f=page('units',['platform_admin'],200,404);await screen.findByText('Проверочное значение');fireEvent.click(screen.getByRole('button',{name:'Открыть значение 01'}));fireEvent.click(await screen.findByRole('button',{name:'Редактировать'}))
 fireEvent.click(within(screen.getByRole('dialog',{name:'Редактирование значения'})).getByRole('button',{name:'Сохранить'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(screen.queryByText('Проверочное значение')).not.toBeInTheDocument()
 await screen.findByText('Найдено: 0');expect(f.mock.calls.filter(([u,o])=>String(u).includes('?')&&(!o?.method||o.method==='GET')).length).toBe(2)
})
