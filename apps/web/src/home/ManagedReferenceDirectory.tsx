import {useEffect,useRef,useState,type RefObject} from 'react'
import {Banner,Button,Dialog,FormControl,Spinner,Stack,Text,TextInput,Textarea} from '@primer/react'
import {SearchIcon} from '@primer/octicons-react'
import {Table} from '@primer/react/experimental'
import {managedReferenceDefinitions,type ManagedReferenceKind} from '../../../../packages/managed-references'
import type {Session} from '../audience/intent'
import './okved-directory.css'

type Value={code:string;name:string;description:string|null;symbol:string|null;version:number}
type Page={items:Value[];total:number;page:number;pageSize:50}
type State={kind:'loading'|'error'|'denied'|'expired'}|{kind:'ready';page:Page}
type Editor={mode:'add'|'view'|'edit'|'delete';item?:Value}
class ResponseError extends Error{constructor(readonly status:number){super('Reference request failed')}}
function valueOf(value:unknown):Value{
 const item=value as Value
 if(!item||typeof item.code!=='string'||!item.code||typeof item.name!=='string'||!item.name||!Number.isSafeInteger(item.version)||item.version<1||
  !(item.description===null||typeof item.description==='string')||!(item.symbol===null||typeof item.symbol==='string'))throw new Error('Invalid reference value')
 return item
}
async function request(url:string,init:RequestInit={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init})
 if(!response.ok)throw new ResponseError(response.status)
 return response.json()
}
const errorMessage=(error:unknown)=>error instanceof ResponseError?({409:'Код или наименование уже заняты. Код удалённого значения нельзя использовать повторно.',412:'Значение изменено другим пользователем. Закройте форму и откройте запись заново.',404:'Значение уже удалено. Закройте форму и обновите список.',403:'Нет доступа к изменению справочника.',401:'Сессия завершена. Войдите снова.'}[error.status]??'Не удалось сохранить значение. Повторите попытку.'):'Не удалось выполнить запрос. Повторите попытку.'

function ReferenceDialog({editor,dictionary,csrfToken,onClose,onSaved,onDenied,onExpired,onNotFound,returnFocusRef}: {returnFocusRef:RefObject<HTMLButtonElement|null>;editor:Editor;dictionary:ManagedReferenceKind;csrfToken?:string;onClose:()=>void;onSaved:()=>void;onDenied:()=>void;onExpired:()=>void;onNotFound:()=>void}){
 const definition=managedReferenceDefinitions[dictionary],item=editor.item
 const [mode,setMode]=useState(editor.mode),[code,setCode]=useState(item?.code??''),[name,setName]=useState(item?.name??''),[description,setDescription]=useState(item?.description??''),[symbol,setSymbol]=useState(item?.symbol??'')
 const [pending,setPending]=useState(false),[error,setError]=useState(''),identity=useRef<{payload:string;key:string}|null>(null),controller=useRef<AbortController|null>(null),alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort()}},[])
 const editing=mode==='add'||mode==='edit',title={add:'Добавление значения',view:'Просмотр значения',edit:'Редактирование значения',delete:'Удаление значения'}[mode]
 const save=async()=>{
  if(pending)return
  setPending(true);setError('')
  const body=mode==='delete'?undefined:{...(mode==='add'?{code}:{}),name,...(definition.description?{description}:{}),...(definition.symbol?{symbol}:{})}
  const method=mode==='add'?'POST':mode==='delete'?'DELETE':'PATCH',payload=JSON.stringify({method,code,body,version:item?.version})
  if(identity.current?.payload!==payload)identity.current={payload,key:crypto.randomUUID()}
  controller.current=new AbortController();const timer=window.setTimeout(()=>controller.current?.abort(),15000)
  try{
   if(!csrfToken)throw new ResponseError(403)
   await request('/api/references/managed/'+dictionary+(mode==='add'?'':'/'+encodeURIComponent(code)),{method,
    headers:{...(body?{'Content-Type':'application/json'}:{}),'X-Forum-CSRF':csrfToken,'Idempotency-Key':identity.current.key,...(mode==='add'?{}:{'If-Match':`"${item!.version}"`})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:controller.current.signal})
   if(alive.current)onSaved()
  }catch(e){if(alive.current){if(e instanceof ResponseError&&e.status===401){onExpired();onClose()}else if(e instanceof ResponseError&&e.status===403){onDenied();onClose()}else if(e instanceof ResponseError&&e.status===404&&mode!=='add')onNotFound();else setError(errorMessage(e))}}
  finally{window.clearTimeout(timer);if(alive.current)setPending(false)}
 }
 return <Dialog returnFocusRef={returnFocusRef} title={title} onClose={()=>{if(!pending)onClose()}} width="large" position={{narrow:'bottom',regular:'center',wide:'center'}}>
  <Dialog.Body><Stack>
   {error&&<Banner variant="warning" title={error}/>}
   {mode==='delete'?<><Text as="p">Удалить «{item?.name}» ({item?.code})?</Text><Text as="p">Значение будет скрыто из интерфейса. Существующие связи и запись в базе сохранятся.</Text></>:editing?<form id="reference-editor" onSubmit={event=>{event.preventDefault();void save()}}><Stack>
    <FormControl required><FormControl.Label>Код</FormControl.Label><TextInput required value={code} disabled={mode==='edit'||pending} maxLength={definition.numeric?2:64} pattern={definition.numeric?'(0[1-9]|[1-9][0-9])':'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}'} onChange={event=>setCode(event.target.value)} block/><FormControl.Caption>{definition.numeric?'Две цифры, например 01.':'Латинские буквы, цифры, точка, дефис или подчёркивание.'} После создания код изменить нельзя.</FormControl.Caption></FormControl>
    <FormControl required><FormControl.Label>Наименование</FormControl.Label><TextInput required value={name} maxLength={250} disabled={pending} onChange={event=>setName(event.target.value)} block/></FormControl>
    {definition.symbol&&<FormControl><FormControl.Label>Обозначение</FormControl.Label><TextInput value={symbol} maxLength={32} disabled={pending} onChange={event=>setSymbol(event.target.value)} block/></FormControl>}
    {definition.description&&<FormControl><FormControl.Label>Описание</FormControl.Label><Textarea value={description} maxLength={1000} disabled={pending} onChange={event=>setDescription(event.target.value)} block rows={4}/></FormControl>}
   </Stack></form>:<><Text as="p"><Text weight="semibold">Код: </Text>{item?.code}</Text><Text as="p"><Text weight="semibold">Наименование: </Text>{item?.name}</Text>{definition.symbol&&<Text as="p"><Text weight="semibold">Обозначение: </Text>{item?.symbol||'Не указано'}</Text>}{definition.description&&<Text as="p" className="okved-name">{item?.description||'Описание не указано'}</Text>}</>}
  </Stack></Dialog.Body>
  <Dialog.Footer><Stack direction="horizontal" wrap="wrap">
   <Button disabled={pending} onClick={onClose}>{mode==='view'?'Закрыть':'Отмена'}</Button>
   {mode==='view'?<><Button onClick={()=>setMode('edit')}>Редактировать</Button><Button variant="danger" onClick={()=>setMode('delete')}>Удалить значение</Button></>:mode==='delete'?<Button variant="danger" disabled={pending} onClick={()=>void save()}>{pending?'Удаляем…':'Удалить'}</Button>:<Button variant="primary" type="submit" form="reference-editor" disabled={pending||!code.trim()||!name.trim()}>{pending?'Сохраняем…':'Сохранить'}</Button>}
  </Stack></Dialog.Footer>
 </Dialog>
}

