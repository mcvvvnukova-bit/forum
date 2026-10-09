import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {App} from './App'
import {SessionProvider} from '../SessionProvider'

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
const label='Хочу работать на площадке как физическое лицо'
function page(){
  vi.stubGlobal('scrollTo',vi.fn())
  history.replaceState(null,'','/cabinet/settings/')
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><SessionProvider><App/></SessionProvider></BaseStyles></ThemeProvider>)
}
function network(settings:(init?:RequestInit)=>Promise<Response>){
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
    if(url==='/api/auth/session')return Response.json({user:{id:'owner',displayName:'Анна Иванова'},roles:['individual']})
    if(url==='/api/settings')return settings(init)
    if(url==='/api/profile')return new Response('',{status:503})
    throw new Error('Unexpected URL '+url)
  })
}
describe('individual participation settings',()=>{
  it('opens a single checkbox without depending on the profile endpoint',async()=>{
    network(async()=>Response.json({userId:'owner',workAsIndividual:false}))
    page()
    expect(await screen.findByRole('checkbox',{name:label})).not.toBeChecked()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('heading',{name:'Настройки'})).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Настройки'})).toHaveAttribute('aria-current','page')
    expect(document.title).toBe('Настройки | АСТ Форум')
  })
  it('waits for server confirmation and restores the choice on remount',async()=>{
    let enabled=false
    let confirm:()=>void=()=>{}
    network(async init=>{
      if(init?.method==='PUT'){
        expect(init.credentials).toBe('same-origin')
        expect(JSON.parse(String(init.body))).toEqual({workAsIndividual:true})
        await new Promise<void>(resolve=>{confirm=resolve})
        enabled=true
      }
      return Response.json({userId:'owner',workAsIndividual:enabled})
    })
    const view=page()
    const checkbox=await screen.findByRole('checkbox',{name:label})
    fireEvent.click(checkbox)
    expect(checkbox).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем')
    await act(async()=>confirm())
    await waitFor(()=>expect(checkbox).toBeChecked())
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено')
    view.unmount();page()
    expect(await screen.findByRole('checkbox',{name:label})).toBeChecked()
  })
  it('reconciles an uncertain write with the saved server choice',async()=>{
    let enabled=false
    network(async init=>{
      if(init?.method==='PUT'){enabled=true;throw new TypeError('Connection lost after commit')}
      return Response.json({userId:'owner',workAsIndividual:enabled})
    })
    page()
    fireEvent.click(await screen.findByRole('checkbox',{name:label}))
    await waitFor(()=>expect(screen.getByRole('checkbox',{name:label})).toBeChecked())
    expect(screen.getByText('Не удалось подтвердить сохранение. Проверьте выбор и повторите при необходимости.')).toBeInTheDocument()
    expect(screen.queryByText('Сохранено')).not.toBeInTheDocument()
  })
  it('blocks edits until a failed read is retried',async()=>{
    let unavailable=true
    network(async()=>unavailable?new Response('',{status:503}):Response.json({userId:'owner',workAsIndividual:true}))
    page()
    fireEvent.click(await screen.findByRole('button',{name:'Повторить'}))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    unavailable=false
    fireEvent.click(await screen.findByRole('button',{name:'Повторить'}))
    expect(await screen.findByRole('checkbox',{name:label})).toBeChecked()
  })
  it('rejects settings belonging to a different owner',async()=>{
    network(async()=>Response.json({userId:'someone-else',workAsIndividual:true}))
    page()
    expect(await screen.findByRole('button',{name:'Повторить'})).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
  it('explains an administrative restriction without showing a saved or enabled choice',async()=>{
    network(async init=>init?.method==='PUT'?Response.json({code:'participation_restricted'},{status:409}):Response.json({userId:'owner',workAsIndividual:false}))
    page()
    fireEvent.click(await screen.findByRole('checkbox',{name:label}))
    expect(await screen.findByText('Участие исполнителем ограничено. Обратитесь в поддержку.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox',{name:label})).not.toBeChecked()
    expect(screen.queryByText('Сохранено')).not.toBeInTheDocument()
  })
  it('removes closed settings when the session expires while saving',async()=>{
    let expired=false
    vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
      if(url==='/api/auth/session')return expired?new Response('',{status:401}):Response.json({user:{id:'owner',displayName:'Анна Иванова'},roles:['individual']})
      if(url==='/api/settings' && init?.method==='PUT'){expired=true;return new Response('',{status:401})}
      if(url==='/api/settings')return Response.json({userId:'owner',workAsIndividual:true})
      throw new Error('Unexpected URL '+url)
    })
    page()
    fireEvent.click(await screen.findByRole('checkbox',{name:label}))
    await waitFor(()=>expect(location.pathname).toBe('/'))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument()
  })
})
