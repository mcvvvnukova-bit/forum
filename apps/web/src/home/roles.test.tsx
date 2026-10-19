import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Cabinet} from './Cabinet'
vi.mock('@primer/live-region-element',()=>({announce:vi.fn(async()=>{}),announceFromElement:vi.fn(async()=>{})}))
const owner='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',company='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',memberId='55555555-5555-4555-8555-555555555555',assignmentId='66666666-6666-4666-8666-666666666666'
const session={user:{id:owner,displayName:'Администратор'},roles:['individual'],participant:null,platformRoles:['platform_admin'],accessVersion:1,csrfToken:'a'.repeat(43)}
const platform={contextKey:'platform',participantId:null,roles:['platform_admin'],permissions:['platform.roles.manage','platform.audit.read'],accessVersion:1}
const corporate=(id=company)=>({contextKey:`organization:${id}`,participantId:null,roles:['organization_admin'],permissions:['organization.members.manage'],accessVersion:1})
const catalogue=[
 {code:'individual',scope:'person',permissions:['personal.profile.read','personal.profile.update','personal.business.use','organization.add']},
 {code:'organization_employee',scope:'organization',permissions:['organization.business.read','organization.business.draft']},
 {code:'organization_admin',scope:'organization',permissions:['organization.business.read','organization.business.draft','organization.business.publish','organization.profile.update','organization.verification.manage','organization.members.manage','organization.audit.read']},
 {code:'organization_signer',scope:'organization',permissions:['organization.business.read','organization.business.draft'],conditionalPermissions:['organization.documents.sign']},
 {code:'platform_moderator',scope:'platform',permissions:['platform.moderation.review','platform.restrictions.manage','platform.audit.read']},
 {code:'platform_admin',scope:'platform',permissions:['platform.moderation.review','platform.restrictions.manage','platform.audit.read','platform.roles.manage']},
]
const member={id:memberId,userId:target,displayName:'Сотрудник первой компании',status:'active',version:1,roles:['organization_employee','organization_signer'],effectiveRoles:['organization_employee'],permissions:['organization.business.read']}
function page(path='/cabinet/users/'){HTMLElement.prototype.scrollTo=vi.fn();vi.stubGlobal('scrollTo',vi.fn());history.replaceState(null,'',path);return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><Cabinet/></BaseStyles></ThemeProvider>)}
const organizationPath=(id=company)=>`/cabinet/users/?context=${encodeURIComponent(`organization:${id}`)}`
function api(options:{session?:unknown;contexts?:unknown[];response?:(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined}={}){
 return vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input),custom=await options.response?.(url,init);if(custom)return custom
  if(url==='/api/auth/session')return Response.json(options.session??session)
  if(url==='/api/profile')return Response.json({userId:owner,profile:{}})
  if(url.startsWith('/api/iam/contexts'))return Response.json({items:options.contexts??[platform,corporate(),corporate(other)],nextCursor:null})
  if(url==='/api/iam/roles')return Response.json({items:catalogue})
  if(url==='/api/iam/context/resolve'){const key=JSON.parse(String(init?.body)).contextKey;return Response.json(key==='platform'?platform:corporate(key.slice(13)))}
  if(url.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',status:'active',version:1,organizations:[],platformRoles:[]}],nextCursor:null})
  if(url.startsWith('/api/iam/platform-users'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',platformRoles:[]}],nextCursor:null})
  if(url===`/api/iam/organizations/${company}/members`)return Response.json({items:[member],nextCursor:null})
  if(url===`/api/iam/organizations/${other}/members`)return Response.json({items:[],nextCursor:null})
  if(url==='/api/me/organizations')return Response.json({userId:owner,items:[{id:company,inn:'9709128511',name:'Компания',status:'active',members:[]}],nextCursor:null})
  throw new Error('Unexpected request '+url)
 })
}
afterEach(()=>vi.unstubAllGlobals())
it('platform blocking has a separate section and removes a blocked user from role assignment',async()=>{
 const f=api({response:(url,init)=>url===`/api/iam/platform-user-access/${target}`&&init?.method==='PATCH'?Response.json({item:{userId:target,displayName:'Проверенный пользователь',status:'deactivated',version:2}}):undefined})
 vi.stubGlobal('fetch',f);page();await chooseUser()
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Блокировка входа'}))
 expect(await screen.findByRole('heading',{name:'Пользователь для блокировки'})).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Пользователь для блокировки'}));fireEvent.click(await screen.findByRole('option',{name:/Проверенный пользователь/}))
 fireEvent.click(screen.getByRole('button',{name:'Заблокировать вход'}))
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Заблокировать вход'}))
 await screen.findByText(/Действующие сеансы завершены/)
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Роли'}))
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Выберите пользователя')
 await openPicker();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument();fireEvent.keyDown(screen.getByRole('combobox',{name:'Поиск пользователя'}),{key:'Escape'})
})
it('company role management does not expose platform blocking or request its data',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page(organizationPath());await screen.findByRole('option',{name:member.displayName})
 expect(screen.queryByRole('heading',{name:'Пользователь для блокировки'})).not.toBeInTheDocument()
 expect(f.mock.calls.some(([url])=>String(url).startsWith('/api/iam/platform-user-access'))).toBe(false)
})
const namedCompanies=[{id:other,inn:'500100732259',name:'ООО Север',status:'active',members:[]},{id:company,inn:'9709128511',name:'ООО Юг',status:'active',members:[]},{id:target,inn:'7707083893',name:'Компания без полномочий',status:'active',members:[]}]
it('company labels match authorized context IDs rather than metadata order or extra cards',async()=>{
 vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[corporate(),corporate(other)],response:u=>u==='/api/me/organizations'?Response.json({userId:owner,items:namedCompanies,nextCursor:null}):undefined}));page(organizationPath())
 expect(await screen.findByRole('option',{name:'ООО Юг — ИНН 9709128511'})).toHaveValue(`organization:${company}`)
 expect(screen.getByRole('option',{name:'ООО Север — ИНН 500100732259'})).toHaveValue(`organization:${other}`)
 expect(screen.queryByRole('option',{name:/Компания без полномочий/})).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Область управления'),{target:{value:`organization:${other}`}});expect(await screen.findByText('Нет доступных участников')).toBeVisible();expect(screen.queryByRole('option',{name:member.displayName})).not.toBeInTheDocument()
})
it('late paginated company labels preserve the immediately selected context after discarding the draft',async()=>{
 let finish:(response:Response)=>void=()=>{}
 const f=api({session:{...session,platformRoles:[]},contexts:[corporate(),corporate(other)],response:u=>u==='/api/me/organizations'?Response.json({userId:owner,items:[namedCompanies[1]],nextCursor:'second page'}):u==='/api/me/organizations?cursor=second%20page'?new Promise(r=>{finish=r}):undefined})
 vi.stubGlobal('fetch',f);page(organizationPath());await screen.findByRole('option',{name:member.displayName});reason();fireEvent.change(screen.getByLabelText('Область управления'),{target:{value:`organization:${other}`}})
 expect(screen.queryByRole('dialog',{name:'Отменить несохранённые изменения?'})).not.toBeInTheDocument()
 await waitFor(()=>expect(f.mock.calls.some(([u])=>u==='/api/me/organizations?cursor=second%20page')).toBe(true));finish(Response.json({userId:owner,items:[namedCompanies[0]],nextCursor:null}))
 await screen.findByRole('option',{name:'ООО Север — ИНН 500100732259'});expect(screen.getByLabelText('Область управления')).toHaveValue(`organization:${other}`);expect(screen.getByLabelText('Причина изменения')).toHaveValue('');expect(screen.queryByRole('option',{name:member.displayName})).not.toBeInTheDocument()
})
it('missing company name remains recognizable by INN without claiming a known name',async()=>{
 vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[corporate()],response:u=>u==='/api/me/organizations'?Response.json({userId:owner,items:[{...namedCompanies[1],name:null}],nextCursor:null}):undefined}));page(organizationPath())
 expect(await screen.findByRole('option',{name:'Название недоступно — ИНН 9709128511'})).toHaveValue(`organization:${company}`);await screen.findByRole('option',{name:member.displayName})
})
it.each(['unavailable','foreign-owner','repeated-cursor'])('company metadata %s uses honest fallback without changing IAM authority',async kind=>{
 vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[corporate()],response:u=>u.startsWith('/api/me/organizations')?kind==='unavailable'?new Response(null,{status:503}):Response.json({userId:kind==='foreign-owner'?target:owner,items:kind==='repeated-cursor'&&u.includes('?')?[]:namedCompanies,nextCursor:kind==='repeated-cursor'?'repeat':null}):undefined}));page(organizationPath())
 await screen.findByRole('option',{name:member.displayName});expect(screen.getByRole('option',{name:`Название и ИНН недоступны — компания ${company}`})).toHaveValue(`organization:${company}`);expect(screen.queryByRole('option',{name:/ООО/})).not.toBeInTheDocument();expect(screen.getByLabelText('Область управления')).toHaveValue(`organization:${company}`)
})
it('company metadata 401 clears protected data and refreshes the expired session',async()=>{
 let expired=false
 vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[corporate()],response:u=>{if(u==='/api/me/organizations'){expired=true;return new Response(null,{status:401})}if(u==='/api/auth/session'&&expired)return new Response(null,{status:401})}}));page(organizationPath())
 await waitFor(()=>expect(location.pathname).toBe('/'));expect(screen.queryByRole('option',{name:member.displayName})).not.toBeInTheDocument();expect(screen.queryByLabelText('Участник компании')).not.toBeInTheDocument()
})
async function openPicker(){fireEvent.click(await screen.findByRole('button',{name:'Пользователь'}));return screen.findByRole('combobox',{name:'Поиск пользователя'})}
async function chooseUser(name='Проверенный пользователь'){await openPicker();fireEvent.click(await screen.findByRole('option',{name}));}
function selectModerator(){fireEvent.click(screen.getByRole('checkbox',{name:'Модератор платформы'}))}
async function clearUser(){await openPicker();fireEvent.click(screen.getByRole('button',{name:'Очистить выбор'}))}
function reason(){fireEvent.change(screen.getByLabelText('Причина изменения'),{target:{value:'Согласовано владельцем'}})}
it('ordinary session hides staff navigation and refuses the direct route',async()=>{vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[]}));page();expect(await screen.findByText('Нет доступа к управлению ролями')).toBeVisible();expect(screen.queryByRole('link',{name:'Пользователи'})).not.toBeInTheDocument();expect(screen.queryByText('Администрирование')).not.toBeInTheDocument();expect(screen.queryByText('Справочники')).not.toBeInTheDocument();expect(screen.queryByText('Проверенный пользователь')).not.toBeInTheDocument()})
it('malformed authorization data is unavailable and hides staff navigation',async()=>{vi.stubGlobal('fetch',api({session:{...session,platformRoles:['unknown_role']}}));page();expect(await screen.findByText('Не удалось проверить права доступа')).toBeVisible();expect(screen.queryByRole('link',{name:'Пользователи'})).not.toBeInTheDocument();expect(screen.queryByText('Администрирование')).not.toBeInTheDocument();expect(screen.queryByText('Справочники')).not.toBeInTheDocument()})
it('admin navigation groups users after My Organizations and resolves context before reading users',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page();await screen.findByRole('button',{name:'Пользователь'})
 const nav=screen.getByRole('navigation',{name:'Навигация личного кабинета'})
 const organization=within(nav).getByRole('link',{name:'Мои организации'})
 const heading=within(nav).getByText('Администрирование')
 const dictionaries=within(nav).getByText('Справочники')
 const users=within(nav).getByRole('link',{name:'Пользователи'})
 expect(organization.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(heading.compareDocumentPosition(dictionaries)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(dictionaries.compareDocumentPosition(users)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(users).toHaveAttribute('href','/cabinet/users/#main')
 expect(users).toHaveAttribute('aria-current','page')
 const toggle=within(nav).getByRole('button',{name:'Справочники'})
 expect(toggle).toHaveAttribute('aria-expanded','false')
 expect(toggle).toHaveAttribute('aria-controls',within(nav).getByRole('list',{name:'Справочники'}).id)
 const before=location.href;fireEvent.click(toggle);expect(location.href).toBe(before)
 expect(toggle).toHaveAttribute('aria-expanded','true')
 expect(within(nav).getByRole('link',{name:'ОКВЭД2'})).toHaveAttribute('href','/cabinet/references/okved/#main')
 expect(within(nav).getByRole('link',{name:'ОКПД2'})).toHaveAttribute('href','/cabinet/references/okpd/#main')
 expect(screen.getAllByText('Модератор платформы').length).toBeGreaterThan(0)
 expect(f.mock.calls.findIndex(([u])=>u==='/api/iam/context/resolve')).toBeLessThan(f.mock.calls.findIndex(([u])=>String(u).startsWith('/api/iam/platform-users')))
})
it('starts with no user or role selected and clears manual role choices with the user',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page()
 const picker=await screen.findByRole('button',{name:'Пользователь'})
 expect(picker).toHaveTextContent('Выберите пользователя')
 for(const role of screen.getAllByRole('checkbox'))expect(role).not.toBeChecked()
 expect(screen.getByRole('button',{name:'Назначить роль'})).toBeDisabled()
 expect(fireEvent(window,new Event('beforeunload',{cancelable:true}))).toBe(true)
 await chooseUser()
 for(const role of screen.getAllByRole('checkbox'))expect(role).not.toBeChecked()
 expect(screen.getByRole('button',{name:'Назначить роль'})).toBeDisabled()
 fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}))
 expect(screen.getByRole('button',{name:'Назначить роль'})).toBeEnabled()
 await clearUser()
 for(const role of screen.getAllByRole('checkbox'))expect(role).not.toBeChecked()
 expect(fireEvent(window,new Event('beforeunload',{cancelable:true}))).toBe(true)
 expect(f.mock.calls.some(([url,init])=>url==='/api/iam/platform-role-assignments'&&init?.method==='POST')).toBe(false)
})
it('grants without manual reason and prevents double grant with exact security headers',async()=>{let complete:(r:Response)=>void=()=>{};const f=api({response:u=>u==='/api/iam/platform-role-assignments'?new Promise(r=>{complete=r}):undefined});vi.stubGlobal('fetch',f);page();await chooseUser();selectModerator();expect(screen.queryByLabelText('Причина изменения')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));fireEvent.click(screen.getByRole('button',{name:'Назначаем…'}));await waitFor(()=>expect(f.mock.calls.filter(([u])=>u==='/api/iam/platform-role-assignments')).toHaveLength(1));const init=f.mock.calls.find(([u])=>u==='/api/iam/platform-role-assignments')![1]!,h=new Headers(init.headers);expect(h.get('X-Forum-CSRF')).toBe('a'.repeat(43));expect(h.get('X-Forum-Context')).toBe('platform');expect(h.get('Origin')).toBe(location.origin);expect(h.get('Idempotency-Key')).toMatch(/^[\w-]{8,128}$/);expect(h.has('If-Match')).toBe(false);expect(JSON.parse(String(init.body))).toEqual({targetUserId:target,roleCode:'platform_moderator',reason:'Назначение служебной роли через управление пользователями'});complete(Response.json({item:{id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}},{status:201}));expect(await screen.findByRole('status',{name:'Изменения сохранены'})).toHaveAttribute('data-variant','success')})
it('revokes a role using the quoted current version',async()=>{let assignment={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1};const f=api({response:u=>{if(u.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',status:'active',version:1,organizations:[],platformRoles:[assignment]}],nextCursor:null});if(u.startsWith('/api/iam/platform-users'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',platformRoles:[assignment]}],nextCursor:null});if(u.endsWith(`/platform-role-assignments/${assignmentId}`)){assignment={...assignment,status:'revoked',version:2};return Response.json({item:assignment})}}});vi.stubGlobal('fetch',f);page();await chooseUser();fireEvent.click(screen.getByRole('button',{name:/Отозвать роль .* у Проверенный пользователь/}));expect(await screen.findByText('Изменения сохранены')).toBeVisible();const init=f.mock.calls.find(([u])=>String(u).endsWith(`/platform-role-assignments/${assignmentId}`))![1]!;expect(init.method).toBe('PATCH');expect(new Headers(init.headers).get('If-Match')).toBe('"1"');expect(JSON.parse(String(init.body))).toEqual({status:'revoked',reason:'Отзыв служебной роли через управление пользователями'})})
it.each([403,412])('clears sensitive data after mutation refusal %s',async status=>{vi.stubGlobal('fetch',api({response:u=>u==='/api/iam/platform-role-assignments'?Response.json({code:status===412?'stale_version':'forbidden'},{status}):undefined}));page();await chooseUser();selectModerator();fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));expect(await screen.findByText(status===412?'Данные изменились. Загрузите актуальные права':'Нет доступа к управлению ролями')).toBeVisible();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument();expect(screen.getAllByRole('button',{name:'Повторить'})[0]).toBeVisible()})
it('401 clears roles and refreshes the session',async()=>{let expired=false;vi.stubGlobal('fetch',api({response:u=>{if(u.startsWith('/api/iam/platform-users')){expired=true;return new Response(null,{status:401})}if(u==='/api/auth/session'&&expired)return new Response(null,{status:401})}}));page();await waitFor(()=>expect(location.pathname).toBe('/'));expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument()})
it('unavailable reads can retry context and user loading',async()=>{let failing=true;vi.stubGlobal('fetch',api({response:u=>u.startsWith('/api/iam/platform-users')&&failing?new Response(null,{status:503}):undefined}));page();expect(await screen.findByText('Не удалось загрузить роли')).toBeVisible();failing=false;fireEvent.click(screen.getAllByRole('button',{name:'Повторить'})[0]);await screen.findByRole('button',{name:'Пользователь'})})
it('wrong company resolve cannot cause a members request',async()=>{const f=api({session:{...session,platformRoles:[]},contexts:[corporate()],response:u=>u==='/api/iam/context/resolve'?Response.json(corporate(other)):undefined});vi.stubGlobal('fetch',f);page(`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}`);expect(await screen.findByText('Не удалось загрузить роли')).toBeVisible();expect(f.mock.calls.some(([u])=>String(u).includes('/members'))).toBe(false)})
it('company switch aborts old reads and cannot show delayed old members',async()=>{let resolveOld:(r:Response)=>void=()=>{};const f=api({session:{...session,platformRoles:[]},contexts:[corporate(),corporate(other)],response:u=>u===`/api/iam/organizations/${company}/members`?new Promise(r=>{resolveOld=r}):undefined});vi.stubGlobal('fetch',f);page(`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}`);await waitFor(()=>expect(f.mock.calls.some(([u])=>u===`/api/iam/organizations/${company}/members`)).toBe(true));const signal=f.mock.calls.find(([u])=>u===`/api/iam/organizations/${company}/members`)![1]!.signal!;fireEvent.change(screen.getByLabelText('Область управления'),{target:{value:`organization:${other}`}});expect(signal.aborted).toBe(true);expect(await screen.findByText('Нет доступных участников')).toBeVisible();resolveOld(Response.json({items:[member],nextCursor:null}));await waitFor(()=>expect(screen.queryByText(member.displayName)).not.toBeInTheDocument())})
it('signer duty does not imply signing rights and updates an existing active member only',async()=>{const f=api({session:{...session,platformRoles:[]},contexts:[corporate()],response:(u,init)=>u.endsWith(`/members/${memberId}`)?Response.json({item:{...member,version:2,roles:JSON.parse(String(init?.body)).roles}}):undefined});vi.stubGlobal('fetch',f);page(`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}`);await screen.findByRole('option',{name:member.displayName});fireEvent.change(screen.getByLabelText('Участник компании'),{target:{value:memberId}});expect(await screen.findByText('Подпись недоступна: подтверждение полномочий отсутствует или недействительно')).toBeVisible();fireEvent.click(screen.getByLabelText('Администратор компании'));reason();fireEvent.click(screen.getByRole('button',{name:'Сохранить роли участника'}));expect(await screen.findByText('Изменения сохранены')).toBeVisible();const init=f.mock.calls.find(([u])=>String(u).endsWith(`/members/${memberId}`))![1]!;expect(new Headers(init.headers).get('X-Forum-Context')).toBe(`organization:${company}`);expect(new Headers(init.headers).get('If-Match')).toBe('"1"');expect(JSON.parse(String(init.body))).toEqual({roles:['organization_employee','organization_admin','organization_signer'],status:'active',reason:'Согласовано владельцем'});expect(String(init.body)).not.toContain('confirmed')})
it('company switch immediately discards unsaved changes without confirmation',async()=>{const f=api({session:{...session,platformRoles:[]},contexts:[corporate(),corporate(other)]});vi.stubGlobal('fetch',f);page(`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}`);await screen.findByRole('option',{name:member.displayName});reason();fireEvent.change(screen.getByLabelText('Область управления'),{target:{value:`organization:${other}`}});expect(screen.queryByRole('dialog',{name:'Отменить несохранённые изменения?'})).not.toBeInTheDocument();expect(await screen.findByText('Нет доступных участников')).toBeVisible();expect(screen.getByLabelText('Область управления')).toHaveValue(`organization:${other}`);expect(screen.getByLabelText('Причина изменения')).toHaveValue('');expect(f.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(false)})
it('My Organizations links roles only from authoritative IAM permissions',async()=>{vi.stubGlobal('fetch',api({session:{...session,platformRoles:[]},contexts:[corporate()]}));page('/cabinet/organizations/');expect(await screen.findByRole('link',{name:'Управление ролями компании'})).toHaveAttribute('href',`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}#main`);expect(screen.queryByRole('link',{name:'Пользователи'})).not.toBeInTheDocument();expect(screen.queryByText('Администрирование')).not.toBeInTheDocument();expect(screen.queryByText('Справочники')).not.toBeInTheDocument()})
it('reactivates a revoked assignment with its current version',async()=>{const revoked={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'revoked',version:4};const f=api({response:u=>u.startsWith('/api/iam/platform-users')?Response.json({items:[{userId:target,displayName:'Проверенный пользователь',platformRoles:[revoked]}],nextCursor:null}):u==='/api/iam/platform-role-assignments'?Response.json({item:{...revoked,status:'active',version:5}}):undefined});vi.stubGlobal('fetch',f);page();await chooseUser();selectModerator();fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));expect(await screen.findByText('Изменения сохранены')).toBeVisible();expect(new Headers(f.mock.calls.find(([u])=>u==='/api/iam/platform-role-assignments')![1]!.headers).get('If-Match')).toBe('"4"')})
it('uncertain grant retry preserves idempotency key for the same request',async()=>{let fail=true;const f=api({response:u=>u==='/api/iam/platform-role-assignments'?fail?new Response(null,{status:503}):Response.json({item:{id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}},{status:201}):undefined});vi.stubGlobal('fetch',f);page();await chooseUser();selectModerator();fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));await screen.findByText('Не удалось сохранить роли. Повторите попытку');fail=false;fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));await screen.findByText('Изменения сохранены');const calls=f.mock.calls.filter(([u])=>u==='/api/iam/platform-role-assignments');expect(calls).toHaveLength(2);expect(new Headers(calls[1][1]!.headers).get('Idempotency-Key')).toBe(new Headers(calls[0][1]!.headers).get('Idempotency-Key'))})
it('self admin revocation clears protected user data and refreshes staff navigation',async()=>{
 const mine={id:assignmentId,userId:owner,roleCode:'platform_admin',status:'active',version:1};let revoked=false
 const f=api({response:u=>{
  if(u==='/api/auth/session'&&revoked)return Response.json({...session,platformRoles:[]})
  if(u.startsWith('/api/iam/contexts')&&revoked)return Response.json({items:[],nextCursor:null})
  if(u.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{userId:owner,displayName:'Собственный администратор',status:'active',version:1,organizations:[],platformRoles:[mine]}],nextCursor:null})
  if(u.startsWith('/api/iam/platform-users'))return Response.json({items:[{userId:owner,displayName:'Собственный администратор',platformRoles:[mine]}],nextCursor:null})
  if(u.endsWith(`/platform-role-assignments/${assignmentId}`)){revoked=true;return Response.json({item:{...mine,status:'revoked',version:2}})}
 }})
 vi.stubGlobal('fetch',f);page();await chooseUser('Собственный администратор');fireEvent.click(screen.getByRole('button',{name:/Отозвать роль .* у Собственный администратор/}));expect(await screen.findByText('Нет доступа к управлению ролями')).toBeVisible();expect(screen.queryByRole('option',{name:'Собственный администратор'})).not.toBeInTheDocument();await waitFor(()=>{expect(screen.queryByRole('link',{name:'Пользователи'})).not.toBeInTheDocument();expect(screen.queryByText('Администрирование')).not.toBeInTheDocument();expect(screen.queryByText('Справочники')).not.toBeInTheDocument()})
})
it('revokes existing member access with reason and current membership version',async()=>{const f=api({session:{...session,platformRoles:[]},contexts:[corporate()],response:u=>u.endsWith(`/members/${memberId}`)?Response.json({item:{...member,status:'revoked',roles:[],effectiveRoles:[],permissions:[],version:2}}):undefined});vi.stubGlobal('fetch',f);page(`/cabinet/users/?context=${encodeURIComponent(`organization:${company}`)}`);await screen.findByRole('option',{name:member.displayName});fireEvent.change(screen.getByLabelText('Участник компании'),{target:{value:memberId}});reason();fireEvent.click(screen.getByRole('button',{name:'Отозвать доступ участника'}));expect(await screen.findByText('Изменения сохранены')).toBeVisible();expect(screen.queryByRole('option',{name:member.displayName})).not.toBeInTheDocument();const init=f.mock.calls.find(([u])=>String(u).endsWith(`/members/${memberId}`))![1]!;expect(new Headers(init.headers).get('If-Match')).toBe('"1"');expect(JSON.parse(String(init.body))).toEqual({roles:[],status:'revoked',reason:'Согласовано владельцем'})})
it('empty context roles cannot authorize a platform-management view',async()=>{vi.stubGlobal('fetch',api({contexts:[{...platform,roles:[]}]}));page();expect(await screen.findByText('Не удалось загрузить роли')).toBeVisible();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument()})
it('missing catalogue roles make authorization unavailable',async()=>{vi.stubGlobal('fetch',api({response:u=>u==='/api/iam/roles'?Response.json({items:[]}):undefined}));page();expect(await screen.findByText('Не удалось загрузить роли')).toBeVisible();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument()})
it('clearing a user immediately discards the role draft and returns focus to the picker',async()=>{vi.stubGlobal('fetch',api());page();await chooseUser();fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}));const select=screen.getByRole('button',{name:'Пользователь'});await clearUser();expect(screen.queryByRole('dialog',{name:'Отменить несохранённые изменения?'})).not.toBeInTheDocument();await waitFor(()=>expect(select).toHaveFocus());expect(select).toHaveTextContent('Выберите пользователя');expect(screen.getByRole('checkbox',{name:'Администратор платформы'})).not.toBeChecked();expect(screen.getByRole('button',{name:'Назначить роль'})).toBeDisabled()})
it('switching users immediately resets service role drafts without submitting them',async()=>{
 const f=api({response:u=>u.startsWith('/api/iam/platform-users')?Response.json({items:[{userId:target,displayName:'Проверенный пользователь',platformRoles:[]},{userId:other,displayName:'Другой пользователь',platformRoles:[]}],nextCursor:null}):undefined})
 vi.stubGlobal('fetch',f);page();await chooseUser();fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}));await chooseUser('Другой пользователь')
 expect(screen.queryByRole('dialog',{name:'Отменить несохранённые изменения?'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Другой пользователь');expect(screen.getByRole('checkbox',{name:'Администратор платформы'})).not.toBeChecked();expect(screen.getByRole('checkbox',{name:'Модератор платформы'})).not.toBeChecked();expect(f.mock.calls.some(([u,init])=>u==='/api/iam/platform-role-assignments'&&init?.method==='POST')).toBe(false)
})

it('platform users stay in platform context even when company management is available',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page();await screen.findByRole('button',{name:'Пользователь'})
 expect(screen.queryByLabelText('Область управления')).not.toBeInTheDocument()
 expect(screen.queryByRole('option',{name:'Платформа'})).not.toBeInTheDocument()
 expect(f.mock.calls.some(([u])=>u==='/api/me/organizations'||String(u).includes('/members'))).toBe(false)
 const resolves=f.mock.calls.filter(([u])=>u==='/api/iam/context/resolve')
 expect(resolves).toHaveLength(1)
 expect(JSON.parse(String(resolves[0][1]!.body))).toEqual({contextKey:'platform'})
})
it('platform users refuse company-only authority instead of opening the first organization',async()=>{
 const f=api({session:{...session,platformRoles:[]},contexts:[corporate()]});vi.stubGlobal('fetch',f);page()
 expect(await screen.findByText('Нет доступа к управлению ролями')).toBeVisible()
 expect(screen.queryByLabelText('Область управления')).not.toBeInTheDocument()
 expect(f.mock.calls.some(([u])=>u==='/api/iam/context/resolve'||String(u).includes('/members')||String(u).startsWith('/api/iam/platform-users'))).toBe(false)
})
it('company management retains its selector without exposing the platform context',async()=>{
 const f=api();vi.stubGlobal('fetch',f);page(organizationPath());await screen.findByRole('option',{name:member.displayName})
 expect(screen.getByLabelText('Область управления')).toHaveValue(`organization:${company}`)
 expect(screen.queryByRole('option',{name:'Платформа'})).not.toBeInTheDocument()
 expect(f.mock.calls.some(([u])=>String(u).startsWith('/api/iam/platform-users'))).toBe(false)
})

