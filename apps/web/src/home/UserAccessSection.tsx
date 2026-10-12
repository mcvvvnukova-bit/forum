import {useEffect,useRef,useState} from 'react'
import {Banner,Button,Dialog,FormControl,Heading,Select,Spinner,Stack,Text} from '@primer/react'
import {PlatformUsersTable} from './PlatformUsersTable'
import type {Session} from '../audience/intent'

type UserAccess={userId:string;displayName:string;status:'active'|'deactivated';version:number}
export type PlatformAssignment={id:string;userId:string;roleCode:'platform_admin'|'platform_moderator';status:'active'|'revoked';version:number}
export type UserDirectorySummary=UserAccess&{platformRoles:PlatformAssignment[]}
export type DirectorySnapshot={items:UserDirectorySummary[];state:State;retry:()=>void}
export type State='loading'|'ready'|'unavailable'|'stale'|'forbidden'
class AccessError extends Error {
 constructor(public status:number,public code:string){super(code)}
}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid object')
 return value as Record<string,unknown>
}
function userAccess(value:unknown):UserAccess{
 const item=object(value)
 if(typeof item.userId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.userId)
  ||typeof item.displayName!=='string'||!item.displayName.trim()||!['active','deactivated'].includes(String(item.status))
  ||typeof item.version!=='number'||!Number.isSafeInteger(item.version)||item.version<1)throw new Error('Invalid user access')
 return {userId:item.userId,displayName:item.displayName,status:item.status,version:item.version} as UserAccess
}
async function request(url:string,signal:AbortSignal,init:RequestInit={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init,signal})
 if(response.status!==200){
  let code='unavailable'
  try{code=String(object(await response.json()).code)}catch{/* Non-JSON upstream error. */}
  throw new AccessError(response.status,code)
 }
 return response.json() as Promise<unknown>
}
function directoryUser(value:unknown):UserDirectorySummary{
 const item=object(value),user=userAccess(value)
 if(!Array.isArray(item.platformRoles))throw new Error('Invalid platform roles')
 const ids=new Set<string>(),codes=new Set<string>()
 const platformRoles=item.platformRoles.map(value=>{
  const role=object(value)
  if(typeof role.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(role.id)||role.userId!==user.userId||!['platform_admin','platform_moderator'].includes(String(role.roleCode))||!['active','revoked'].includes(String(role.status))||typeof role.version!=='number'||!Number.isSafeInteger(role.version)||role.version<1||ids.has(role.id)||codes.has(String(role.roleCode)))throw new Error('Invalid platform role')
  ids.add(role.id);codes.add(String(role.roleCode));return role as PlatformAssignment
 })
 return {...user,platformRoles}
}
async function usersPage(signal:AbortSignal):Promise<UserDirectorySummary[]>{
 const users:UserDirectorySummary[]=[],cursors=new Set<string>(),ids=new Set<string>()
 let cursor:string|null=null
 do{
  const result=object(await request('/api/iam/platform-user-access'+(cursor?'?cursor='+encodeURIComponent(cursor):''),signal,{headers:{'X-Forum-Context':'platform'}}))
  if(!Array.isArray(result.items)||!(result.nextCursor===null||typeof result.nextCursor==='string'&&result.nextCursor.length>0))throw new Error('Invalid page')
  for(const value of result.items){const user=directoryUser(value);if(ids.has(user.userId))throw new Error('Duplicate user');ids.add(user.userId);users.push(user)}
  cursor=result.nextCursor as string|null
  if(cursor){if(cursors.has(cursor))throw new Error('Repeated cursor');cursors.add(cursor)}
 }while(cursor&&!signal.aborted)
 if(signal.aborted)throw new Error('Aborted')
 return users
}
export function UserAccessSection({session,revision,disabled,onBusyChange,onChanged,onExpired,onForbidden,onDirectoryChange}:{
 session:Session;revision:unknown;disabled:boolean;onBusyChange:(busy:boolean)=>void;onChanged:(userId:string,status:UserAccess['status'])=>void;onExpired:()=>void;onForbidden:()=>void;onDirectoryChange?:(snapshot:DirectorySnapshot)=>void
}){
 const [users,setUsers]=useState<UserDirectorySummary[]>([]),[selected,setSelected]=useState(''),[state,setState]=useState<State>('loading')
 const [attempt,setAttempt]=useState(0),[confirm,setConfirm]=useState(false),[saving,setSaving]=useState(false)
 const [message,setMessage]=useState(''),[error,setError]=useState('')
 const selectRef=useRef<HTMLSelectElement>(null),buttonRef=useRef<HTMLButtonElement>(null)
 const controller=useRef<AbortController|null>(null),generation=useRef(0),busy=useRef(false)
 const idempotency=useRef<{signature:string;key:string}|null>(null)
 const callbacks=useRef({onBusyChange,onChanged,onExpired,onForbidden,onDirectoryChange});callbacks.current={onBusyChange,onChanged,onExpired,onForbidden,onDirectoryChange}
 useEffect(()=>{callbacks.current.onDirectoryChange?.({items:users,state,retry:()=>setAttempt(value=>value+1)})},[users,state])
 const user=users.find(item=>item.userId===selected)
 function refusal(reason:unknown){
  if(reason instanceof AccessError&&[401,403,404,412].includes(reason.status)){
   setUsers([]);setConfirm(false);setError('');idempotency.current=null
   setState(reason.status===412?'stale':'forbidden')
   if(reason.status===401)callbacks.current.onExpired()
   if(reason.status===403)callbacks.current.onForbidden()
  }else setError(reason instanceof AccessError&&reason.code==='self_block'?'Нельзя заблокировать свой вход':reason instanceof AccessError&&reason.code==='last_admin'?'Нельзя заблокировать последнего администратора':'Не удалось изменить доступ. Повторите попытку')
 }
 useEffect(()=>{
  controller.current?.abort()
  const abort=new AbortController(),ticket=++generation.current
  controller.current=abort;busy.current=false;callbacks.current.onBusyChange(false);setSaving(false);setState('loading');setUsers([]);setConfirm(false);setError('');idempotency.current=null
  const timer=window.setTimeout(()=>abort.abort(),10_000)
  void usersPage(abort.signal).then(items=>{
   if(ticket!==generation.current)return
   setUsers(items);setSelected(value=>items.some(item=>item.userId===value)?value:'');setState('ready')
  }).catch(reason=>{
   if(ticket!==generation.current)return
   if(reason instanceof AccessError&&[401,403,404,412].includes(reason.status))refusal(reason)
   else{setState('unavailable');setSelected('')}
  }).finally(()=>window.clearTimeout(timer))
  return()=>{++generation.current;controller.current?.abort();callbacks.current.onBusyChange(false);window.clearTimeout(timer)}
 },[session.user.id,session.csrfToken,revision,attempt])
 async function changeAccess(){
  if(!user||state!=='ready'||busy.current||disabled||user.userId===session.user.id)return
  const target=user,status=target.status==='active'?'deactivated':'active',ticket=generation.current
  const signature=JSON.stringify([target.userId,status,target.version])
  if(idempotency.current?.signature!==signature)idempotency.current={signature,key:crypto.randomUUID()}
  const abort=new AbortController();controller.current?.abort();controller.current=abort
  const timer=window.setTimeout(()=>abort.abort(),10_000)
  busy.current=true;callbacks.current.onBusyChange(true);setSaving(true);setError('');setMessage('')
  try{
   const result=object(await request(`/api/iam/platform-user-access/${target.userId}`,abort.signal,{
    method:'PATCH',headers:{'Content-Type':'application/json','X-Forum-Context':'platform','X-Forum-CSRF':session.csrfToken!,
     'Idempotency-Key':idempotency.current.key,'If-Match':`"${target.version}"`},body:JSON.stringify({status})
   }))
   if(ticket!==generation.current)return
   const updated=userAccess(result.item)
   if(updated.userId!==target.userId||updated.status!==status||updated.version!==target.version+1)throw new Error('Invalid mutation result')
   setUsers(previous=>previous.map(item=>item.userId===updated.userId?{...item,...updated}:item));setConfirm(false);idempotency.current=null
   setMessage(status==='deactivated'?`Вход пользователя «${target.displayName}» заблокирован. Действующие сеансы завершены.`:`Вход пользователя «${target.displayName}» разрешён. Для продолжения работы нужно войти заново.`)
   callbacks.current.onChanged(updated.userId,updated.status)
  }catch(reason){if(ticket===generation.current){setConfirm(false);refusal(reason)}}
  finally{window.clearTimeout(timer);if(ticket===generation.current){busy.current=false;callbacks.current.onBusyChange(false);setSaving(false)}}
 }
 return <section aria-labelledby="user-access-heading"><Stack>
  <Heading as="h2" variant="small" id="user-access-heading">Блокировка пользователей</Heading>
  <Text>Блокировка запрещает вход на платформу и завершает все действующие сеансы. Назначенные роли сохраняются.</Text>
  {message&&<Text role="status">{message}</Text>}
  {state==='loading'&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем доступ пользователей…</Text></Stack>}
  {state!=='loading'&&state!=='ready'&&<Banner variant={state==='forbidden'?'critical':'warning'} title={state==='stale'?'Доступ изменился. Загрузите актуальные данные':state==='forbidden'?'Нет доступа к блокировке пользователей':'Не удалось загрузить доступ пользователей'} primaryAction={<Button onClick={()=>setAttempt(value=>value+1)}>Загрузить доступ заново</Button>}/>}
  {error&&<Banner variant="critical" title={error}/>}
  {state==='ready'&&<>
   <FormControl disabled={saving||disabled}><FormControl.Label>Пользователь для блокировки</FormControl.Label><Select ref={selectRef} block value={selected} onChange={event=>{setSelected(event.target.value);setMessage('');setError('');idempotency.current=null}}>
    <Select.Option value="">Выберите пользователя</Select.Option>
    {users.map(item=><Select.Option key={item.userId} value={item.userId}>{item.displayName} — {item.status==='active'?'вход разрешён':'вход заблокирован'}</Select.Option>)}
   </Select></FormControl>
   {!users.length&&<Text>Нет доступных пользователей</Text>}
   {user&&<Text>Статус входа: {user.status==='active'?'разрешён':'заблокирован'}</Text>}
   {user?.userId===session.user.id&&<Text>Нельзя заблокировать свой вход на платформу.</Text>}
   <Button ref={buttonRef} variant={!user||user.status==='deactivated'?'primary':'danger'} disabled={saving||disabled||!user||user.userId===session.user.id} onClick={()=>setConfirm(true)}>
    {saving?'Сохраняем…':user?.status==='deactivated'?'Разблокировать вход':'Заблокировать вход'}
   </Button>
  </>}
  <PlatformUsersTable title="Заблокированные пользователи" items={users.filter(item=>item.status==='deactivated')} state={state} onRetry={()=>setAttempt(value=>value+1)} disabled={saving||disabled} onUnblock={item=>{if(busy.current||disabled)return;setSelected(item.userId);setError('');setMessage('');setConfirm(true)}}/>
  {confirm&&user&&<Dialog title={user.status==='active'?'Заблокировать вход пользователя?':'Разблокировать вход пользователя?'} returnFocusRef={buttonRef} onClose={()=>{if(!busy.current)setConfirm(false)}} footerButtons={[
   {content:'Отмена',disabled:saving,onClick:()=>setConfirm(false)},
   {content:saving?'Сохраняем…':user.status==='active'?'Заблокировать вход':'Разблокировать вход',buttonType:user.status==='active'?'danger':'primary',disabled:saving||disabled,onClick:()=>void changeAccess()}
  ]}><Text>{user.status==='active'?`Пользователь «${user.displayName}» потеряет доступ к платформе. Все его действующие сеансы будут завершены.`:`Пользователь «${user.displayName}» снова сможет войти на платформу с ранее назначенными ролями. Старые сеансы останутся закрыты.`}</Text></Dialog>}
 </Stack></section>
}
