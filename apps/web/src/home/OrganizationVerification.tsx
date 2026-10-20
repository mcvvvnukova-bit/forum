import {useEffect,useRef,useState} from 'react'
import {Banner,Button,Heading,Spinner,Stack,Text} from '@primer/react'
type Method='diadoc'|'kep'
type Status='checking'|'connection_required'|'signature_required'|'access_confirmed'|'access_denied'|'unavailable'|'selection_required'
type Item={id:string;inn:string;method:Method;status:Status;source:string;reason:string;checkedAt:string|null;expiresAt:string;legalPermissions:{registerCompany:false;submitTender:false}}
const messages:Record<Status,string>={checking:'Проверяем сведения…',connection_required:'Требуется подключение учётной записи Диадока',signature_required:'Для подтверждения требуется подпись КЭП',access_confirmed:'Доступ в Диадоке подтверждён',access_denied:'Доступ через Диадок не подтверждён',unavailable:'Сведения сейчас недоступны',selection_required:'Нужно уточнить организацию или ящик Диадока'}
const route='/api/me/organizations/verification'
export function OrganizationVerification({inn,userId,onExpired,onClose}:{inn:string;userId:string;onExpired:()=>void;onClose:()=>void}){
 const [item,setItem]=useState<Item|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false)
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),live=useRef(true),locked=useRef(false)
 const pending=useRef<{method:Method;requestId:string}|null>(null),heading=useRef<HTMLHeadingElement>(null)
 const restoreFocus=useRef<HTMLButtonElement|null>(null)
 function current(version:number){return live.current&&sequence.current===version}
 async function request(method?:Method,trigger?:HTMLButtonElement){
  if(locked.current)return
  if(trigger)restoreFocus.current=trigger
  locked.current=true;controller.current?.abort();controller.current=new AbortController()
  const version=++sequence.current,abort=controller.current,timer=window.setTimeout(()=>abort.abort(),15_000)
  setBusy(true);setError(false)
  try{
   if(method&&pending.current?.method!==method)pending.current={method,requestId:crypto.randomUUID()}
   const response=await fetch(route+(method?'':'?inn='+encodeURIComponent(inn)),{credentials:'same-origin',cache:'no-store',signal:abort.signal,
    ...(method?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inn,...pending.current})}:{})})
   if(!current(version))return
   if(response.status===401){onExpired();return}
   if(response.status!==200&&response.status!==201)throw new Error('Unavailable')
   const body=await response.json() as {userId:unknown;item:Item|null}
   if(!current(version))return
   if(body.userId!==userId||!(body.item===null||body.item&&typeof body.item.id==='string'&&body.item.inn===inn
    &&['diadoc','kep'].includes(body.item.method)&&Object.hasOwn(messages,body.item.status)
    &&typeof body.item.expiresAt==='string'&&Number.isFinite(Date.parse(body.item.expiresAt))
    &&['unconfigured','diadoc_staging','diadoc_production','simulation'].includes(body.item.source)
    &&body.item.legalPermissions?.registerCompany===false&&body.item.legalPermissions?.submitTender===false))throw new Error('Invalid result')
   setItem(body.item&&Date.parse(body.item.expiresAt)<=Date.now()?{...body.item,status:'unavailable',reason:'expired'}:body.item)
   if(body.item?.status!=='checking')pending.current=null
  }catch{if(current(version))setError(true)}
  finally{window.clearTimeout(timer);if(current(version)){locked.current=false;setBusy(false)}}
 }
 useEffect(()=>{
  live.current=true;heading.current?.focus();void request()
  return()=>{live.current=false;++sequence.current;controller.current?.abort();locked.current=false}
 },[inn,userId])
 useEffect(()=>{
  if(busy||!restoreFocus.current)return
  const button=restoreFocus.current;restoreFocus.current=null
  if(document.activeElement===document.body||document.activeElement===button){if(button.isConnected)button.focus();else heading.current?.focus()}
 },[busy])
 useEffect(()=>{
  if(!item||item.reason==='expired')return
  const deadline=Date.parse(item.expiresAt)
  const expire=()=>{if(Date.now()>=deadline)setItem(previous=>previous?.id===item.id?{...previous,status:'unavailable',reason:'expired'}:previous)}
  const timer=window.setTimeout(expire,Math.max(0,Math.min(deadline-Date.now(),2_147_483_647)))
  document.addEventListener('visibilitychange',expire);window.addEventListener('focus',expire)
  return()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',expire);window.removeEventListener('focus',expire)}
 },[item])
 return <section aria-labelledby="organization-verification-heading" className="organization-verification">
  <Stack gap="normal">
   <Stack direction="horizontal" wrap="wrap" align="center" justify="space-between">
    <Heading as="h2" tabIndex={-1} ref={heading} id="organization-verification-heading">Подтверждение организации {inn}</Heading>
    <Button onClick={onClose} aria-label="Закрыть проверку">Закрыть</Button>
   </Stack>
   <Text>Выберите способ подтверждения полномочий. Для КЭП доступ к Диадоку не требуется.</Text>
   <Stack direction="horizontal" wrap="wrap" gap="normal">
    <Button disabled={busy} onClick={event=>void request('diadoc',event.currentTarget)}>Подключить Диадок</Button>
    <Button disabled={busy} onClick={event=>void request('kep',event.currentTarget)}>Подтвердить КЭП</Button>
   </Stack>
   {busy&&<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Получаем результат проверки…</Text></Stack>}
   {error&&<Stack gap="condensed"><Banner variant="critical" title="Не удалось получить результат проверки"/><Button disabled={busy} onClick={event=>void request(pending.current?.method,event.currentTarget)}>Повторить запрос</Button></Stack>}
   {item&&<Stack gap="condensed" aria-live="polite">
    {item.source==='simulation'&&<Text weight="semibold">Тестовые сведения</Text>}
    <Text role="status">{messages[item.status]}</Text>
    {item.source==='unconfigured'&&<Text>Этот способ подтверждения пока недоступен. Сохранённые данные организации остаются в личном кабинете.</Text>}
    {item.reason==='api_subscription_required'&&<Text>Проверьте доступ к API Диадока или воспользуйтесь подтверждением КЭП.</Text>}
    {item.reason==='expired'&&<Text>Срок проверки истёк. Получите актуальные сведения.</Text>}
    {item.checkedAt&&Number.isFinite(Date.parse(item.checkedAt))&&<Text size="small">Проверено: {new Date(item.checkedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</Text>}
    <Text weight="semibold">Юридические полномочия пока не подтверждены</Text>
    <Text>Для регистрации компании и подачи тендерного предложения требуется отдельно проверить КЭП и основание полномочий.</Text>
    {item.status==='checking'&&<Button disabled={busy} onClick={()=>void request()}>Обновить результат</Button>}
   </Stack>}
  </Stack>
 </section>
}