it('platform user management uses its new title without the role catalogue or reason field',async()=>{
 vi.stubGlobal('fetch',api());page();await screen.findByRole('button',{name:'Пользователь'})
 expect(screen.getByRole('heading',{level:1,name:'Управление пользователями'})).toBeVisible()
 expect(document.title).toBe('Управление пользователями | АСТ Форум')
 expect(screen.queryByRole('heading',{name:'Роли'})).not.toBeInTheDocument()
 expect(screen.queryByRole('region',{name:'Каталог ролей'})).not.toBeInTheDocument()
 expect(screen.queryByLabelText('Причина изменения')).not.toBeInTheDocument()
 expect(screen.getByRole('group',{name:'Служебные роли'})).toBeVisible()
})
it('company role changes still require a reason before making a request',async()=>{
 const f=api({session:{...session,platformRoles:[]},contexts:[corporate()]});vi.stubGlobal('fetch',f);page(organizationPath())
 await screen.findByRole('option',{name:member.displayName});fireEvent.change(screen.getByLabelText('Участник компании'),{target:{value:memberId}})
 expect(screen.getByRole('heading',{level:1,name:'Управление ролями'})).toBeVisible()
 expect(screen.getByRole('heading',{name:'Роли компании'})).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Сохранить роли участника'}));expect(await screen.findByText('Укажите причину изменения')).toBeVisible()
 expect(f.mock.calls.some(([u])=>String(u).endsWith(`/members/${memberId}`))).toBe(false)
})
it('tabs preserve the role draft and keep both panels mounted',async()=>{
 vi.stubGlobal('fetch',api());page();await chooseUser()
 expect(screen.getByRole('tab',{name:'Роли'})).toHaveAttribute('aria-selected','true')
 fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}))
 fireEvent.keyDown(screen.getByRole('tab',{name:'Блокировка входа'}),{key:'Enter'})
 expect(await screen.findByRole('heading',{name:'Пользователь для блокировки'})).toBeVisible()
 expect(screen.getAllByRole('tabpanel',{hidden:true})).toHaveLength(2)
 fireEvent.keyDown(screen.getByRole('tab',{name:'Роли'}),{key:'Enter'})
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Проверенный пользователь')
 expect(screen.getByRole('checkbox',{name:'Администратор платформы'})).toBeChecked()
 expect(screen.getByText('Нет пользователей со служебными ролями')).toBeVisible()
})
it('role saving prevents mouse and keyboard tab changes and refreshes directory roles',async()=>{
 let complete:(value:Response)=>void=()=>{},assigned=false
 const role={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}
 vi.stubGlobal('fetch',api({response:(url,init)=>{
  if(url==='/api/iam/platform-role-assignments'&&init?.method==='POST')return new Promise(resolve=>{complete=resolve})
  if(url.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',status:'active',version:1,organizations:[],platformRoles:assigned?[role]:[]}],nextCursor:null})
 }}));page();await chooseUser();selectModerator()
 fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}))
 const accessTab=screen.getByRole('tab',{name:'Блокировка входа'})
 fireEvent.mouseDown(accessTab);fireEvent.keyDown(accessTab,{key:'Enter'})
 expect(accessTab).toHaveAttribute('aria-selected','false')
 expect(screen.getByRole('button',{name:'Назначаем…'})).toBeVisible()
 assigned=true;complete(Response.json({item:role}))
 await waitFor(()=>expect(within(screen.getByRole('table',{name:'Пользователи со служебными ролями'})).getByText('Модератор платформы')).toBeVisible())
})
it('access tab exposes parent directory failure and retry restores its protected controls',async()=>{
 let unavailable=true
 vi.stubGlobal('fetch',api({response:url=>url.startsWith('/api/iam/platform-users')&&unavailable?new Response(null,{status:503}):undefined}));page()
 await screen.findByText('Не удалось загрузить роли')
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Блокировка входа'}))
 const panel=screen.getByRole('tabpanel',{name:'Блокировка входа'})
 expect(within(panel).getByText('Не удалось загрузить роли')).toBeVisible()
 expect(within(panel).getAllByRole('button',{name:'Повторить'})[0]).toBeVisible()
 expect(within(panel).queryByLabelText('Пользователь для блокировки')).not.toBeInTheDocument()
 expect(screen.queryByText('Проверенный пользователь')).not.toBeInTheDocument()
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 unavailable=false;fireEvent.click(within(panel).getAllByRole('button',{name:'Повторить'})[0])
 expect(await screen.findByRole('heading',{name:'Пользователь для блокировки'})).toBeVisible()
 expect(await screen.findByRole('button',{name:'Пользователь для блокировки'})).toBeVisible()
 expect(screen.getByRole('tab',{name:'Блокировка входа'})).toHaveAttribute('aria-selected','true')
})

