import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
const evidence=process.env.ROLE_UI_EVIDENCE_DIR??resolve('.superpowers/sdd/2026-10-11-role-model/task-2-evidence/screenshots')
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})})
for(const width of [1440,768,390,320])test(`real API roles layout, menu and focus at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/__fixture/login/admin');await expect(page.getByRole('heading',{name:'Служебные роли'})).toBeVisible()
 await expect(page.getByLabel('Область управления')).toHaveValue('platform')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 if(width<768){const opener=page.getByRole('button',{name:'Открыть меню профиля'});await opener.click();const dialog=page.getByRole('dialog',{name:'Разделы профиля'});await expect(dialog.getByText('Администрирование',{exact:true})).toBeVisible();await expect(dialog.getByText('Справочники',{exact:true})).toBeVisible();await expect(dialog.getByRole('link',{name:'Пользователи'})).toBeVisible();await page.keyboard.press('Escape');await expect(opener).toBeFocused()}
 await page.getByLabel('Область управления').press('Tab');await expect(page.getByLabel('Пользователь')).toBeFocused()
 await page.screenshot({path:resolve(evidence,`roles-${width}.png`),fullPage:true});await page.reload();await expect(page.getByRole('heading',{name:'Служебные роли'})).toBeVisible();expect(errors).toEqual([])
})
test('role grant, reload persistence, revoke and old-cookie refusal use the real API',async({page,browser})=>{
 await page.goto('/__fixture/login/admin');const info=await (await page.request.get('/__fixture/info')).json()
 await page.getByLabel('Пользователь',{exact:true}).selectOption(info.users.ordinary);await page.getByLabel('Служебная роль').selectOption('platform_admin')
 await page.getByLabel('Причина изменения').fill('Synthetic UI acceptance grant')
 const grant=page.waitForResponse(r=>r.url().endsWith('/api/iam/platform-role-assignments')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Назначить роль',exact:true}).click();const granted=await grant;expect([200,201]).toContain(granted.status());expect((await granted.json()).item.status).toBe('active');await expect(page.getByRole('status')).toContainText('Изменения сохранены')
 await page.reload();await page.getByLabel('Пользователь',{exact:true}).selectOption(info.users.ordinary);await expect(page.getByText('Администратор платформы — действует',{exact:true})).toBeVisible()
 const oldContext=await browser.newContext(),oldPage=await oldContext.newPage();await oldPage.goto('http://127.0.0.1:5191/__fixture/login/ordinary');await expect(oldPage.getByRole('heading',{name:'Служебные роли'})).toBeVisible()
 expect((await oldPage.request.get('http://127.0.0.1:5191/api/iam/platform-users',{headers:{'X-Forum-Context':'platform'}})).status()).toBe(200)
 await page.getByLabel('Причина изменения').fill('Synthetic UI acceptance revoke');const revoke=page.waitForResponse(r=>r.url().includes('/api/iam/platform-role-assignments/')&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Отозвать роль',exact:true}).click();expect((await revoke).status()).toBe(200)
 await expect(page.getByText('Администратор платформы — отозвана',{exact:true})).toBeVisible();await page.screenshot({path:resolve(evidence,'revoked-role.png'),fullPage:true})
 expect((await oldPage.request.get('http://127.0.0.1:5191/api/iam/platform-users',{headers:{'X-Forum-Context':'platform'}})).status()).toBe(403)
 await oldPage.reload();await expect(oldPage.getByText('Нет доступа к управлению ролями',{exact:true})).toBeVisible();await expect(oldPage.getByRole('link',{name:'Пользователи'})).toHaveCount(0)
 await page.reload();await page.getByLabel('Пользователь',{exact:true}).selectOption(info.users.ordinary);await expect(page.getByText('Администратор платформы — отозвана',{exact:true})).toBeVisible();await oldContext.close()
})
test('corporate signer request remains unconfirmed, switching clears prior company and foreign IDs show no members',async({page})=>{
 await page.goto('/__fixture/login/corporate');const info=await (await page.request.get('/__fixture/info')).json();const company=info.companies[0],other=info.companies[1]
 await page.getByLabel('Область управления').selectOption(`organization:${company}`);await expect(page.getByRole('option',{name:'UI Сотрудник компании',exact:true})).toHaveCount(1)
 const option=page.getByRole('option',{name:'UI Сотрудник компании',exact:true});const membership=await option.getAttribute('value');await page.getByLabel('Участник компании').selectOption(membership!)
 await page.getByLabel('Лицо с правом подписи',{exact:true}).check();await page.getByLabel('Причина изменения').fill('Synthetic signer duty, no evidence supplied');await page.getByRole('button',{name:'Сохранить роли участника'}).click()
 await expect(page.getByText('Подпись недоступна: подтверждение полномочий отсутствует или недействительно',{exact:true})).toBeVisible();await page.reload();await page.getByLabel('Участник компании').selectOption(membership!);await expect(page.getByLabel('Лицо с правом подписи',{exact:true})).toBeChecked()
 await page.screenshot({path:resolve(evidence,'signer-awaiting-authority.png'),fullPage:true});await page.getByLabel('Область управления').selectOption(`organization:${other}`);await expect(page.getByRole('option',{name:'UI Сотрудник компании',exact:true})).toHaveCount(0)
 await page.goto('/cabinet/roles/?context=organization:00000000-0000-4000-8000-000000000000');await expect(page.getByText('Нет доступа к управлению ролями',{exact:true})).toBeVisible();await expect(page.getByLabel('Участник компании')).toHaveCount(0)
})
test('named company labels retain exact authorized context and draft safeguards',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto('/__fixture/login/corporate')
 const info=await (await page.request.get('/__fixture/info')).json(),metadata=await (await page.request.get('/api/me/organizations')).json()
 const first=metadata.items.find((item:{id:string})=>item.id===info.companies[0]),second=metadata.items.find((item:{id:string})=>item.id===info.companies[1])
 await expect(page.getByRole('option',{name:`Тестовая компания 1 — ИНН ${first.inn}`,exact:true})).toHaveAttribute('value',`organization:${info.companies[0]}`)
 await expect(page.getByRole('option',{name:`Тестовая компания 2 — ИНН ${second.inn}`,exact:true})).toHaveAttribute('value',`organization:${info.companies[1]}`)
 await page.getByLabel('Область управления').selectOption({label:`Тестовая компания 1 — ИНН ${first.inn}`});await expect(page.getByRole('option',{name:'UI Сотрудник компании',exact:true})).toHaveCount(1)
 await page.getByLabel('Причина изменения').fill('Unsaved reason remains in the named company')
 await page.getByLabel('Область управления').selectOption({label:`Тестовая компания 2 — ИНН ${second.inn}`});await page.getByRole('button',{name:'Продолжить редактирование',exact:true}).click()
 await expect(page.getByLabel('Область управления')).toHaveValue(`organization:${info.companies[0]}`);await expect(page.getByLabel('Причина изменения')).toHaveValue('Unsaved reason remains in the named company')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'named-company-selector-390.png'),fullPage:true})
 await page.getByLabel('Область управления').selectOption({label:`Тестовая компания 2 — ИНН ${second.inn}`});await page.getByRole('button',{name:'Отменить изменения',exact:true}).click()
 await expect(page.getByRole('option',{name:'UI Сотрудник компании',exact:true})).toHaveCount(0);await expect(page.getByLabel('Причина изменения')).toHaveValue('')
})
test('unavailable read retries against the real API and ordinary sessions stay forbidden',async({page})=>{
 await page.request.get('/__fixture/fail-reads?value=true')
 try{await page.goto('/__fixture/login/admin');await expect(page.getByText('Не удалось загрузить роли',{exact:true})).toBeVisible();await page.request.get('/__fixture/fail-reads?value=false');await page.getByRole('button',{name:'Повторить',exact:true}).filter({visible:true}).click();await expect(page.getByRole('heading',{name:'Служебные роли'})).toBeVisible()}finally{await page.request.get('/__fixture/fail-reads?value=false')}
 await page.goto('/__fixture/login/ordinary');await expect(page.getByText('Нет доступа к управлению ролями',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Пользователи'})).toHaveCount(0)
})
