import {useEffect,useRef,useState,type FormEvent} from 'react'
import {Banner,Button,Checkbox,Dialog,FormControl,Heading,Select,Spinner,Stack,Text,Textarea} from '@primer/react'
import type {Session} from '../audience/intent'
import {FeatureFlags} from '@primer/react/experimental'
import {UnderlinePanels} from '@primer/react/experimental'
import {UserAccessSection,type DirectorySnapshot} from './UserAccessSection'
import {PlatformUsersTable} from './PlatformUsersTable'

type RoleCode='individual'|'organization_employee'|'organization_admin'|'organization_signer'|'platform_moderator'|'platform_admin'
export type RoleContext={contextKey:string;participantId:string|null;roles:RoleCode[];permissions:string[];accessVersion:number}
type Role={code:RoleCode;scope:'person'|'organization'|'platform';permissions:string[];conditionalPermissions?:string[]}
type Assignment={id:string;userId:string;roleCode:RoleCode;status:'active'|'revoked';version:number}
type PlatformUser={userId:string;displayName:string;platformRoles:Assignment[]}
type Member={id:string;userId:string;displayName:string;status:'pending'|'active'|'revoked';version:number;roles:RoleCode[];effectiveRoles:RoleCode[];permissions:string[]}
type State='loading'|'ready'|'unavailable'|'forbidden'|'stale'|'expired'
const labels:Record<RoleCode,string>={individual:'Физическое лицо',organization_employee:'Сотрудник компании',organization_admin:'Администратор компании',organization_signer:'Лицо с правом подписи',platform_moderator:'Модератор платформы',platform_admin:'Администратор платформы'}
const corporateRoles:RoleCode[]=['organization_employee','organization_admin','organization_signer']
const platformRoles:RoleCode[]=['platform_admin','platform_moderator']
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid object');return value as Record<string,unknown>}
function strings(value:unknown):value is string[]{return Array.isArray(value)&&value.every(x=>typeof x==='string')}
function roles(value:unknown):value is RoleCode[]{return strings(value)&&value.every(x=>Object.hasOwn(labels,x))&&new Set(value).size===value.length}
function version(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0}
function id(value:unknown):value is string{return typeof value==='string'&&uuid.test(value)}
function context(value:unknown,userId:string):RoleContext{
 const v=record(value)
 if(!(v.contextKey==='platform'||v.contextKey===`person:${userId}`||typeof v.contextKey==='string'&&v.contextKey.startsWith('organization:')&&id(v.contextKey.slice(13)))||!(v.participantId===null||id(v.participantId))||!roles(v.roles)||!v.roles.length||!strings(v.permissions)||!version(v.accessVersion))throw new Error('Invalid context')
 // Reject scope-mismatched roles rather than interpreting them as authority.
 const allowed=v.contextKey==='platform'?platformRoles:v.contextKey===`person:${userId}`?['individual']:corporateRoles
 if(v.roles.some(r=>!allowed.includes(r)))throw new Error('Invalid scope')
 return v as RoleContext
}
function role(value:unknown):Role{
 const v=record(value);if(typeof v.code!=='string'||!Object.hasOwn(labels,v.code)||!['person','organization','platform'].includes(String(v.scope))||!strings(v.permissions)||(v.conditionalPermissions!==undefined&&!strings(v.conditionalPermissions)))throw new Error('Invalid role')
 const scope=v.code==='individual'?'person':platformRoles.includes(v.code as RoleCode)?'platform':'organization'
 if(v.scope!==scope)throw new Error('Invalid role scope');return v as Role
}
function assignment(value:unknown,userId:string):Assignment{
 const v=record(value);if(!id(v.id)||v.userId!==userId||!platformRoles.includes(v.roleCode as RoleCode)||!['active','revoked'].includes(String(v.status))||!version(v.version))throw new Error('Invalid assignment');return v as Assignment
}
function platformUser(value:unknown):PlatformUser{
 const v=record(value);if(!id(v.userId)||typeof v.displayName!=='string'||!v.displayName.trim()||!Array.isArray(v.platformRoles))throw new Error('Invalid user')
 const assignments=v.platformRoles.map(x=>assignment(x,v.userId as string));if(new Set(assignments.map(x=>x.roleCode)).size!==assignments.length)throw new Error('Duplicate role')
 return {...v,platformRoles:assignments} as PlatformUser
}
function member(value:unknown):Member{
 const v=record(value);if(!id(v.id)||!id(v.userId)||typeof v.displayName!=='string'||!v.displayName.trim()||!['pending','active','revoked'].includes(String(v.status))||!version(v.version)||!roles(v.roles)||!roles(v.effectiveRoles)||!strings(v.permissions)||[...v.roles,...v.effectiveRoles].some(r=>!corporateRoles.includes(r)))throw new Error('Invalid member');return v as Member
}
class Refusal extends Error{constructor(public status:number,public code:string){super(code)}}
async function request(url:string,signal:AbortSignal,init:RequestInit={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init,signal})
 if(response.status!==200&&response.status!==201){let code='unavailable';try{code=String((await response.json()).code)}catch{/* Unavailable non-JSON upstream. */}throw new Refusal(response.status,code)}
 return response.json() as Promise<unknown>
}
async function pages<T>(url:string,signal:AbortSignal,parse:(v:unknown)=>T,headers?:HeadersInit):Promise<T[]>{
 let cursor:string|null=null;const items:T[]=[],seen=new Set<string>()
 do{const result=record(await request(url+(cursor?'?cursor='+encodeURIComponent(cursor):''),signal,{headers}));if(!Array.isArray(result.items)||!(result.nextCursor===null||typeof result.nextCursor==='string'))throw new Error('Invalid page');items.push(...result.items.map(parse));cursor=result.nextCursor as string|null;if(cursor){if(seen.has(cursor))throw new Error('Repeated cursor');seen.add(cursor)}}while(cursor&&!signal.aborted)
 if(signal.aborted)throw new Error('Aborted');return items
}
export function validRoleSession(session:Session){return Array.isArray(session.platformRoles)&&session.platformRoles.every(r=>platformRoles.includes(r as RoleCode))&&new Set(session.platformRoles).size===session.platformRoles.length&&version(session.accessVersion)&&typeof session.csrfToken==='string'&&/^[\w-]{43}$/.test(session.csrfToken)}
export function canManagePlatform(session:Session){return validRoleSession(session)&&session.platformRoles!.includes('platform_admin')}
export async function manageableContexts(userId:string,signal:AbortSignal){
 const items=await pages('/api/iam/contexts',signal,v=>context(v,userId));if(new Set(items.map(c=>c.contextKey)).size!==items.length)throw new Error('Duplicate context')
 return items.filter(c=>c.contextKey==='platform'?c.permissions.includes('platform.roles.manage'):c.contextKey.startsWith('organization:')&&c.permissions.includes('organization.members.manage'))
}
async function organizationLabels(userId:string,signal:AbortSignal){
 let cursor:string|null=null;const names:Record<string,string>={},seen=new Set<string>()
 do{
  const result=record(await request('/api/me/organizations'+(cursor?'?cursor='+encodeURIComponent(cursor):''),signal))
  if(result.userId!==userId||!Array.isArray(result.items)||!(result.nextCursor===null||typeof result.nextCursor==='string'))throw new Error('Invalid organization metadata')
  for(const value of result.items){
   const item=record(value);if(!id(item.id)||typeof item.inn!=='string'||!/^([0-9]{10}|[0-9]{12})$/.test(item.inn)||!(item.name===null||typeof item.name==='string')||Object.hasOwn(names,item.id))throw new Error('Invalid organization metadata')
   names[item.id]=`${typeof item.name==='string'&&item.name.trim()?item.name.trim():'Название недоступно'} — ИНН ${item.inn}`
  }
  cursor=result.nextCursor as string|null;if(cursor){if(seen.has(cursor))throw new Error('Repeated organization cursor');seen.add(cursor)}
 }while(cursor&&!signal.aborted)
 if(signal.aborted)throw new Error('Aborted');return names
}
export function RoleManagementSection({session,onExpired}:{session:Session;onExpired:()=>void}){
 const organizationManagement=new URLSearchParams(location.search).get('context')?.startsWith('organization:')??false
 const [contexts,setContexts]=useState<RoleContext[]>([]),[key,setKey]=useState(''),[catalogue,setCatalogue]=useState<Role[]>([])
 const [companyLabels,setCompanyLabels]=useState<Record<string,string>>({})
 const [users,setUsers]=useState<PlatformUser[]>([]),[members,setMembers]=useState<Member[]>([]),[state,setState]=useState<State>('loading'),[attempt,setAttempt]=useState(0)
 const [selected,setSelected]=useState(''),[roleCode,setRoleCode]=useState<RoleCode>('platform_moderator'),[duties,setDuties]=useState<RoleCode[]>([])
 const [reason,setReason]=useState(''),[invalid,setInvalid]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[saveError,setSaveError]=useState('')
 const [pending,setPending]=useState<{key?:string;selected?:string}|null>(null)
 const [tab,setTab]=useState('roles')
 const [directory,setDirectory]=useState<DirectorySnapshot>({items:[],state:'loading',retry:()=>{}})
 const [accessSaving,setAccessSaving]=useState(false)
 const [accessRevision,setAccessRevision]=useState(0)
 const generation=useRef(0),controller=useRef<AbortController|null>(null),submitting=useRef(false),mounted=useRef(true),expired=useRef(onExpired)
 const idempotency=useRef<{body:string;url:string;key:string}|null>(null),resolved=useRef<RoleContext|null>(null),scopeRef=useRef<HTMLSelectElement>(null),userRef=useRef<HTMLSelectElement>(null)
 expired.current=onExpired
 const platform=key==='platform',user=users.find(u=>u.userId===selected),selectedMember=members.find(m=>m.id===selected)
 const dirty=!!reason.trim()||platform&&roleCode!=='platform_moderator'||!!selectedMember&&duties.join(',')!==corporateRoles.filter(r=>selectedMember.roles.includes(r)).join(',')
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()}},[])
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 function clearData(){setDirectory({items:[],state:'loading',retry:()=>setAccessRevision(value=>value+1)});resolved.current=null;setUsers([]);setMembers([]);setSelected('');setDuties([]);setReason('');setSaveError('');setSaved(false);idempotency.current=null}
 function failure(error:unknown){clearData();if(error instanceof Refusal&&error.status===401){setState('expired');expired.current()}else setState(error instanceof Refusal&&[403,404].includes(error.status)?'forbidden':error instanceof Refusal&&error.status===412?'stale':'unavailable')}
 // Authorization contexts are local to this view. Resolving one does not alter the shared session.
 useEffect(()=>{
  if(!validRoleSession(session)){setState('unavailable');return}
  const abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),10_000);let active=true
  setState('loading');setContexts([]);clearData()
  void Promise.all([manageableContexts(session.user.id,abort.signal),request('/api/iam/roles',abort.signal)]).then(([items,result])=>{
   if(!active)return
   const values=record(result).items;if(!Array.isArray(values))throw new Error('Invalid catalogue')
   const parsed=values.map(role);if(parsed.length!==Object.keys(labels).length||new Set(parsed.map(r=>r.code)).size!==parsed.length)throw new Error('Duplicate catalogue')
   // The administrator page is platform-only. Company roles require an explicit organization link.
   const available=items.filter(c=>organizationManagement?c.contextKey.startsWith('organization:'):c.contextKey==='platform')
   const requested=new URLSearchParams(location.search).get('context'),initial=requested??'platform'
   setCatalogue(parsed);setContexts(available)
   if(!available.some(c=>c.contextKey===initial)){setKey('');setState('forbidden');return}
   setKey(initial)
  }).catch(error=>{if(active)failure(error)}).finally(()=>window.clearTimeout(timer))
  return()=>{active=false;abort.abort();window.clearTimeout(timer)}
 // Retrying must refresh both the catalogue and authoritative contexts.
 },[session,attempt,organizationManagement])
 // Names only decorate contexts already authorized by IAM; they never add a scope or grant.
 useEffect(()=>{
  setCompanyLabels({});if(!contexts.some(c=>c.contextKey.startsWith('organization:')))return
  const abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),10_000);let active=true
  void organizationLabels(session.user.id,abort.signal).then(names=>{if(active)setCompanyLabels(names)}).catch(error=>{if(active&&error instanceof Refusal&&error.status===401)failure(error)}).finally(()=>window.clearTimeout(timer))
  return()=>{active=false;abort.abort();window.clearTimeout(timer)}
 },[contexts,session.user.id])
 useEffect(()=>{
  if(!key||!contexts.some(c=>c.contextKey===key))return
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const ticket=++generation.current,timer=window.setTimeout(()=>abort.abort(),10_000)
  setState('loading');clearData()
  void (async()=>{
   const result=context(await request('/api/iam/context/resolve',abort.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contextKey:key})}),session.user.id)
   if(result.contextKey!==key)throw new Error('Wrong context')
   if(!result.permissions.includes(key==='platform'?'platform.roles.manage':'organization.members.manage'))throw new Refusal(403,'forbidden')
   const data=key==='platform'?await pages('/api/iam/platform-users',abort.signal,platformUser,{'X-Forum-Context':key}):await pages(`/api/iam/organizations/${key.slice(13)}/members`,abort.signal,member,{'X-Forum-Context':key})
   if(!mounted.current||ticket!==generation.current||abort.signal.aborted)return
   if(new Set(data.map(x=>'id' in x?x.id:x.userId)).size!==data.length)throw new Error('Duplicate item')
   resolved.current=result;if(key==='platform')setUsers(data as PlatformUser[]);else setMembers(data as Member[]);setState('ready')
  })().catch(error=>{if(mounted.current&&ticket===generation.current)failure(error)}).finally(()=>window.clearTimeout(timer))
  return()=>{generation.current++;abort.abort();window.clearTimeout(timer)}
 },[key,contexts,session.user.id])
 function change(next:{key?:string;selected?:string}){
  if(submitting.current||accessSaving)return
  if(dirty){setPending(next);return}
  apply(next)
 }
 function apply(next:{key?:string;selected?:string}){
  setPending(null);setReason('');setRoleCode('platform_moderator');setInvalid(false);setSaved(false);setSaveError('');idempotency.current=null
  if(next.key!==undefined){controller.current?.abort();generation.current++;clearData();setKey(next.key);setState('loading');const url=new URL(location.href);url.searchParams.set('context',next.key);history.replaceState(history.state,'',url)}
  if(next.selected!==undefined){setSelected(next.selected);const m=members.find(x=>x.id===next.selected);setDuties(m?corporateRoles.filter(r=>m.roles.includes(r)):[])}
 }
 async function mutate(url:string,body:Record<string,unknown>,currentVersion?:number){
  if(submitting.current||accessSaving||!resolved.current||state!=='ready')return
  // Platform actions record their own audit description without asking for a manual reason.
  const auditReason=platform?(body.status==='revoked'?'Отзыв служебной роли через управление пользователями':'Назначение служебной роли через управление пользователями'):reason.trim()
  if(!auditReason||auditReason.length>1000){setInvalid(true);return}
  submitting.current=true;setSaving(true);setSaved(false);setSaveError('');setInvalid(false)
  const snapshot=resolved.current,abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),10_000),ticket=generation.current
  controller.current=abort
  const payload=JSON.stringify({...body,reason:auditReason}),headers:Record<string,string>={'Content-Type':'application/json','Origin':location.origin,'X-Forum-Context':snapshot.contextKey,'X-Forum-CSRF':session.csrfToken!}
  if(!idempotency.current||idempotency.current.body!==payload||idempotency.current.url!==url)idempotency.current={body:payload,url,key:crypto.randomUUID()}
  headers['Idempotency-Key']=idempotency.current.key;if(currentVersion!==undefined)headers['If-Match']=`"${currentVersion}"`
  try{
   const result=record(await request(url,abort.signal,{method:url==='/api/iam/platform-role-assignments'?'POST':'PATCH',headers,body:payload}))
   if(!mounted.current||ticket!==generation.current)return
   if(snapshot.contextKey==='platform'){
    const updated=assignment(result.item,selected);if(updated.roleCode!==body.roleCode&&url==='/api/iam/platform-role-assignments'||url!== '/api/iam/platform-role-assignments'&&updated.id!==url.split('/').at(-1)||updated.status!==(body.status??'active')||updated.version<(currentVersion??0))throw new Error('Invalid mutation result')
    if(updated.userId===session.user.id&&updated.roleCode==='platform_admin'&&updated.status==='revoked'){failure(new Refusal(403,'forbidden'));expired.current();return}
    setUsers(old=>old.map(u=>u.userId===selected?{...u,platformRoles:[...u.platformRoles.filter(r=>r.roleCode!==updated.roleCode),updated]}:u))
    setAccessRevision(value=>value+1)
   }else{
    const updated=member(result.item);if(updated.id!==selected||updated.userId!==selectedMember?.userId||updated.version<=(currentVersion??0))throw new Error('Invalid member result')
    if(updated.userId===session.user.id&&!updated.permissions.includes('organization.members.manage')){failure(new Refusal(403,'forbidden'));expired.current();return}
    setMembers(old=>old.map(m=>m.id===selected?updated:m));if(updated.status==='revoked')setSelected('');setDuties(corporateRoles.filter(r=>updated.roles.includes(r)))
   }
   setReason('');setRoleCode('platform_moderator');idempotency.current=null;setSaved(true)
  }catch(error){if(mounted.current&&ticket===generation.current){if(error instanceof Refusal&&[401,403,404,412].includes(error.status))failure(error);else setSaveError(error instanceof Refusal&&error.code==='last_admin'?'Нельзя отозвать последнего действующего администратора':'Не удалось сохранить роли. Повторите попытку')}}
  finally{window.clearTimeout(timer);submitting.current=false;if(mounted.current)setSaving(false)}
 }
 function submit(event:FormEvent){event.preventDefault();if(platform&&user){const existing=user.platformRoles.find(r=>r.roleCode===roleCode);void mutate('/api/iam/platform-role-assignments',{targetUserId:user.userId,roleCode},existing?.status==='revoked'?existing.version:undefined)}else if(selectedMember?.status==='active'&&duties.length)void mutate(`/api/iam/organizations/${key.slice(13)}/members/${selectedMember.id}`,{roles:duties,status:'active'},selectedMember.version)}
 function accessChanged(userId:string,status:'active'|'deactivated'){
  if(status==='deactivated'){
   setUsers(previous=>previous.filter(item=>item.userId!==userId))
   if(selected===userId){setSelected('');setRoleCode('platform_moderator');setSaved(false);setSaveError('');idempotency.current=null}
  }else{
   const signal=controller.current?.signal,ticket=generation.current
   if(signal)void pages('/api/iam/platform-users',signal,platformUser,{'X-Forum-Context':'platform'}).then(items=>{
    if(mounted.current&&ticket===generation.current)setUsers(items)
   }).catch(error=>{if(mounted.current&&ticket===generation.current)failure(error)})
  }
 }
 if(!validRoleSession(session))return <Banner variant="warning" title="Не удалось проверить права доступа"/>
 const roleForm=<Stack>
  {organizationManagement&&contexts.length>0&&<FormControl disabled={saving||accessSaving}><FormControl.Label>Область управления</FormControl.Label><Select ref={scopeRef} value={key} onChange={e=>change({key:e.target.value})} block>{contexts.map(c=><Select.Option key={c.contextKey} value={c.contextKey}>{companyLabels[c.contextKey.slice(13)]??`Название и ИНН недоступны — компания ${c.contextKey.slice(13)}`}</Select.Option>)}</Select></FormControl>}
  {state==='loading'&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем роли…</Text></Stack>}
  {['unavailable','forbidden','stale'].includes(state)&&<Banner variant={state==='forbidden'?'critical':'warning'} title={state==='forbidden'?'Нет доступа к управлению ролями':state==='stale'?'Данные изменились. Загрузите актуальные права':'Не удалось загрузить роли'} primaryAction={<Button onClick={()=>{setKey('');setAttempt(n=>n+1)}}>Повторить</Button>}/>}
  {state==='ready'&&<>
   {!platform&&<section aria-label="Каталог ролей"><Heading as="h2" variant="small">Роли компании</Heading><Stack>{catalogue.filter(r=>r.scope==='organization').map(r=><Text key={r.code}>{labels[r.code]}{r.conditionalPermissions?.includes('organization.documents.sign')?' — подпись требует отдельного подтверждения':''}</Text>)}</Stack></section>}
   {saved&&<Text role="status">Изменения сохранены</Text>}{saveError&&<Banner variant="critical" title={saveError}/>}
   <form onSubmit={submit} noValidate><Stack>
    <FormControl disabled={saving||accessSaving}><FormControl.Label>{platform?'Пользователь':'Участник компании'}</FormControl.Label><Select ref={userRef} value={selected} block onChange={e=>change({selected:e.target.value})}><Select.Option value="">Выберите {platform?'пользователя':'участника'}</Select.Option>{(platform?users:members.filter(m=>m.status==='active')).map(item=><Select.Option key={'id' in item?item.id:item.userId} value={'id' in item?item.id:item.userId}>{item.displayName}</Select.Option>)}</Select></FormControl>
    {!(platform?users.length:members.filter(m=>m.status==='active').length)&&<Text>Нет доступных участников</Text>}
    {platform&&<FormControl disabled={saving||accessSaving}><FormControl.Label>Служебная роль</FormControl.Label><Select value={roleCode} block onChange={e=>{setRoleCode(e.target.value as RoleCode);idempotency.current=null}}><Select.Option value="platform_moderator">Модератор платформы</Select.Option><Select.Option value="platform_admin">Администратор платформы</Select.Option></Select></FormControl>}
    {user&&<Stack>{user.platformRoles.map(r=><Stack key={r.id}><Text>{labels[r.roleCode]} — {r.status==='active'?'действует':'отозвана'}</Text>{r.status==='active'&&<Button disabled={saving||accessSaving} onClick={()=>void mutate(`/api/iam/platform-role-assignments/${r.id}`,{status:'revoked'},r.version)}>Отозвать роль</Button>}</Stack>)}</Stack>}
    {selectedMember&&<Stack><Text>Действующие роли: {selectedMember.effectiveRoles.map(r=>labels[r]).join(', ')||'Нет'}</Text>{corporateRoles.map(r=><FormControl disabled={saving||accessSaving} key={r}><Checkbox checked={duties.includes(r)} onChange={e=>setDuties(previous=>corporateRoles.filter(x=>x===r?e.target.checked:previous.includes(x)))}/><FormControl.Label>{labels[r]}</FormControl.Label></FormControl>)}{selectedMember.roles.includes('organization_signer')&&<Text>{selectedMember.permissions.includes('organization.documents.sign')?'Подпись доступна только в подтверждённой области документа':'Подпись недоступна: подтверждение полномочий отсутствует или недействительно'}</Text>}</Stack>}
    {selectedMember?.status==='active'&&<Button variant="danger" disabled={saving||accessSaving} onClick={()=>void mutate(`/api/iam/organizations/${key.slice(13)}/members/${selectedMember.id}`,{roles:[],status:'revoked'},selectedMember.version)}>Отозвать доступ участника</Button>}
    {!platform&&<FormControl required disabled={saving||accessSaving}><FormControl.Label>Причина изменения</FormControl.Label><Textarea aria-label="Причина изменения" value={reason} onChange={e=>{setReason(e.target.value);setInvalid(false)}} block maxLength={1000} rows={3}/>{invalid&&<FormControl.Validation variant="error">Укажите причину изменения</FormControl.Validation>}</FormControl>}
    <Button variant="primary" type="submit" disabled={saving||accessSaving||!selected||!platform&&!duties.length}>{saving?'Назначаем…':platform?'Назначить роль':'Сохранить роли участника'}</Button>
   </Stack></form>

  </>}
  {pending&&<Dialog title="Отменить несохранённые изменения?" returnFocusRef={pending.selected!==undefined?userRef:scopeRef} onClose={()=>setPending(null)} footerButtons={[{content:'Продолжить редактирование',onClick:()=>setPending(null)},{content:'Отменить изменения',buttonType:'danger',onClick:()=>apply(pending)}]}><Text>При смене области или участника несохранённые изменения будут отменены.</Text></Dialog>}
 </Stack>
 return platform?<FeatureFlags flags={{primer_react_underline_panels_controlled:true}}><UnderlinePanels aria-label="Управление пользователями" value={tab} onChange={({value})=>{if(!submitting.current&&!accessSaving)setTab(value)}}>
  <UnderlinePanels.Tab value="roles">Служебные роли</UnderlinePanels.Tab>
  <UnderlinePanels.Tab value="access">Блокировка входа</UnderlinePanels.Tab>
  <UnderlinePanels.Panel value="roles"><Stack>{roleForm}{state==='ready'&&<PlatformUsersTable title="Все зарегистрированные пользователи" items={directory.items} state={directory.state} onRetry={directory.retry}/>}</Stack></UnderlinePanels.Panel>
  <UnderlinePanels.Panel value="access">{state==='ready'&&<UserAccessSection session={session} revision={accessRevision} disabled={saving} onBusyChange={setAccessSaving} onDirectoryChange={setDirectory} onChanged={accessChanged} onExpired={()=>failure(new Refusal(401,'unauthenticated'))} onForbidden={()=>{failure(new Refusal(403,'forbidden'));expired.current()}}/>}</UnderlinePanels.Panel>
 </UnderlinePanels></FeatureFlags>:roleForm
}