it.each(['block','grant','revoke'])('late unblock selector refresh cannot undo a later %s mutation',async action=>{
 const a={userId:other,displayName:'Новый пользователь',status:'deactivated',version:1,organizations:[],platformRoles:[]}
 const initialRole={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}
 let b={userId:target,displayName:'Проверенный пользователь',status:'active',version:1,organizations:[],platformRoles:action==='revoke'?[initialRole]:[]}
 let aStatus='deactivated',readCount=0,staleItems:unknown[]=[],complete:(response:Response)=>void=()=>{}
 const eligible=()=>[{...a,organizations:[],status:aStatus},b].filter(item=>item.status==='active').map(({userId,displayName,platformRoles})=>({userId,displayName,platformRoles}))
 const f=api({response:(url,init)=>{
  if(url.startsWith('/api/iam/platform-users')){
   ++readCount
   if(readCount===2){staleItems=eligible();return new Promise(resolve=>{complete=resolve})}
   return Response.json({items:eligible(),nextCursor:null})
  }
  if(url.startsWith('/api/iam/platform-user-access')){
   if(init?.method==='PATCH'){
    const status=JSON.parse(String(init.body)).status
    if(url.endsWith(other)){aStatus=status;return Response.json({item:{...a,status,version:2}})}
    b={...b,organizations:[],status,version:2};return Response.json({item:{...b,platformRoles:undefined}})
   }
   return Response.json({items:[{...a,organizations:[],status:aStatus,version:aStatus==='active'?2:1},{...b,organizations:[]}],nextCursor:null})
  }
  if(url.startsWith('/api/iam/platform-role-assignments')&&['POST','PATCH'].includes(String(init?.method))){
   const updated={...initialRole,status:action==='revoke'?'revoked':'active',version:action==='revoke'?2:1}
   b={...b,platformRoles:[updated]};return Response.json({item:updated})
  }
 }})
 vi.stubGlobal('fetch',f);page();await chooseUser()
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Блокировка входа'}))
 fireEvent.click(await screen.findByRole('button',{name:'Разблокировать Новый пользователь'}))
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Разблокировать вход'}))
 await screen.findByText(/Вход пользователя «Новый пользователь» разрешён/)
 await waitFor(()=>expect(readCount).toBe(2))
 if(action==='block'){
  fireEvent.click(screen.getByRole('button',{name:'Пользователь для блокировки'}));fireEvent.click(await screen.findByRole('option',{name:/Проверенный пользователь/}))
  fireEvent.click(screen.getByRole('button',{name:'Заблокировать вход'}))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Заблокировать вход'}))
  await screen.findByText(/Вход пользователя «Проверенный пользователь» заблокирован/)
 }else{
  fireEvent.mouseDown(screen.getByRole('tab',{name:'Роли'}))
  if(action==='grant')selectModerator()
  fireEvent.click(screen.getByRole('button',{name:action==='grant'?'Назначить роль':/Отозвать роль .* у Проверенный пользователь/}))
  await screen.findByText('Изменения сохранены')
 }
 await act(async()=>{complete(Response.json({items:staleItems,nextCursor:null}))})
 if(action==='block'){
  fireEvent.mouseDown(screen.getByRole('tab',{name:'Роли'}))
  await openPicker();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument();fireEvent.keyDown(screen.getByRole('combobox',{name:'Поиск пользователя'}),{key:'Escape'})
 }else{
  if(action==='grant')expect(within(screen.getByRole('table',{name:'Пользователи со служебными ролями'})).getByText('Модератор платформы')).toBeVisible();else expect(screen.getByText('Нет пользователей со служебными ролями')).toBeVisible()
  if(action==='revoke')expect(screen.queryByRole('button',{name:/Отозвать роль .* у Проверенный пользователь/})).not.toBeInTheDocument()
 }
 await openPicker();expect(await screen.findByRole('option',{name:'Новый пользователь'})).toBeInTheDocument()
})

