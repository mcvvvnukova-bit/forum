import {useEffect,useId,useRef,useState} from 'react'
import {Banner,Button,FormControl,Spinner,Stack,Text,TextInput} from '@primer/react'
import {SearchIcon} from '@primer/octicons-react'
import {Table} from '@primer/react/experimental'
import type {Session} from '../audience/intent'
import {canManagePlatform} from './RoleManagementSection'
import './okved-directory.css'

type Result={items:{code:string;name:string}[];total:number;page:number;pageSize:number}
type State={kind:'loading'}|{kind:'ready';result:Result}|{kind:'error'|'denied'|'expired'}
function responseValue(value:unknown,page:number):Result{
 if(!value||typeof value!=='object')throw new Error('Invalid directory')
 const r=value as Result
 if(!Array.isArray(r.items)||r.items.length>50||!Number.isSafeInteger(r.total)||r.total<r.items.length||r.page!==page||r.pageSize!==50||
  r.items.some(row=>!row||typeof row.code!=='string'||!/^[0-9.]{2,8}$/.test(row.code)||typeof row.name!=='string'||!row.name)||new Set(r.items.map(row=>row.code)).size!==r.items.length)throw new Error('Invalid directory')
 return r
}
export function OkvedDirectory({session,onExpired}:{session:Session;onExpired:()=>void}){
 const allowed=canManagePlatform(session),[code,setCode]=useState(''),[name,setName]=useState(''),[query,setQuery]=useState({code:'',name:'',page:1}),[attempt,setAttempt]=useState(0),[state,setState]=useState<State>({kind:'loading'})
 const expired=useRef(onExpired),caption=useId();expired.current=onExpired
 useEffect(()=>{
  if(!allowed)return
  const controller=new AbortController();let active=true
  const timer=window.setTimeout(()=>controller.abort(),10000)
  setState({kind:'loading'})
  void(async()=>{
   try{
    const params=new URLSearchParams({code:query.code,name:query.name,page:String(query.page)})
    const response=await fetch('/api/references/okved?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
    if(!active)return
    if(response.status===401){setState({kind:'expired'});expired.current();return}
    if(response.status===403){setState({kind:'denied'});return}
    if(response.status!==200)throw new Error('Directory unavailable')
    const result=responseValue(await response.json(),query.page)
    if(active&&!controller.signal.aborted)setState({kind:'ready',result})
   }catch{if(active)setState({kind:'error'})}
   finally{window.clearTimeout(timer)}
  })()
  return()=>{active=false;controller.abort();window.clearTimeout(timer)}
 },[allowed,session.user.id,query,attempt])
 if(!allowed||state.kind==='denied')return <Banner title="Нет доступа к справочнику" variant="warning" description="Просмотр доступен администратору платформы."/>
 if(state.kind==='expired')return null
 const loading=state.kind==='loading'
 return <section className="okved-directory" aria-label="Справочник ОКВЭД2"><Stack>
  <Text as="p" className="muted">Общероссийский классификатор видов экономической деятельности</Text>
  <form className="okved-filters" onSubmit={event=>{event.preventDefault();setQuery({code:code.trim(),name:name.trim(),page:1})}}>
   <FormControl><FormControl.Label>Код</FormControl.Label><TextInput value={code} maxLength={8} placeholder="Например, 01.11" onChange={event=>setCode(event.target.value)} block/><FormControl.Caption>Начало кода</FormControl.Caption></FormControl>
   <FormControl><FormControl.Label>Наименование</FormControl.Label><TextInput value={name} maxLength={250} placeholder="Введите часть наименования" onChange={event=>setName(event.target.value)} block/><FormControl.Caption>Вхождение без учета регистра</FormControl.Caption></FormControl>
   <Stack direction="horizontal" className="okved-filter-actions"><Button type="submit" variant="primary" leadingVisual={SearchIcon}>Найти</Button><Button type="button" onClick={()=>{setCode('');setName('');setQuery({code:'',name:'',page:1})}}>Сбросить фильтры</Button></Stack>
  </form>
  {loading?<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем справочник…</Text></Stack>:state.kind==='error'?<Banner variant="warning" title="Не удалось загрузить справочник" description="Повторите попытку. Если ошибка сохраняется, обратитесь в поддержку." primaryAction={<Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button>}/>:state.kind==='ready'?<>
   <Text as="p" role="status" aria-live="polite">Найдено: {state.result.total}</Text>
   {!state.result.items.length?<Text>По выбранным условиям ничего не найдено</Text>:<Table.Container><Table aria-label="Значения ОКВЭД2" gridTemplateColumns="minmax(5rem, max-content) minmax(0, 1fr)"><Table.Head><Table.Row><Table.Header>Код</Table.Header><Table.Header>Наименование</Table.Header></Table.Row></Table.Head><Table.Body>{state.result.items.map(row=><Table.Row key={row.code}><Table.Cell scope="row">{row.code}</Table.Cell><Table.Cell><Text className="okved-name">{row.name}</Text></Table.Cell></Table.Row>)}</Table.Body></Table></Table.Container>}
   <nav aria-label="Страницы справочника" className="okved-pagination"><Button disabled={query.page===1} onClick={()=>setQuery(previous=>({...previous,page:previous.page-1}))} aria-label="Предыдущая страница">Назад</Button><Text id={caption}>Страница {state.result.page}</Text><Button disabled={query.page*50>=state.result.total} onClick={()=>setQuery(previous=>({...previous,page:previous.page+1}))} aria-label="Следующая страница">Далее</Button></nav>
  </>:null}
 </Stack></section>
}
