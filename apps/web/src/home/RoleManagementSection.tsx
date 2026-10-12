import {useEffect,useRef,useState,type FormEvent} from 'react'
import {Banner,Button,Checkbox,CheckboxGroup,Dialog,FormControl,Heading,Select,SelectPanel,Spinner,Stack,Text,Textarea} from '@primer/react'
import type {Session} from '../audience/intent'
import {FeatureFlags} from '@primer/react/experimental'
import {UnderlinePanels} from '@primer/react/experimental'
import {UserAccessSection,type DirectorySnapshot,type PlatformAssignment} from './UserAccessSection'
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
 const v=record(value);if(typeof v.code!=='string'||!Object.hasOwn(labels,v.code)||(typeof v.scope!=='string'||!['person','organization','platform'].includes(v.scope))||!strings(v.permissions)||(v.conditionalPermissions!==undefined&&!strings(v.conditionalPermissions)))throw new Error('Invalid role')
 const scope=v.code==='individual'?'person':platformRoles.includes(v.code as RoleCode)?'platform':'organization'
 if(v.scope!==scope)throw new Error('Invalid role scope');return v as Role
}
function assignment(value:unknown,userId:string):Assignment{
 const v=record(value);if(!id(v.id)||v.userId!==userId||(typeof v.roleCode!=='string'||!platformRoles.includes(v.roleCode as RoleCode))||(typeof v.status!=='string'||!['active','revoked'].includes(v.status))||!version(v.version))throw new Error('Invalid assignment');return v as Assignment
}
function platformUser(value:unknown):PlatformUser{
 const v=record(value);if(!id(v.userId)||typeof v.displayName!=='string'||!v.displayName.trim()||!Array.isArray(v.platformRoles))throw new Error('Invalid user')
 const assignments=v.platformRoles.map(x=>assignment(x,v.userId as string));if(new Set(assignments.map(x=>x.roleCode)).size!==assignments.length)throw new Error('Duplicate role')
 return {...v,platformRoles:assignments} as PlatformUser
}
function member(value:unknown):Member{
 const v=record(value);if(!id(v.id)||!id(v.userId)||typeof v.displayName!=='string'||!v.displayName.trim()||(typeof v.status!=='string'||!['pending','active','revoked'].includes(v.status))||!version(v.version)||!roles(v.roles)||!roles(v.effectiveRoles)||!strings(v.permissions)||[...v.roles,...v.effectiveRoles].some(r=>!corporateRoles.includes(r)))throw new Error('Invalid member');return v as Member
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
 const [selected,setSelected]=useState(''),[choices,setChoices]=useState<RoleCode[]>(['platform_moderator']),[duties,setDuties]=useState<RoleCode[]>([])
 const [reason,setReason]=useState(''),[invalid,setInvalid]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[saveError,setSaveError]=useState('')
 const [pending,setPending]=useState<{key?:string;selected?:string}|null>(null)
 const [pickerOpen,setPickerOpen]=useState(false),[search,setSearch]=useState('')
 const [tab,setTab]=useState('roles')
 const [directory,setDirectory]=useState<DirectorySnapshot>({items:[],state:'loading',retry:()=>{}})
 const [accessSaving,setAccessSaving]=useState(false)
 const [accessRevision,setAccessRevision]=useState(0)
 const usersRefresh=useRef<AbortController|null>(null),usersReadVersion=useRef(0),interruptedUsersRefresh=useRef(false)
 const generation=useRef(0),controller=useRef<AbortController|null>(null),submitting=useRef(false),mounted=useRef(true),expired=useRef(onExpired)
 const idempotency=useRef(new Map<string,string>()),resolved=useRef<RoleContext|null>(null),scopeRef=useRef<HTMLSelectElement>(null),userRef=useRef<HTMLButtonElement>(null),memberRef=useRef<HTMLSelectElement>(null)
 expired.current=onExpired
 const platform=key==='platform',user=users.find(u=>u.userId===selected),selectedMember=members.find(m=>m.id===selected)
 const newRoles=choices.filter(code=>!user?.platformRoles.some(role=>role.roleCode===code&&role.status==='active'))
 const dirty=!!reason.trim()||platform&&choices.join(',')!=='platform_moderator'||!!selectedMember&&duties.join(',')!==corporateRoles.filter(r=>selectedMember.roles.includes(r)).join(',')
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();cancelUsersRefresh()}},[])
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 function cancelUsersRefresh(){++usersReadVersion.current;usersRefresh.current?.abort();usersRefresh.current=null}
 function refreshPlatformUsers(){
  if(!mounted.current||resolved.current?.contextKey!=='platform')return
  cancelUsersRefresh()
  const abort=new AbortController(),readVersion=usersReadVersion.current,ticket=generation.current
  usersRefresh.current=abort
  const timer=window.setTimeout(()=>abort.abort(),10_000)
  void pages('/api/iam/platform-users',abort.signal,platformUser,{'X-Forum-Context':'platform'}).then(items=>{
   if(mounted.current&&ticket===generation.current&&readVersion===usersReadVersion.current&&!abort.signal.aborted)setUsers(items)
  }).catch(error=>{if(mounted.current&&ticket===generation.current&&readVersion===usersReadVersion.current)failure(error)}).finally(()=>{window.clearTimeout(timer);if(usersRefresh.current===abort)usersRefresh.current=null})
 }
 function accessBusyChanged(busy:boolean){
  if(busy){interruptedUsersRefresh.current=usersRefresh.current!==null;cancelUsersRefresh()}
  else if(interruptedUsersRefresh.current){interruptedUsersRefresh.current=false;refreshPlatformUsers()}
  setAccessSaving(busy)
 }
 function clearData(){interruptedUsersRefresh.current=false;cancelUsersRefresh();setDirectory({items:[],state:'loading',retry:()=>setAccessRevision(value=>value+1)});resolved.current=null;setUsers([]);setMembers([]);setSelected('');setPickerOpen(false);setSearch('');setChoices(['platform_moderator']);setDuties([]);setReason('');setSaveError('');setSaved(false);idempotency.current.clear()}
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
  setPending(null);setReason('');setChoices(['platform_moderator']);setInvalid(false);setSaved(false);setSaveError('');idempotency.current.clear()
  if(next.key!==undefined){controller.current?.abort();generation.current++;clearData();setKey(next.key);setState('loading');const url=new URL(location.href);url.searchParams.set('context',next.key);history.replaceState(history.state,'',url)}
  if(next.selected!==undefined){setSelected(next.selected);const m=members.find(x=>x.id===next.selected);setDuties(m?corporateRoles.filter(r=>m.roles.includes(r)):[])}
 }
 async function mutate(url:string,body:Record<string,unknown>,currentVersion?:number,targetUserId=selected,batch?:RoleCode[],expectedRole?:RoleCode){
  if(submitting.current||accessSaving||!resolved.current||state!=='ready')return
  // Platform actions record their own audit description without asking for a manual reason.
  const auditReason=platform?(body.status==='revoked'?'Отзыв служебной роли через управление пользователями':'Назначение служебной роли через управление пользователями'):reason.trim()
  if(!auditReason||auditReason.length>1000){setInvalid(true);return}
  const refreshPending=platform&&usersRefresh.current!==null
  cancelUsersRefresh()
  submitting.current=true;setSaving(true);setSaved(false);setSaveError('');setInvalid(false)
  const snapshot=resolved.current,abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),10_000),ticket=generation.current
  controller.current=abort
  let completed=0
  try{
   for(const nextRole of batch??[undefined]){
   if(nextRole){body={targetUserId,roleCode:nextRole};currentVersion=users.find(item=>item.userId===targetUserId)?.platformRoles.find(role=>role.roleCode===nextRole&&role.status==='revoked')?.version}
  const payload=JSON.stringify({...body,reason:auditReason}),headers:Record<string,string>={'Content-Type':'application/json','Origin':location.origin,'X-Forum-Context':snapshot.contextKey,'X-Forum-CSRF':session.csrfToken!}
  const operation=JSON.stringify([url,payload,currentVersion??null])
  if(!idempotency.current.has(operation))idempotency.current.set(operation,crypto.randomUUID())
  headers['Idempotency-Key']=idempotency.current.get(operation)!;if(currentVersion!==undefined)headers['If-Match']=`"${currentVersion}"`
   const result=record(await request(url,abort.signal,{method:url==='/api/iam/platform-role-assignments'?'POST':'PATCH',headers,body:payload}))
   if(!mounted.current||ticket!==generation.current)return
   if(snapshot.contextKey==='platform'){
    const updated=assignment(result.item,targetUserId);if(updated.roleCode!==body.roleCode&&url==='/api/iam/platform-role-assignments'||url!== '/api/iam/platform-role-assignments'&&(updated.id!==url.split('/').at(-1)||expectedRole!==undefined&&updated.roleCode!==expectedRole)||updated.status!==(body.status??'active')||updated.version<=(currentVersion??0))throw new Error('Invalid mutation result')
    if(updated.userId===session.user.id&&updated.roleCode==='platform_admin'&&updated.status==='revoked'){failure(new Refusal(403,'forbidden'));expired.current();return}
    setUsers(old=>old.map(u=>u.userId===targetUserId?{...u,platformRoles:[...u.platformRoles.filter(r=>r.roleCode!==updated.roleCode),updated]}:u))
    setDirectory(old=>({...old,items:old.items.map(item=>item.userId===targetUserId?{...item,platformRoles:[...item.platformRoles.filter(role=>role.roleCode!==updated.roleCode),updated as PlatformAssignment]}:item)}))
    setAccessRevision(value=>value+1)
   }else{
    const updated=member(result.item);if(updated.id!==selected||updated.userId!==selectedMember?.userId||updated.version<=(currentVersion??0))throw new Error('Invalid member result')
    if(updated.userId===session.user.id&&!updated.permissions.includes('organization.members.manage')){failure(new Refusal(403,'forbidden'));expired.current();return}
    setMembers(old=>old.map(m=>m.id===selected?updated:m));if(updated.status==='revoked')setSelected('');setDuties(corporateRoles.filter(r=>updated.roles.includes(r)))
   }
   completed++;idempotency.current.delete(operation)
   }
   setReason('');if(!platform||batch)setChoices(['platform_moderator']);setSaved(true)
  }catch(error){if(mounted.current&&ticket===generation.current){if(error instanceof Refusal&&[401,403,404,412].includes(error.status))failure(error);else setSaveError(error instanceof Refusal&&error.code==='last_admin'?'Нельзя отозвать последнего действующего администратора':completed?`Назначено ролей: ${completed}. Не удалось назначить оставшиеся роли. Повторите попытку`:'Не удалось сохранить роли. Повторите попытку')}}
  finally{window.clearTimeout(timer);submitting.current=false;if(mounted.current){setSaving(false);if(refreshPending)refreshPlatformUsers()}}
 }
 function submit(event:FormEvent){event.preventDefault();if(platform&&user&&newRoles.length)void mutate('/api/iam/platform-role-assignments',{targetUserId:user.userId},undefined,user.userId,newRoles);else if(selectedMember?.status==='active'&&duties.length)void mutate(`/api/iam/organizations/${key.slice(13)}/members/${selectedMember.id}`,{roles:duties,status:'active'},selectedMember.version)}
 function accessChanged(userId:string,status:'active'|'deactivated'){
  const refreshPending=interruptedUsersRefresh.current||usersRefresh.current!==null
  interruptedUsersRefresh.current=false;cancelUsersRefresh()
  if(status==='deactivated'){
   setUsers(previous=>previous.filter(item=>item.userId!==userId))
   if(selected===userId){setSelected('');setChoices(['platform_moderator']);setSaved(false);setSaveError('');idempotency.current.clear()}
   if(refreshPending)refreshPlatformUsers()
  }else refreshPlatformUsers()
 }
 if(!validRoleSession(session))return <Banner variant="warning" title="Не удалось проверить права доступа"/>
 const feedback=<>
  {state==='loading'&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем роли…</Text></Stack>}
  {['unavailable','forbidden','stale'].includes(state)&&<Banner variant={state==='forbidden'?'critical':'warning'} title={state==='forbidden'?'Нет доступа к управлению ролями':state==='stale'?'Данные изменились. Загрузите актуальные права':'Не удалось загрузить роли'} primaryAction={<Button onClick={()=>{setKey('');setAttempt(n=>n+1)}}>Повторить</Button>}/>}
 </>
 const roleForm=<Stack>
  {organizationManagement&&contexts.length>0&&<FormControl disabled={saving||accessSaving}><FormControl.Label>Область управления</FormControl.Label><Select ref={scopeRef} value={key} onChange={e=>change({key:e.target.value})} block>{contexts.map(c=><Select.Option key={c.contextKey} value={c.contextKey}>{companyLabels[c.contextKey.slice(13)]??`Название и ИНН недоступны — компания ${c.contextKey.slice(13)}`}</Select.Option>)}</Select></FormControl>}
  {(!platform||tab==='roles')&&feedback}
  {state==='ready'&&<>
   {!platform&&<section aria-label="Каталог ролей"><Heading as="h2" variant="small">Роли компании</Heading><Stack>{catalogue.filter(r=>r.scope==='organization').map(r=><Text key={r.code}>{labels[r.code]}{r.conditionalPermissions?.includes('organization.documents.sign')?' — подпись требует отдельного подтверждения':''}</Text>)}</Stack></section>}
   {saved&&<Text role="status">Изменения сохранены</Text>}{saveError&&<Banner variant="critical" title={saveError}/>}
   <form onSubmit={submit} noValidate><Stack>
    {platform?<Stack><Text as="label" id="platform-user-label">Пользователь</Text><SelectPanel title="Выберите пользователя" placeholderText="Поиск пользователя" inputLabel="Поиск пользователя" anchorRef={userRef} open={pickerOpen} onOpenChange={open=>{if(!saving&&!accessSaving)setPickerOpen(open)}} selected={user?{id:user.userId,text:user.displayName}:undefined} onSelectedChange={(item:{id?:string|number}|undefined)=>{if(!saving&&!accessSaving){change({selected:String(item?.id??'')});setPickerOpen(false);setSearch('')}}} filterValue={search} onFilterChange={setSearch} items={users.filter(item=>item.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item=>({id:item.userId,text:item.displayName}))} message={search&&!users.some(item=>item.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()))?{title:'Пользователи не найдены',body:'Попробуйте другое имя',variant:'empty'}:undefined} renderAnchor={props=><Button {...props} ref={userRef} aria-labelledby="platform-user-label" disabled={saving||accessSaving}>{user?.displayName??'Выберите пользователя'}</Button>} secondaryAction={<SelectPanel.SecondaryActionButton disabled={saving||accessSaving||!selected} onClick={()=>{change({selected:''});setPickerOpen(false)}}>Очистить выбор</SelectPanel.SecondaryActionButton>}/></Stack>:<FormControl disabled={saving||accessSaving}><FormControl.Label>Участник компании</FormControl.Label><Select ref={memberRef} value={selected} block onChange={e=>change({selected:e.target.value})}><Select.Option value="">Выберите участника</Select.Option>{members.filter(m=>m.status==='active').map(item=><Select.Option key={item.id} value={item.id}>{item.displayName}</Select.Option>)}</Select></FormControl>}
    {!(platform?users.length:members.filter(m=>m.status==='active').length)&&<Text>Нет доступных участников</Text>}
    {platform&&<CheckboxGroup><CheckboxGroup.Label>Служебные роли</CheckboxGroup.Label>{(['platform_moderator','platform_admin'] as const).map(code=>{const active=user?.platformRoles.some(role=>role.roleCode===code&&role.status==='active');return <FormControl key={code} disabled={saving||accessSaving||active}><Checkbox value={code} checked={active||choices.includes(code)} onChange={e=>{setChoices(previous=>e.target.checked?[...previous,code]:previous.filter(role=>role!==code));idempotency.current.clear()}}/><FormControl.Label>{labels[code]}</FormControl.Label>{active&&<FormControl.Caption>Уже назначена</FormControl.Caption>}</FormControl>})}</CheckboxGroup>}
    {selectedMember&&<Stack><Text>Действующие роли: {selectedMember.effectiveRoles.map(r=>labels[r]).join(', ')||'Нет'}</Text>{corporateRoles.map(r=><FormControl disabled={saving||accessSaving} key={r}><Checkbox checked={duties.includes(r)} onChange={e=>setDuties(previous=>corporateRoles.filter(x=>x===r?e.target.checked:previous.includes(x)))}/><FormControl.Label>{labels[r]}</FormControl.Label></FormControl>)}{selectedMember.roles.includes('organization_signer')&&<Text>{selectedMember.permissions.includes('organization.documents.sign')?'Подпись доступна только в подтверждённой области документа':'Подпись недоступна: подтверждение полномочий отсутствует или недействительно'}</Text>}</Stack>}
    {selectedMember?.status==='active'&&<Button variant="danger" disabled={saving||accessSaving} onClick={()=>void mutate(`/api/iam/organizations/${key.slice(13)}/members/${selectedMember.id}`,{roles:[],status:'revoked'},selectedMember.version)}>Отозвать доступ участника</Button>}
    {!platform&&<FormControl required disabled={saving||accessSaving}><FormControl.Label>Причина изменения</FormControl.Label><Textarea aria-label="Причина изменения" value={reason} onChange={e=>{setReason(e.target.value);setInvalid(false)}} block maxLength={1000} rows={3}/>{invalid&&<FormControl.Validation variant="error">Укажите причину изменения</FormControl.Validation>}</FormControl>}
    <Button variant="primary" type="submit" disabled={saving||accessSaving||!selected||!platform&&!duties.length||platform&&!newRoles.length}>{saving?'Назначаем…':platform?newRoles.length>1?'Назначить роли':'Назначить роль':'Сохранить роли участника'}</Button>
   </Stack></form>

  </>}
  {pending&&<Dialog title="Отменить несохранённые изменения?" returnFocusRef={pending.selected!==undefined?platform?userRef:memberRef:scopeRef} onClose={()=>setPending(null)} footerButtons={[{content:'Продолжить редактирование',onClick:()=>setPending(null)},{content:'Отменить изменения',buttonType:'danger',onClick:()=>apply(pending)}]}><Text>При смене области или участника несохранённые изменения будут отменены.</Text></Dialog>}
 </Stack>
 return platform?<FeatureFlags flags={{primer_react_underline_panels_controlled:true}}><UnderlinePanels aria-label="Управление пользователями" value={tab} onChange={({value})=>{if(!submitting.current&&!accessSaving)setTab(value)}}>
  <UnderlinePanels.Tab value="roles">Роли</UnderlinePanels.Tab>
  <UnderlinePanels.Tab value="access">Блокировка входа</UnderlinePanels.Tab>
  <UnderlinePanels.Panel value="roles"><Stack paddingBlock="normal">{roleForm}{state==='ready'&&<PlatformUsersTable title="Пользователи со служебными ролями" items={directory.items} state={directory.state} onRetry={directory.retry} rolesOnly disabled={saving||accessSaving} onRevoke={(item,role)=>void mutate(`/api/iam/platform-role-assignments/${role.id}`,{status:'revoked'},role.version,item.userId,undefined,role.roleCode)}/>}</Stack></UnderlinePanels.Panel>
  <UnderlinePanels.Panel value="access"><Stack paddingBlock="normal">{state==='ready'?<UserAccessSection session={session} revision={accessRevision} disabled={saving} onBusyChange={accessBusyChanged} onDirectoryChange={setDirectory} onChanged={accessChanged} onExpired={()=>failure(new Refusal(401,'unauthenticated'))} onForbidden={()=>{failure(new Refusal(403,'forbidden'));expired.current()}}/>:tab==='access'&&feedback}</Stack></UnderlinePanels.Panel>
 </UnderlinePanels></FeatureFlags>:roleForm
}