it('searches eligible users case-insensitively, reports an empty query result and clears selection',async()=>{
 vi.stubGlobal('fetch',api());page();const search=await openPicker()
 fireEvent.change(search,{target:{value:'ПРОВЕРЕННЫЙ'}});expect(screen.getByRole('option',{name:'Проверенный пользователь'})).toBeVisible()
 fireEvent.change(search,{target:{value:'нет такого имени'}});expect(await screen.findByText('Пользователи не найдены')).toBeVisible();expect(screen.queryByRole('option',{name:'Проверенный пользователь'})).not.toBeInTheDocument()
 fireEvent.change(search,{target:{value:'пользователь'}});fireEvent.click(screen.getByRole('option',{name:'Проверенный пользователь'}))
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Проверенный пользователь');await clearUser()
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Выберите пользователя');expect(screen.getByRole('button',{name:'Назначить роль'})).toBeDisabled()
})
it('multi-role grant preserves partial success and retries only the uncertain remainder with the same key',async()=>{
 let fail=true,granted=false
 const moderator={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}
 const admin={...moderator,id:memberId,roleCode:'platform_admin'}
 const f=api({response:(url,init)=>{
  if(url==='/api/iam/platform-role-assignments'){
   if(JSON.parse(String(init?.body)).roleCode==='platform_moderator'){granted=true;return Response.json({item:moderator},{status:201})}
   return fail?new Response(null,{status:503}):Response.json({item:admin},{status:201})
  }
  if(url.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',status:'active',version:1,organizations:[],platformRoles:granted?[moderator]:[]}],nextCursor:null})
 }});vi.stubGlobal('fetch',f);page();await chooseUser();selectModerator();fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}));fireEvent.click(screen.getByRole('button',{name:'Назначить роли'}))
 await screen.findByText('Назначено ролей: 1. Не удалось назначить оставшиеся роли. Повторите попытку')
 expect(screen.queryByText('Изменения сохранены')).not.toBeInTheDocument();expect(screen.getByRole('checkbox',{name:'Модератор платформы'})).toBeChecked();expect(screen.getByRole('checkbox',{name:'Модератор платформы'})).toBeDisabled();expect(screen.getByText('Уже назначена')).toBeVisible()
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));await screen.findByText('Изменения сохранены')
 const calls=f.mock.calls.filter(([url])=>url==='/api/iam/platform-role-assignments')
 expect(calls.map(([,init])=>JSON.parse(String(init?.body)).roleCode)).toEqual(['platform_moderator','platform_admin','platform_admin'])
 expect(new Headers(calls[1][1]?.headers).get('Idempotency-Key')).toBe(new Headers(calls[2][1]?.headers).get('Idempotency-Key'))
 expect(screen.getByRole('button',{name:'Назначить роль'})).toBeDisabled()
})
it.each(['active','deactivated'])('table revokes explicit row B (%s) while retaining selected A and its role draft',async status=>{
 let revoked=false
 const bRole={id:assignmentId,userId:other,roleCode:'platform_moderator',status:'active',version:4}
 const a={userId:target,displayName:'Проверенный пользователь',platformRoles:[]},b={userId:other,displayName:'Другой пользователь',platformRoles:[bRole]}
 const f=api({response:(url,init)=>{
  if(url.startsWith('/api/iam/platform-users'))return Response.json({items:status==='active'?[a,b]:[a],nextCursor:null})
  if(url.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{...a,organizations:[],status:'active',version:1},{...b,organizations:[],status,version:1,platformRoles:revoked?[]:[bRole]}],nextCursor:null})
  if(url.endsWith(`/platform-role-assignments/${assignmentId}`)&&init?.method==='PATCH'){revoked=true;return Response.json({item:{...bRole,status:'revoked',version:5}})}
 }});vi.stubGlobal('fetch',f);page();await chooseUser();fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}))
 fireEvent.click(await screen.findByRole('button',{name:'Отозвать роль Модератор платформы у Другой пользователь'}));await screen.findByText('Изменения сохранены')
 const init=f.mock.calls.find(([url])=>String(url).endsWith(`/platform-role-assignments/${assignmentId}`))![1]!
 expect(init.method).toBe('PATCH');expect(new Headers(init.headers).get('If-Match')).toBe('"4"');expect(new Headers(init.headers).get('X-Forum-Context')).toBe('platform');expect(new Headers(init.headers).get('X-Forum-CSRF')).toBe(session.csrfToken)
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent(a.displayName);expect(screen.getByRole('checkbox',{name:'Администратор платформы'})).toBeChecked();expect(screen.queryByRole('button',{name:/Отозвать роль .* у Другой пользователь/})).not.toBeInTheDocument()
 expect(screen.getByText('Нет пользователей со служебными ролями')).toBeVisible();expect(screen.getByRole('heading',{name:'Пользователи со служебными ролями'})).toHaveFocus()
})
it('retains uncertain partial-grant identity across an independent B row revoke with A draft intact',async()=>{
 let fail=true,moderatorGranted=false,bRevoked=false
 const moderator={id:assignmentId,userId:target,roleCode:'platform_moderator',status:'active',version:1}
 const admin={...moderator,id:memberId,roleCode:'platform_admin'}
 const bRole={id:company,userId:other,roleCode:'platform_moderator',status:'active',version:3}
 const a=()=>({userId:target,displayName:'Проверенный пользователь',platformRoles:moderatorGranted?[moderator]:[]})
 const b=()=>({userId:other,displayName:'Другой пользователь',platformRoles:bRevoked?[]:[bRole]})
 const f=api({response:(url,init)=>{
  if(url.startsWith('/api/iam/platform-users'))return Response.json({items:[a(),b()],nextCursor:null})
  if(url.startsWith('/api/iam/platform-user-access'))return Response.json({items:[{...a(),organizations:[],status:'active',version:1},{...b(),organizations:[],status:'deactivated',version:1}],nextCursor:null})
  if(url===`/api/iam/platform-role-assignments/${company}`){bRevoked=true;return Response.json({item:{...bRole,status:'revoked',version:4}})}
  if(url==='/api/iam/platform-role-assignments'){
   if(JSON.parse(String(init?.body)).roleCode==='platform_moderator'){moderatorGranted=true;return Response.json({item:moderator},{status:201})}
   return fail?new Response(null,{status:503}):Response.json({item:admin},{status:201})
  }
 }});vi.stubGlobal('fetch',f);page();await chooseUser();selectModerator();fireEvent.click(screen.getByRole('checkbox',{name:'Администратор платформы'}));fireEvent.click(screen.getByRole('button',{name:'Назначить роли'}))
 await screen.findByText('Назначено ролей: 1. Не удалось назначить оставшиеся роли. Повторите попытку')
 const uncertain=f.mock.calls.filter(([url])=>url==='/api/iam/platform-role-assignments')[1][1]!
 fireEvent.click(await screen.findByRole('button',{name:'Отозвать роль Модератор платформы у Другой пользователь'}));await screen.findByText('Изменения сохранены')
 expect(screen.getByRole('button',{name:'Пользователь'})).toHaveTextContent('Проверенный пользователь');expect(screen.getByRole('checkbox',{name:'Администратор платформы'})).toBeChecked();expect(screen.getByRole('checkbox',{name:'Модератор платформы'})).toBeDisabled()
 const revoke=f.mock.calls.find(([url])=>url===`/api/iam/platform-role-assignments/${company}`)![1]!
 expect(new Headers(revoke.headers).get('If-Match')).toBe('"3"');expect(new Headers(revoke.headers).get('Idempotency-Key')).not.toBe(new Headers(uncertain.headers).get('Idempotency-Key'))
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Назначить роль'}));await screen.findByText('Изменения сохранены')
 const grants=f.mock.calls.filter(([url])=>url==='/api/iam/platform-role-assignments')
 expect(grants.map(([,init])=>JSON.parse(String(init?.body)).roleCode)).toEqual(['platform_moderator','platform_admin','platform_admin'])
 expect(new Headers(grants[2][1]!.headers).get('Idempotency-Key')).toBe(new Headers(uncertain.headers).get('Idempotency-Key'))
})

