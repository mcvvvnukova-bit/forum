import {useId} from 'react'
import {Banner,Button,Heading,Spinner,Stack,Text} from '@primer/react'
import {DataTable,Table} from '@primer/react/experimental'
import type {State,UserDirectorySummary} from './UserAccessSection'
const labels={platform_admin:'Администратор платформы',platform_moderator:'Модератор платформы'}
export function PlatformUsersTable({title,items,state,onRetry,onUnblock,disabled=false}:{title:string;items:UserDirectorySummary[];state:State;onRetry:()=>void;onUnblock?:(item:UserDirectorySummary)=>void;disabled?:boolean}){
 const headingId=useId()
 return <section aria-label={title}><Stack>
  <Heading as="h2" variant="small" id={headingId}>{title}</Heading>
  {state==='loading'?<Stack direction="horizontal"><Spinner size="small"/><Text role="status">Загружаем пользователей…</Text></Stack>:state!=='ready'?<Banner variant="warning" title="Список пользователей недоступен" primaryAction={<Button onClick={onRetry}>Повторить загрузку списка</Button>}/>:!items.length?<Text>{onUnblock?'Нет заблокированных пользователей':'Нет зарегистрированных пользователей'}</Text>:<Table.Container><DataTable aria-labelledby={headingId} data={items.map(item=>({...item,id:item.userId}))} columns={[
   {header:'Пользователь',field:'displayName',rowHeader:true},
   {header:'Служебные роли',field:'platformRoles',renderCell:item=>item.platformRoles.filter(role=>role.status==='active').map(role=>labels[role.roleCode]).join(', ')||'Не назначены'},
   {header:'Статус входа',field:'status',renderCell:item=>item.status==='active'?'Вход разрешён':'Вход заблокирован'},
   ...(onUnblock?[{header:'Действие',field:'userId' as const,renderCell:(item:UserDirectorySummary)=><Button disabled={disabled} onClick={()=>onUnblock(item)} aria-label={`Разблокировать ${item.displayName}`}>Разблокировать</Button>}]:[])
  ]}/></Table.Container>}
 </Stack></section>
}