export function ManagedReferenceDirectory({dictionary,session,onExpired}:{dictionary:ManagedReferenceKind;session:Session;onExpired:()=>void}){
 const definition=managedReferenceDefinitions[dictionary],allowed=session.platformRoles?.includes('platform_admin')||(dictionary==='rejection-reasons'&&session.platformRoles?.includes('platform_moderator'))
 const [code,setCode]=useState(''),[name,setName]=useState(''),[query,setQuery]=useState({code:'',name:'',page:1}),[attempt,setAttempt]=useState(0),[state,setState]=useState<State>({kind:'loading'}),[editor,setEditor]=useState<Editor|null>(null),[opening,setOpening]=useState(false),[openError,setOpenError]=useState(''),[notice,setNotice]=useState('')
 const addButton=useRef<HTMLButtonElement>(null)
 const expired=useRef(onExpired),openRequest=useRef<AbortController|null>(null),alive=useRef(true);expired.current=onExpired
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;openRequest.current?.abort()}},[])
 useEffect(()=>{
  if(!allowed)return
  const controller=new AbortController();let active=true;const timer=window.setTimeout(()=>controller.abort(),10000)
  setState({kind:'loading'})
  void(async()=>{try{
   const value=await request('/api/references/managed/'+dictionary+'?'+new URLSearchParams({code:query.code,name:query.name,page:String(query.page)}),{signal:controller.signal}) as Page
   if(!active)return
   if(!Array.isArray(value.items)||value.items.length>50||!Number.isSafeInteger(value.total)||value.total<value.items.length||value.page!==query.page||value.pageSize!==50)throw new Error('Invalid reference page')
   value.items=value.items.map(valueOf);if(new Set(value.items.map(item=>item.code)).size!==value.items.length)throw new Error('Duplicate reference values')
   setState({kind:'ready',page:value})
  }catch(error){if(active){if(error instanceof ResponseError&&error.status===401){setEditor(null);setState({kind:'expired'});expired.current()}else if(error instanceof ResponseError&&error.status===403){setEditor(null);setState({kind:'denied'})}else setState({kind:'error'})}}
  finally{window.clearTimeout(timer)}})()
  return()=>{active=false;controller.abort();window.clearTimeout(timer)}
 },[allowed,session.user.id,dictionary,query,attempt])
 const open=async(code:string)=>{
  if(opening)return
  setOpening(true);setOpenError('');openRequest.current=new AbortController();const timer=window.setTimeout(()=>openRequest.current?.abort(),10000)
  try{const value=await request('/api/references/managed/'+dictionary+'/'+encodeURIComponent(code),{signal:openRequest.current.signal});if(alive.current)setEditor({mode:'view',item:valueOf(value.item)})}
  catch(error){if(alive.current){if(error instanceof ResponseError&&error.status===401)expired.current();else if(error instanceof ResponseError&&error.status===403)setState({kind:'denied'});else {setOpenError(errorMessage(error));if(error instanceof ResponseError&&error.status===404)setAttempt(n=>n+1)}}}
  finally{window.clearTimeout(timer);if(alive.current)setOpening(false)}
 }
 if(!allowed||state.kind==='denied')return <Banner variant="warning" title="Нет доступа к справочнику" description="Обратитесь к администратору платформы."/>
 if(state.kind==='expired')return null
 return <section className="okved-directory" aria-label={'Справочник '+definition.title}><Stack>
  <Stack direction="horizontal" justify="space-between" align="center" wrap="wrap"><Text>Просмотр и управление значениями справочника</Text><Button ref={addButton} variant="primary" onClick={()=>{setNotice('');setEditor({mode:'add'})}}>Добавить значение</Button></Stack>
  {notice&&<Text role="status">{notice}</Text>}{openError&&<Banner variant="warning" title={openError} primaryAction={<Button onClick={()=>{setOpenError('');setAttempt(n=>n+1)}}>Обновить список</Button>}/>}
  <form className="okved-filters" onSubmit={event=>{event.preventDefault();setQuery({code:code.trim(),name:name.trim(),page:1})}}>
   <FormControl><FormControl.Label>Код</FormControl.Label><TextInput value={code} maxLength={64} onChange={event=>setCode(event.target.value)} block/><FormControl.Caption>Начало кода</FormControl.Caption></FormControl>
   <FormControl><FormControl.Label>Наименование</FormControl.Label><TextInput value={name} maxLength={250} onChange={event=>setName(event.target.value)} block/><FormControl.Caption>Вхождение без учёта регистра</FormControl.Caption></FormControl>
   <Stack direction="horizontal" className="okved-filter-actions"><Button type="submit" variant="primary" leadingVisual={SearchIcon}>Найти</Button><Button onClick={()=>{setCode('');setName('');setQuery({code:'',name:'',page:1})}}>Сбросить фильтры</Button></Stack>
  </form>
  {state.kind==='loading'?<Stack direction="horizontal" align="center"><Spinner size="small"/><Text role="status">Загружаем справочник…</Text></Stack>:state.kind==='error'?<Banner variant="warning" title="Не удалось загрузить справочник" primaryAction={<Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button>}/>:state.kind==='ready'?<>
   <Text as="p" role="status">Найдено: {state.page.total}</Text>
   {!state.page.items.length?<Text>По выбранным условиям ничего не найдено</Text>:<Table.Container><Table aria-label={'Значения '+definition.title} gridTemplateColumns="minmax(3rem, max-content) minmax(0, 1fr) max-content"><Table.Head><Table.Row><Table.Header>Код</Table.Header><Table.Header>Наименование</Table.Header><Table.Header>Действия</Table.Header></Table.Row></Table.Head><Table.Body>{state.page.items.map(row=><Table.Row key={row.code}><Table.Cell scope="row"><Text className="okved-name">{row.code}</Text></Table.Cell><Table.Cell><Text className="okved-name">{row.name}</Text></Table.Cell><Table.Cell><Button disabled={opening} aria-label={'Открыть значение '+row.code} onClick={()=>void open(row.code)}>Открыть</Button></Table.Cell></Table.Row>)}</Table.Body></Table></Table.Container>}
   <nav aria-label="Страницы справочника" className="okved-pagination"><Button disabled={query.page===1} onClick={()=>setQuery(q=>({...q,page:q.page-1}))} aria-label="Предыдущая страница">Назад</Button><Text>Страница {query.page}</Text><Button disabled={query.page*50>=state.page.total} onClick={()=>setQuery(q=>({...q,page:q.page+1}))} aria-label="Следующая страница">Далее</Button></nav>
  </>:null}
  {editor&&<ReferenceDialog returnFocusRef={addButton} editor={editor} dictionary={dictionary} csrfToken={session.csrfToken} onClose={()=>setEditor(null)} onSaved={()=>{setNotice(editor.mode==='add'?'Значение добавлено':'Изменения сохранены');setEditor(null);setAttempt(n=>n+1)}} onNotFound={()=>{setEditor(null);setState({kind:'loading'});setNotice('Значение уже удалено другим пользователем.');setAttempt(n=>n+1)}} onDenied={()=>setState({kind:'denied'})} onExpired={()=>expired.current()}/>}
 </Stack></section>
}