it.each(['catalogue-scope','assignment-status','member-status'])('rejects nested %s in role management metadata',async kind=>{
 vi.stubGlobal('fetch',api({contexts:kind==='member-status'?[corporate()]:undefined,response:url=>{
  if(kind==='catalogue-scope'&&url==='/api/iam/roles')return Response.json({items:catalogue.map((item,index)=>index===0?{...item,scope:['person']}:item),nextCursor:null})
  if(kind==='assignment-status'&&url.startsWith('/api/iam/platform-users'))return Response.json({items:[{userId:target,displayName:'Проверенный пользователь',platformRoles:[{id:assignmentId,userId:target,roleCode:'platform_admin',status:['active'],version:1}]}],nextCursor:null})
  if(kind==='member-status'&&url.includes('/members'))return Response.json({items:[{...member,status:['active']}],nextCursor:null})
 }}));page(kind==='member-status'?organizationPath():undefined)
 expect(await screen.findByText('Не удалось загрузить роли')).toBeVisible()
 expect(screen.queryByRole('button',{name:'Назначить роль'})).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Сохранить роли компании'})).not.toBeInTheDocument()
})
it('role picker localizes actual search placeholder',async()=>{
 vi.stubGlobal('fetch',api());page();await openPicker()
 expect(screen.getByRole('combobox',{name:'Поиск пользователя'})).toHaveAttribute('placeholder','Поиск пользователя')
})
