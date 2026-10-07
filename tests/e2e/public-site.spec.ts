import {test,expect} from '@playwright/test'

for(const width of [320,390,1440]){
 test(`built public routes and reload at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/auth/session',route=>route.fulfill({status:401,body:''}))
  for(const path of ['/','/customers/','/suppliers/','/work/','/participate/','/login','/register']){
   await page.goto(path);await expect(page.locator('h1')).toBeVisible()
   await page.reload();await expect(page.locator('h1')).toBeVisible()
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
 })
 for(const mode of ['login','register']){
  test(`built held 200 ${mode} history and focus at ${width}`,async({page})=>{
   await page.setViewportSize({width,height:1000})
   let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});let requests=0
   await page.route('**/api/auth/session',async route=>{requests++;await held;await route.fulfill({status:200,json:{user:{id:'synthetic',displayName:'Synthetic'}}})})
   const background='/?campaign=built#rules'
   await page.goto(background)
   await page.locator('h1').evaluate(node=>node.setAttribute('data-original-home','yes'))
   const opener=mode==='login'?page.locator('.site-header').getByRole('link',{name:'Войти',exact:true}):page.getByRole('link',{name:'Начать работу',exact:true})
   await opener.click()
   const other=mode==='login'?'Зарегистрироваться':'Войти'
   await page.getByRole('dialog').getByRole('link',{name:other,exact:true}).click()
   await page.getByRole('dialog').getByRole('link',{name:mode==='login'?'Войти':'Зарегистрироваться',exact:true}).click()
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
}
for(const status of [401,500])test(`built guest and unknown ${status}`,async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({status,body:''}))
 await page.goto('/login?auth_error=sber_unavailable')
 await expect(page.getByText(status===401?'Вход через Сбер ID пока недоступен':'Не удалось проверить вход. Повторите попытку')).toBeVisible()
 await expect(page.getByRole('button',{name:'Войти по Сбер ID'})).toBeDisabled()
})
