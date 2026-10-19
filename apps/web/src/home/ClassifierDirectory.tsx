import {useEffect,useId,useRef,useState} from 'react'
import {Banner,Button,FormControl,Link,Spinner,Stack,Text,TextInput,UnderlineNav} from '@primer/react'
import {SearchIcon} from '@primer/octicons-react'
import {Table} from '@primer/react/experimental'
import type {Session} from '../audience/intent'
import {canManagePlatform} from './RoleManagementSection'
import './okved-directory.css'

type Result={items:{code:string;name:string}[];total:number;page:number;pageSize:number;source?:{edition:string;publishedDate:string;checkedAt:string;url:string}}
export type DirectoryProps={session:Session;onExpired:()=>void}
type Classifier='okved'|'okpd'
const config={okved:{title:'ОКВЭД2',description:'Общероссийский классификатор видов экономической деятельности',maxCode:8,example:'01.11'},okpd:{title:'ОКПД2',description:'Общероссийский классификатор продукции по видам экономической деятельности',maxCode:12,example:'01.11.11.110'}}
type State={kind:'loading'}|{kind:'ready';result:Result}|{kind:'error'|'denied'|'expired'}
function responseValue(value:unknown,page:number,classifier:Classifier):Result{
 if(!value||typeof value!=='object')throw new Error('Invalid directory')
 const r=value as Result
 if(!Array.isArray(r.items)||r.items.length>50||!Number.isSafeInteger(r.total)||r.total<r.items.length||r.page!==page||r.pageSize!==50||
  r.items.some(row=>!row||typeof row.code!=='string'||(!/^[0-9.]{2,12}$/.test(row.code)||row.code.length>config[classifier].maxCode)||typeof row.name!=='string'||!row.name)||new Set(r.items.map(row=>row.code)).size!==r.items.length)throw new Error('Invalid directory')
 if(classifier==='okpd'&&(!r.source||!/^\d{1,4}\/20\d{2}$/.test(r.source.edition)||!/^20\d{2}-\d{2}-\d{2}$/.test(r.source.publishedDate)||!Number.isFinite(Date.parse(r.source.checkedAt))||r.source.url!=='https://rosstat.gov.ru/storage/mediabank/OKPD2.rar'))throw new Error('Invalid source metadata')
 return r
}
export function ClassifierDirectory({classifier,session,onExpired}:DirectoryProps&{classifier:Classifier}){
 const definition=config[classifier]
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
    const response=await fetch('/api/references/'+classifier+'?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
    if(!active)return
    if(response.status===401){setState({kind:'expired'});expired.current();return}
    if(response.status===403){setState({kind:'denied'});return}
    if(response.status!==200)throw new Error('Directory unavailable')
    const result=responseValue(await response.json(),query.page,classifier)
    if(active&&!controller.signal.aborted)setState({kind:'ready',result})
   }catch{if(active)setState({kind:'error'})}
   finally{window.clearTimeout(timer)}
  })()
  return()=>{active=false;controller.abort();window.clearTimeout(timer)}
 },[allowed,session.user.id,query,attempt,classifier])
 if(!allowed||state.kind==='denied')return <Banner title="Нет доступа к справочнику" variant="warning" description="Просмотр доступен администратору платформы."/>
 if(state.kind==='expired')return null
 const loading=state.kind==='loading'
 return <section className="okved-directory" aria-label={"Справочник "+definition.title}><Stack>
  <UnderlineNav aria-label="Справочники"><UnderlineNav.Item href="/cabinet/references/okved/#main" aria-current={classifier==='okved'?'page':undefined}>ОКВЭД2</UnderlineNav.Item><UnderlineNav.Item href="/cabinet/references/okpd/#main" aria-current={classifier==='okpd'?'page':undefined}>ОКПД2</UnderlineNav.Item></UnderlineNav>
  <Text as="p" className="muted">{definition.description}</Text>
  {classifier==='okpd'&&state.kind==='ready'&&state.result.source?<Text as="p" className="muted"><Link href="https://rosstat.gov.ru/classification" target="_blank" rel="noopener noreferrer">Источник: Росстат</Link>. Редакция {state.result.source.edition}, опубликована {state.result.source.publishedDate.split('-').reverse().join('.')}. Проверено {new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(state.result.source.checkedAt))} МСК.</Text>:null}
  <form className="okved-filters" onSubmit={event=>{event.preventDefault();setQuery({code:code.trim(),name:name.trim(),page:1})}}>
   <FormControl><FormControl.Label>Код</FormControl.Label><TextInput value={code} maxLength={definition.maxCode} placeholder={"Например, "+definition.example} onChange={event=>setCode(event.target.value)} block/><FormControl.Caption>Начало кода</FormControl.Caption></FormControl>
   <FormControl><FormControl.Label>Наименование</FormControl.Label><TextInput value={name} maxLength={250} placeholder="Введите часть наименования" onChange={event=>setName(event.target.value)} block/><FormControl.Caption>Вхождение без учета регистра</FormControl.Caption></FormControl>
   <Stack direction="horizontal" className="okved-filter-actions"><Button type="submit" variant="primary" leadingVisual={SearchIcon}>Найти</Button><Button type="button" onClick={()=>{setCode('');setName('');setQuery({code:'',name:'',page:1})}}>Сбросить фильтры</Button></Stack>
  </form>
  {loading?<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем справочник…</Text></Stack>:state.kind==='error'?<Banner variant="warning" title="Не удалось загрузить справочник" description="Повторите попытку. Если ошибка сохраняется, обратитесь в поддержку." primaryAction={<Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button>}/>:state.kind==='ready'?<>
   <Text as="p" role="status" aria-live="polite">Найдено: {state.result.total}</Text>
   {!state.result.items.length?<Text>По выбранным условиям ничего не найдено</Text>:<Table.Container><Table aria-label={"Значения "+definition.title} gridTemplateColumns="minmax(5rem, max-content) minmax(0, 1fr)"><Table.Head><Table.Row><Table.Header>Код</Table.Header><Table.Header>Наименование</Table.Header></Table.Row></Table.Head><Table.Body>{state.result.items.map(row=><Table.Row key={row.code}><Table.Cell scope="row">{row.code}</Table.Cell><Table.Cell><Text className="okved-name">{row.name}</Text></Table.Cell></Table.Row>)}</Table.Body></Table></Table.Container>}
   <nav aria-label="Страницы справочника" className="okved-pagination"><Button disabled={query.page===1} onClick={()=>setQuery(previous=>({...previous,page:previous.page-1}))} aria-label="Предыдущая страница">Назад</Button><Text id={caption}>Страница {state.result.page}</Text><Button disabled={query.page*50>=state.result.total} onClick={()=>setQuery(previous=>({...previous,page:previous.page+1}))} aria-label="Следующая страница">Далее</Button></nav>
  </>:null}
 </Stack></section>
}
