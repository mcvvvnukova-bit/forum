import {test,expect} from '@playwright/test'

for(const width of [320,390,1440]){
 test(`built public routes and reload at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/auth/session',route=>route.fulfill({status:401,body:''}))
  for(const path of ['/','/customers/','/suppliers/','/work/','/participate/','/login','/register','/register/','/register/index.html','/cabinet/']){
   await page.goto(path);await expect(page.locator('h1')).toBeVisible()
   await page.reload();await expect(page.locator('h1')).toBeVisible()
   await expect(page.locator('a[href="/register"]')).toHaveCount(0)
   if(path.startsWith('/register')) await expect(page).toHaveURL(/\/login$/)
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
 })
 test(`built Sber button stays green while checking and redirecting at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  let releaseSession!:()=>void;const sessionHeld=new Promise<void>(resolve=>{releaseSession=resolve})
  let releaseStart!:()=>void;const startHeld=new Promise<void>(resolve=>{releaseStart=resolve});let starts=0
  await page.route('**/api/auth/session',async route=>{await sessionHeld;await route.fulfill({status:401,body:''})})
  await page.route('**/auth/sber-id/start?intent=login',async route=>{
   starts++;await startHeld;await route.fulfill({status:200,contentType:'text/html',body:'<p>Isolated provider destination</p>'})
  })
  try{
   await page.goto('/')
   const forumAction=page.getByRole('link',{name:'Начать работу',exact:true,includeHidden:true})
   await expect(forumAction).toHaveCSS('background-color','rgb(255, 85, 26)')
   await page.locator('.site-header').getByRole('link',{name:'Войти',exact:true}).click()
   const sber=page.getByRole('button',{name:'Войти по Сбер ID',exact:true})
   await expect(sber).toBeDisabled()
   for(const property of ['background-color','border-top-color'])await expect(sber).toHaveCSS(property,'rgb(33, 160, 56)')
   await expect(sber).toHaveCSS('color','rgb(255, 255, 255)')
   releaseSession();await expect(sber).toBeEnabled()
   await sber.hover();await expect(sber).toHaveCSS('background-color','rgb(30, 144, 50)')
   const renderedSber=await sber.elementHandle();const renderedForum=await forumAction.elementHandle()
   if(!renderedSber || !renderedForum)throw new Error('Expected rendered provider and Forum buttons')
   await sber.click({noWaitAfter:true})
   // Locators wait for pending document navigation; captured nodes can inspect
   // the still-rendered page while the isolated provider response is held.
   await expect.poll(()=>renderedSber.evaluate(button=>{
    const style=getComputedStyle(button)
    return {disabled:button.matches(':disabled'),background:style.backgroundColor,border:style.borderTopColor,color:style.color}
   })).toEqual({disabled:true,background:'rgb(33, 160, 56)',border:'rgb(33, 160, 56)',color:'rgb(255, 255, 255)'})
   await expect.poll(()=>page.evaluate(()=>document.querySelector('[role="status"]')?.textContent)).toBe('Переходим к Сбер ID…')
   expect(await renderedForum.evaluate(button=>getComputedStyle(button).backgroundColor)).toBe('rgb(255, 85, 26)')
   await page.keyboard.press('Enter');await expect.poll(()=>starts).toBe(1)
  }finally{releaseSession();releaseStart()}
  await expect(page.getByText('Isolated provider destination')).toBeVisible()
 })
 for(const entry of ['Войти','Начать работу']){
  test(`built held 200 ${entry} history and focus at ${width}`,async({page})=>{
   await page.setViewportSize({width,height:1000})
   let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});let requests=0
   await page.route('**/api/auth/session',async route=>{requests++;await held;await route.fulfill({status:200,json:{user:{id:'synthetic',displayName:'Synthetic'}}})})
   const background='/?campaign=built#rules'
   await page.goto(background)
   await page.locator('h1').evaluate(node=>node.setAttribute('data-original-home','yes'))
   const opener=entry==='Войти'?page.locator('.site-header').getByRole('link',{name:'Войти',exact:true}):page.getByRole('link',{name:'Начать работу',exact:true})
   await opener.click()
   await expect(page.getByRole('dialog',{name:'Войти в аккаунт',exact:true})).toBeVisible()
   await expect(page.getByRole('dialog').getByRole('link',{name:'Зарегистрироваться',exact:true})).toHaveCount(0)
   await expect(page).toHaveURL(/\/login$/)
   release()
   await expect(page.getByRole('dialog').getByText('Вы уже вошли в аккаунт')).toBeVisible()
   await expect(page.locator('.site-header')).toContainText('В кабинет')
   await expect(page.locator('#hero-title')).toHaveAttribute('data-original-home','yes')
   expect(requests).toBe(1)
   await page.getByRole('button',{name:'Закрыть окно'}).click()
   await expect(page).toHaveURL(new RegExp('/\\?campaign=built#rules$'))
   await expect.poll(()=>page.evaluate(()=>document.activeElement instanceof HTMLElement && document.activeElement!==document.body && document.activeElement.isConnected)).toBe(true)
   await page.goForward();await expect(page.getByRole('dialog')).toBeVisible()
   await expect(page.locator('#hero-title')).toHaveAttribute('data-original-home','yes')
   await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0)
   await page.goForward();await page.reload()
   await expect(page.getByRole('dialog')).toBeVisible()
   await expect(page.locator('#hero-title')).toContainText('Заказы, исполнители и работа в строительстве')
   expect(await page.evaluate(()=>history.state.publicAuthBackground)).toBe(background)
   await page.getByRole('button',{name:'Закрыть окно'}).click()
   await expect.poll(()=>page.evaluate(()=>document.activeElement instanceof HTMLElement && document.activeElement!==document.body)).toBe(true)
  })
 }
 test(`built entry CTAs open the shared login at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  await page.route('**/api/auth/session',route=>route.fulfill({status:401,body:''}))
  for(const [path,label,count] of [
   ['/','Начать работу',1],['/customers/','Разместить заказ',2],
   ['/suppliers/','Найти заказы',2],['/suppliers/','Приступить к работе',4],
   ['/work/','Найти работу',2],['/work/','Выбрать заказы',1],['/work/','Выбрать вакансии',1],
  ] as const){
   await page.goto(path)
   const openers=page.getByRole(path==='/'?'link':'button',{name:label,exact:true})
   await expect(openers).toHaveCount(count)
   for(let index=0;index<count;index++){
    const opener=openers.nth(index)
    await opener.click()
    await expect(page.getByRole('dialog',{name:'Войти в аккаунт',exact:true})).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button',{name:'Войти по Сбер ID',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'Закрыть окно',exact:true}).click()
    await expect(page).toHaveURL(new URL(path,page.url()).href)
    await expect(opener).toBeFocused()
   }
  }
 })
}
for(const status of [401,500])test(`built guest and unknown ${status}`,async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({status,body:''}))
 await page.goto('/login?auth_error=sber_unavailable')
 await expect(page.getByText(status===401?'Вход через Сбер ID пока недоступен':'Не удалось проверить вход. Повторите попытку')).toBeVisible()
 await expect(page.getByRole('button',{name:'Войти по Сбер ID'})).toBeDisabled()
})
test('built cabinet uses a confirmed session and blocked callback opens a support dialog',async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({status:200,json:{user:{id:'synthetic-person',displayName:'Тестовый пользователь'},roles:['individual']}}))
 await page.goto('/cabinet/?auth=success')
 await expect(page.getByRole('heading',{name:'Личный кабинет',exact:true})).toBeVisible()
 await expect(page.getByText('Тестовый пользователь',{exact:true})).toBeVisible()
 await expect(page.getByText('Физлицо',{exact:true})).toBeVisible()
 await page.goto('/?auth_error=account_deactivated')
 const blocked=page.getByRole('dialog',{name:'Вы заблокированы на платформе',exact:true})
 await expect(blocked).toBeVisible()
 await expect(blocked.getByRole('link',{name:'Тех. поддержка'})).toHaveAttribute('href','mailto:info@astforum.ru')
 await expect(blocked.getByRole('button',{name:'Войти по Сбер ID'})).toHaveCount(0)
})
test('built work carousel survives modal history and demo keeps its actual embed contract',async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({status:401,body:''}))
 await page.route('https://cal.astforum.ru/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>Isolated calendar fixture</p>'}))
 await page.goto('/work/#order-example')
 await page.getByRole('button',{name:'Следующий пример'}).click()
 await expect(page.locator('#work-example-slide')).toHaveAttribute('aria-label','2 из 2: Работа в штате')
 await page.locator('.site-header').getByRole('link',{name:'Войти',exact:true}).click()
 await page.getByRole('button',{name:'Закрыть окно'}).click()
 await expect(page).toHaveURL(/\/work\/#order-example$/)
 await expect(page.locator('#work-example-slide')).toHaveAttribute('aria-label','2 из 2: Работа в штате')
 await page.goForward();await expect(page.getByRole('dialog')).toBeVisible()
 await page.goBack();await expect(page.locator('#work-example-slide')).toHaveAttribute('aria-label','2 из 2: Работа в штате')
 await page.goto('/')
 await page.getByRole('button',{name:'Записаться на демо',exact:true}).first().click()
 const frame=page.locator('iframe[title="Cal.diy — запись на демонстрацию АСТ Форум"]')
 await expect(frame).toBeVisible()
 await expect(frame).toHaveAttribute('src',/^https:\/\/cal\.astforum\.ru\/.+\?embed=true&layout=month_view&theme=light$/)
 await expect(page.getByText('Загрузка календаря…')).toHaveCount(0)
})
