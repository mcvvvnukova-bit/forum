import {useEffect,useRef,useState,type FormEvent} from 'react'
import {Banner,Button,FormControl,Spinner,Stack,Text,TextInput} from '@primer/react'
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
 expired.current=onExpired
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 async function read(next:string|null,signal?:AbortSignal){
  const response=await fetch('/api/me/organizations'+(next?'?cursor='+encodeURIComponent(next):''),{credentials:'same-origin',cache:'no-store',signal})
  if(response.status===401){if(active.current)expired.current();return null}
  if(response.status!==200)throw new Error('Unavailable')
  const result=await response.json() as {userId:unknown;items:unknown[];nextCursor:unknown}
  if(result.userId!==userId||!Array.isArray(result.items)||!(result.nextCursor===null||typeof result.nextCursor==='string'))throw new Error('Invalid list')
  return {items:result.items.map(organization),nextCursor:result.nextCursor as string|null}
 }
 useEffect(()=>{
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),10_000)
  let current=true
  setLoading(true);setError(false)
  void read(null,controller.signal).then(result=>{if(current&&result){setItems(result.items);setCursor(result.nextCursor)}}).catch(()=>{if(current)setError(true)}).finally(()=>{window.clearTimeout(timer);if(current)setLoading(false)})
  return()=>{current=false;controller.abort();window.clearTimeout(timer)}
 // userId changes remount this owned view; attempts reload the first page.
 },[userId,attempt])
 async function more(){
  if(loading||!cursor)return
  setLoading(true);setError(false)
  try{const result=await read(cursor);if(result&&active.current){setItems(old=>merge(old,result.items));setCursor(result.nextCursor)}}catch{if(active.current)setError(true)}finally{if(active.current)setLoading(false)}
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(submitting.current)return
  setSaved(false);setSaveError(false)
  if(!validInn(inn)){setInvalid(true);return}
  setInvalid(false);submitting.current=true;setSaving(true)
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),10_000)
  try{
   const response=await fetch('/api/me/organizations',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({inn}),signal:controller.signal})
   if(!active.current)return
   if(response.status===401){expired.current();return}
   if(response.status!==200&&response.status!==201)throw new Error('Save unavailable')
   const result=await response.json() as {userId:unknown;item:unknown}
   if(result.userId!==userId)throw new Error('Invalid owner')
   const item=organization(result.item)
   setItems(old=>old.some(existing=>existing.inn===item.inn&&existing.status==='active')?old:merge(old,[item]));setInn('');setSaved(true)
   try{
    const refreshed=await read(null,controller.signal)
    if(active.current&&refreshed){setItems(refreshed.items);setCursor(refreshed.nextCursor)}
   }catch{if(active.current)setError(true)}
  }catch{if(active.current)setSaveError(true)}finally{window.clearTimeout(timer);submitting.current=false;if(active.current)setSaving(false)}
 }
 return <Stack gap="spacious" className="organizations-view">
  <form noValidate aria-label="Добавить организацию" onSubmit={event=>void submit(event)} className="organization-form">
   <FormControl required>
    <FormControl.Label>ИНН</FormControl.Label>
    <TextInput value={inn} onChange={event=>{setInn(event.target.value);setInvalid(false)}} aria-label="ИНН" inputMode="numeric" autoComplete="off" block disabled={saving} aria-invalid={invalid?'true':undefined}/>
    <FormControl.Caption>10 цифр для юридического лица или 12 для индивидуального предпринимателя</FormControl.Caption>
    {invalid&&<FormControl.Validation variant="error">Проверьте ИНН: 10 или 12 цифр и контрольную сумму</FormControl.Validation>}
   </FormControl>
   <Button type="submit" variant="primary" disabled={saving}>{saving?'Сохраняем…':'Добавить'}</Button>
  </form>
  {saved&&<Text role="status">Организация сохранена</Text>}
  {saveError&&<Banner variant="critical" title="Не удалось сохранить организацию. Повторите попытку"/>}
  {error&&<Banner variant="critical" title="Не удалось загрузить организации" primaryAction={<Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button>}/>}
  {loading&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем организации…</Text></Stack>}
  {!loading&&!error&&!items.length&&<Text>У вас пока нет организаций</Text>}
  {!!items.length&&<div className="organizations-table"><Table.Container><DataTable aria-labelledby="organizations-heading" data={items} columns={[
   {header:'ИНН',field:'inn',rowHeader:true},
   {header:'Название организации',field:'name',renderCell:item=><Stack gap="condensed"><Text>{item.name??'Название появится после подтверждения'}</Text>{item.status==='pending'&&<Text size="small" className="muted">Ожидает подтверждения</Text>}</Stack>},
   {header:'Пользователи и роли',field:'members',renderCell:item=>item.status==='pending'?<Text className="muted">Доступ появится после подтверждения</Text>:<Stack gap="normal">{item.members.map(member=><Stack key={member.userId} gap="condensed"><Text weight="semibold">{member.fullName}</Text>{member.roles.length?member.roles.map(role=><Text size="small" key={role}>{labels[role]}</Text>):<Text size="small" className="muted">Роль не назначена</Text>}</Stack>)}</Stack>},
  ]}/></Table.Container></div>}
  {cursor&&<Button disabled={loading} onClick={()=>void more()}>Показать ещё</Button>}
 </Stack>
}
