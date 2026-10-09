import {useEffect,useRef,useState,type FormEvent} from 'react'
import {Banner,Button,FormControl,Spinner,Stack,Text,TextInput} from '@primer/react'
import {ClockIcon} from '@primer/octicons-react'
import {DataTable,Table} from '@primer/react/experimental'
import './organizations.css'
type Role='organization_admin'|'organization_signer'|'organization_employee'
type Organization={id:string;inn:string;name:string|null;status:'pending'|'active';members:{userId:string;fullName:string;roles:Role[]}[]}
const labels:Record<Role,string>={organization_admin:'Администратор компании',organization_signer:'Лицо с правом подписи',organization_employee:'Сотрудник компании'}
function validInn(inn:string){
 if(!/^([0-9]{10}|[0-9]{12})$/.test(inn)||/^0+$/.test(inn))return false
 const checksum=(weights:number[])=>weights.reduce((sum,w,i)=>sum+w*Number(inn[i]),0)%11%10
 return inn.length===10?checksum([2,4,10,3,5,9,4,6,8])===Number(inn[9]):checksum([7,2,4,10,3,5,9,4,6,8])===Number(inn[10])&&checksum([3,7,2,4,10,3,5,9,4,6,8])===Number(inn[11])
}
function organization(value:unknown):Organization{
 if(!value||typeof value!=='object')throw new Error('Invalid card')
 const item=value as Organization
 if(typeof item.id!=='string'||!validInn(item.inn)||!(item.name===null||typeof item.name==='string')||!['pending','active'].includes(item.status)||!Array.isArray(item.members))throw new Error('Invalid card')
 if(item.status==='pending')return {...item,members:[]}
 if(item.members.some(m=>typeof m.userId!=='string'||typeof m.fullName!=='string'||!Array.isArray(m.roles)||m.roles.some(r=>!(r in labels))))throw new Error('Invalid member')
 return item
}
function merge(previous:Organization[],incoming:Organization[]){
 const cards=new Map(previous.map(item=>[item.inn,item]))
 for(const item of incoming)cards.set(item.inn,item)
 return [...cards.values()].sort((a,b)=>a.inn.localeCompare(b.inn))
}
export function Organizations({userId,onExpired}:{userId:string;onExpired:()=>void}){
 const [items,setItems]=useState<Organization[]>([]),[cursor,setCursor]=useState<string|null>(null)
 const [loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0)
 const [inn,setInn]=useState(''),[invalid,setInvalid]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(false),[saved,setSaved]=useState(false)
 const active=useRef(true),submitting=useRef(false),expired=useRef(onExpired)
 const generation=useRef(0),requestController=useRef<AbortController|null>(null)
 const loadedThrough=useRef(''),savedCards=useRef(new Map<string,Organization>())
 expired.current=onExpired
 useEffect(()=>{active.current=true;return()=>{active.current=false;requestController.current?.abort()}},[])
 function beginRequest(){
  requestController.current?.abort()
  const request={version:++generation.current,controller:new AbortController()}
  requestController.current=request.controller
  return request
 }
 function current(version:number){return active.current&&generation.current===version}
 async function read(next:string|null,request:ReturnType<typeof beginRequest>){
  const response=await fetch('/api/me/organizations'+(next?'?cursor='+encodeURIComponent(next):''),{credentials:'same-origin',cache:'no-store',signal:request.controller.signal})
  if(!current(request.version))return null
  if(response.status===401){expired.current();return null}
  if(response.status!==200)throw new Error('Unavailable')
  const result=await response.json() as {userId:unknown;items:unknown[];nextCursor:unknown}
  if(result.userId!==userId||!Array.isArray(result.items)||!(result.nextCursor===null||typeof result.nextCursor==='string'))throw new Error('Invalid list')
  return current(request.version)?{items:result.items.map(organization),nextCursor:result.nextCursor as string|null}:null
 }
 async function refresh(request:ReturnType<typeof beginRequest>){
  // Re-read the previously loaded range; never carry member snapshots into a fresh list.
  const through=loadedThrough.current
  let next:string|null=null,fresh:Organization[]=[]
  do{
   const page=await read(next,request)
   if(!page)return
   fresh=merge(fresh,page.items);next=page.nextCursor
  }while(next&&(!fresh.length||fresh[fresh.length-1].inn<through))
  if(current(request.version)){
   loadedThrough.current=fresh.at(-1)?.inn??''
   // Pending POST cards outside that range remain visible until their authoritative page arrives.
   setItems(merge([...savedCards.current.values()],fresh));setCursor(next);setError(false)
  }
 }
 useEffect(()=>{
  const request=beginRequest(),timer=window.setTimeout(()=>request.controller.abort(),10_000)
  setLoading(true);setError(false)
  void refresh(request).catch(()=>{if(current(request.version))setError(true)}).finally(()=>{window.clearTimeout(timer);if(current(request.version))setLoading(false)})
  return()=>{request.controller.abort();window.clearTimeout(timer)}
 // userId changes remount this owned view; attempts refresh the loaded range.
 },[userId,attempt])
 async function more(){
  if(loading||submitting.current||!cursor)return
  const request=beginRequest(),timer=window.setTimeout(()=>request.controller.abort(),10_000)
  setLoading(true);setError(false)
  try{const result=await read(cursor,request);if(result&&current(request.version)){loadedThrough.current=result.items.at(-1)?.inn??loadedThrough.current;setItems(old=>merge(old,result.items));setCursor(result.nextCursor)}}catch{if(current(request.version))setError(true)}finally{window.clearTimeout(timer);if(current(request.version))setLoading(false)}
 }
 async function recoverList(){
  const request=beginRequest(),timer=window.setTimeout(()=>request.controller.abort(),10_000)
  setLoading(true);setError(false)
  try{await refresh(request)}catch{if(current(request.version))setError(true)}finally{window.clearTimeout(timer);if(current(request.version))setLoading(false)}
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(submitting.current)return
  setSaved(false);setSaveError(false)
  if(!validInn(inn)){setInvalid(true);return}
  const interruptedRead=loading
  setInvalid(false);submitting.current=true;setSaving(true)
  const request=beginRequest(),timer=window.setTimeout(()=>request.controller.abort(),10_000)
  setLoading(interruptedRead)
  try{
   const response=await fetch('/api/me/organizations',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({inn}),signal:request.controller.signal})
   if(!current(request.version))return
   if(response.status===401){expired.current();return}
   if(response.status!==200&&response.status!==201)throw new Error('Save unavailable')
   const result=await response.json() as {userId:unknown;item:unknown}
   if(result.userId!==userId)throw new Error('Invalid owner')
   const item=organization(result.item)
   if(!current(request.version))return
   savedCards.current.set(item.inn,item)
   setItems(old=>merge(old,[item]));setInn('');setSaved(true)
   try{
    await refresh(request)
   }catch{if(current(request.version))setError(true)}
  }catch{
   if(current(request.version)){
    setSaveError(true)
    if(interruptedRead){submitting.current=false;setSaving(false);void recoverList()}
   }
  }finally{window.clearTimeout(timer);submitting.current=false;if(current(request.version)){setSaving(false);setLoading(false)}}
 }
 return <Stack gap="spacious" className="organizations-view">
  <form noValidate aria-label="Добавить организацию" onSubmit={event=>void submit(event)} className="organization-form">
   <FormControl required disabled={saving} className="organization-form-fields">
    <FormControl.Label>ИНН</FormControl.Label>
    <TextInput className="organization-inn" value={inn} onChange={event=>{setInn(event.target.value);setInvalid(false)}} aria-label="ИНН" inputMode="numeric" autoComplete="off" block aria-invalid={invalid?'true':undefined}/>
    <Button className="organization-add" type="submit" variant="primary" disabled={saving}>{saving?'Сохраняем…':'Добавить'}</Button>
    {invalid&&<FormControl.Validation variant="error">Проверьте ИНН: 10 или 12 цифр и контрольную сумму</FormControl.Validation>}
   </FormControl>
  </form>
  {saved&&<Text role="status">Организация сохранена</Text>}
  {saveError&&<Banner variant="critical" title="Не удалось сохранить организацию. Повторите попытку"/>}
  {error&&<Banner variant="critical" title="Не удалось загрузить организации" primaryAction={<Button disabled={saving} onClick={()=>setAttempt(n=>n+1)}>Повторить</Button>}/>}
  {loading&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем организации…</Text></Stack>}
  {!loading&&!error&&!items.length&&<Text>У вас пока нет организаций</Text>}
  {!!items.length&&<div className="organizations-table"><Table.Container><DataTable aria-labelledby="organizations-heading" data={items} columns={[
   {header:'ИНН',field:'inn',rowHeader:true,width:'auto'},
   {header:'Название организации',field:'name',renderCell:item=><Stack gap="condensed"><Text>{item.name??'Название появится после подтверждения'}</Text>{item.status==='pending'&&<Stack direction="horizontal" align="center" gap="condensed" className="muted"><ClockIcon aria-hidden="true"/><Text size="small">Ожидает подтверждения</Text></Stack>}</Stack>},
   {header:'Пользователи и роли',field:'members',renderCell:item=>item.status==='pending'?<Text className="muted">Доступ появится после подтверждения</Text>:<Stack gap="normal">{item.members.map(member=><Stack key={member.userId} gap="condensed"><Text weight="semibold">{member.fullName}</Text>{member.roles.length?member.roles.map(role=><Text size="small" key={role}>{labels[role]}</Text>):<Text size="small" className="muted">Роль не назначена</Text>}</Stack>)}</Stack>},
  ]}/></Table.Container></div>}
  {cursor&&<Button disabled={loading||saving} onClick={()=>void more()}>Показать ещё</Button>}
 </Stack>
}
