import {fireEvent,render,screen,within} from '@testing-library/react'
import {BaseStyles,ThemeProvider} from '@primer/react'
import {expect,it,vi} from 'vitest'
import {PlatformUsersTable} from './PlatformUsersTable'
import type {UserDirectorySummary} from './UserAccessSection'
const items:UserDirectorySummary[]=[
 {userId:'b',displayName:'Борис',status:'deactivated',version:1,organizations:[],platformRoles:[{id:'rb',userId:'b',roleCode:'platform_admin',status:'active',version:2}]},
 {userId:'a',displayName:'Анна',status:'active',version:1,organizations:[],platformRoles:[{id:'ra',userId:'a',roleCode:'platform_moderator',status:'active',version:1}]},
 {userId:'c',displayName:'Вера',status:'active',version:1,organizations:[],platformRoles:[]},
]
function table(props:Partial<React.ComponentProps<typeof PlatformUsersTable>>={}){return render(<ThemeProvider><BaseStyles><PlatformUsersTable title="Пользователи со служебными ролями" items={items} state="ready" onRetry={()=>{}} {...props}/></BaseStyles></ThemeProvider>)}
it('sorts actual rows, combines filters, clears them and returns filter focus',()=>{
 table()
 fireEvent.click(screen.getByRole('button',{name:'Сортировать: Пользователь'}))
 const rows=screen.getAllByRole('row').slice(1);expect(within(rows[0]).getByText('Анна')).toBeVisible()
 expect(screen.getByRole('columnheader',{name:/Пользователь/})).toHaveAttribute('aria-sort','ascending')
 fireEvent.click(screen.getByRole('button',{name:'Фильтровать: Пользователь'}))
 fireEvent.change(screen.getByLabelText('Фильтр: Пользователь'),{target:{value:'БОР'}})
 fireEvent.keyDown(screen.getByLabelText('Фильтр: Пользователь'),{key:'Escape'})
 expect(screen.getByRole('button',{name:'Фильтровать: Пользователь'})).toHaveFocus()
 expect(screen.getByText('Борис')).toBeVisible();expect(screen.queryByText('Анна')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Фильтровать: Статус входа'}))
 fireEvent.change(screen.getByLabelText('Фильтр: Статус входа'),{target:{value:'active'}})
 expect(screen.getByText('Нет пользователей по выбранным фильтрам')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Сбросить фильтры'}));expect(screen.getByText('Анна')).toBeVisible()
})
it('roles-only includes blocked role holders and explicit per-role actions',()=>{
 const revoke=vi.fn();table({rolesOnly:true,onRevoke:revoke})
 expect(screen.queryByText('Вера')).not.toBeInTheDocument();expect(screen.getByText('Вход заблокирован')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Отозвать роль Администратор платформы у Борис'}))
 expect(revoke).toHaveBeenCalledWith(items[0],items[0].platformRoles[0])
})
it.each(['Служебные роли','Статус входа'])('sorts %s in both directions and filters role membership',column=>{
 table({rolesOnly:true})
 const sort=screen.getByRole('button',{name:`Сортировать: ${column}`});fireEvent.click(sort)
 const displayedNames=()=>screen.getAllByRole('row').slice(1).map(row=>within(row).getByRole('rowheader').textContent)
 expect(displayedNames()).toEqual(['Борис','Анна'])
 expect(screen.getByRole('columnheader',{name:new RegExp(column)})).toHaveAttribute('aria-sort','ascending')
 fireEvent.click(sort)
 expect(displayedNames()).toEqual(['Анна','Борис'])
 expect(screen.getByRole('columnheader',{name:new RegExp(column)})).toHaveAttribute('aria-sort','descending')
 fireEvent.click(screen.getByRole('button',{name:'Фильтровать: Служебные роли'}))
 fireEvent.change(screen.getByLabelText('Фильтр: Служебные роли'),{target:{value:'platform_admin'}})
 expect(screen.getByText('Борис')).toBeVisible();expect(screen.queryByText('Анна')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Очистить фильтр'}));expect(screen.getByText('Анна')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Готово'}));expect(screen.getByRole('button',{name:'Фильтровать: Служебные роли'})).toHaveFocus()
})
it('retains unblock actions and disables both kinds of row mutation',()=>{
 const unblock=vi.fn(),revoke=vi.fn();table({onUnblock:unblock,onRevoke:revoke,disabled:true})
 const button=screen.getByRole('button',{name:'Разблокировать Борис'});expect(button).toBeDisabled();fireEvent.click(button);expect(unblock).not.toHaveBeenCalled()
 expect(screen.getByRole('button',{name:'Отозвать роль Администратор платформы у Борис'})).toBeDisabled()
})

it('access mode lists and filters current companies and corporate assignments',()=>{
 table({showOrganizations:true,items:[{...items[0],organizations:[{id:'11111111-1111-4111-8111-111111111111',name:'Компания А',roles:['organization_admin']},{id:'22222222-2222-4222-8222-222222222222',name:'Компания Б',roles:[]}]}]})
 expect(screen.getByRole('columnheader',{name:/^Роли/})).toBeVisible()
 expect(screen.getByRole('columnheader',{name:/^Организация/})).toBeVisible()
 expect(screen.getByText(/Администратор компании/)).toBeVisible()
 expect(screen.getByText('Компания Б')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Фильтровать: Организация'}))
 fireEvent.change(screen.getByLabelText('Фильтр: Организация'),{target:{value:'несуществующая'}})
 expect(screen.getByText('Нет пользователей по выбранным фильтрам')).toHaveAttribute('colspan','4')
 fireEvent.change(screen.getByLabelText('Фильтр: Организация'),{target:{value:'КОМПАНИЯ Б'}})
 expect(screen.getByText('Борис')).toBeVisible()
})

it('access mode sorts organization rows both ways and filters deduplicated corporate roles',()=>{
 const organizations=[{id:'11111111-1111-4111-8111-111111111111',name:'Компания Б',roles:['organization_admin' as const]},{id:'22222222-2222-4222-8222-222222222222',name:'Компания В',roles:['organization_admin' as const]}]
 table({showOrganizations:true,items:[{...items[0],organizations},{...items[1],organizations:[{id:'33333333-3333-4333-8333-333333333333',name:'Компания А',roles:['organization_employee']}]},{...items[2],organizations:[{id:'44444444-4444-4444-8444-444444444444',name:'Компания А',roles:[]}]}]})
 const names=()=>screen.getAllByRole('row').slice(1).map(row=>within(row).getByRole('rowheader').textContent)
 const sort=screen.getByRole('button',{name:'Сортировать: Организация'})
 fireEvent.click(sort);expect(names()).toEqual(['Анна','Вера','Борис'])
 expect(screen.getByRole('columnheader',{name:/^Организация/})).toHaveAttribute('aria-sort','ascending')
 fireEvent.click(sort);expect(names()).toEqual(['Борис','Анна','Вера'])
 expect(screen.getByRole('columnheader',{name:/^Организация/})).toHaveAttribute('aria-sort','descending')
 const boris=screen.getAllByRole('row').find(row=>within(row).queryByText('Борис'))!
 expect(within(boris).getByText('Администратор компании')).toBeVisible()
 expect(within(boris).getByText('Администратор платформы')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Фильтровать: Роли'}))
 fireEvent.change(screen.getByLabelText('Фильтр: Роли'),{target:{value:'organization_admin'}});expect(names()).toEqual(['Борис'])
 fireEvent.change(screen.getByLabelText('Фильтр: Роли'),{target:{value:'organization_employee'}});expect(names()).toEqual(['Анна'])
 fireEvent.change(screen.getByLabelText('Фильтр: Роли'),{target:{value:'none'}});expect(names()).toEqual(['Вера'])
})
