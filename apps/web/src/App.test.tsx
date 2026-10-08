import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, expect, it, vi} from 'vitest'
import {App} from './App'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
function mount(){return render(<ThemeProvider colorMode="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)}
it.each([200,401,500])('one unified session preserves held homepage and modal at status %s',async status=>{
 history.replaceState({foreign:42},'','/?campaign=unified#rules')
 let settle!: (response:Response)=>void
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{settle=resolve}))
 vi.stubGlobal('fetch',fetcher);vi.stubEnv('VITE_FORUM_SESSION','true')
 mount();const heading=screen.getByRole('heading',{level:1})
 const opener=within(screen.getByRole('banner')).getByRole('link',{name:'Войти'})
 fireEvent.click(opener)
 expect(screen.queryByRole('link',{name:'Зарегистрироваться'})).not.toBeInTheDocument()
 expect(location.pathname).toBe('/login')
 expect(fetcher).toHaveBeenCalledTimes(1)
 await act(async()=>settle(new Response(status===200?JSON.stringify({user:{id:'fixture',displayName:'Fixture'}}):'',{status})))
 expect(document.querySelector('h1')).toBe(heading)
 expect(history.state.publicAuthBackground).toBe('/?campaign=unified#rules')
 if(status===200){expect(screen.getByText('Вы уже вошли в аккаунт')).toBeInTheDocument();expect(opener).toHaveTextContent('В кабинет')}
 else expect(screen.getByRole('button',{name:'Войти по Сбер ID'})).toHaveProperty('disabled',status!==401)
 fireEvent.click(screen.getByRole('button',{name:'Закрыть окно'}))
 await waitFor(()=>expect(location.pathname+location.search+location.hash).toBe('/?campaign=unified#rules'))
 expect(document.querySelector('h1')).toBe(heading)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['/customers/','/suppliers/','/work/','/participate/','/login','/register'])('unified direct route %s owns one session',async path=>{
 history.replaceState(null,'',path)
 const fetcher=vi.fn(async()=>new Response('',{status:401}));vi.stubGlobal('fetch',fetcher)
 mount();await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1))
 expect(screen.getByRole('heading',{level:1})).toBeInTheDocument()
 expect(screen.queryByText('Страница не найдена')).not.toBeInTheDocument()
 if(path==='/register') expect(location.pathname).toBe('/login')
})
