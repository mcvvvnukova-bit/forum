import {useEffect, useRef, useState} from 'react'
import {Banner, Button, Spinner, Stack, Text} from '@primer/react'
import {ProfilePage} from '../../../profile-preview/src/ProfilePage'
import {profileScopes, type SberProfile} from '../../../profile-preview/src/profile'
import {usePublicSession} from '../SessionProvider'
import type {Session} from '../audience/intent'
import './cabinet.css'

type ProfileState = {kind:'loading'|'error'|'expired'} | {kind:'ready'; profile:SberProfile}
function returnHome(url:string) {
  history.replaceState(null, '', url)
  window.scrollTo({left:0,top:0,behavior:'instant'})
  window.dispatchEvent(new PopStateEvent('popstate'))
}
function AuthenticatedCabinet({session, onExpired, navigate}: {session:Session; onExpired:()=>void; navigate:(url:string)=>void}) {
  const [value,setValue]=useState<ProfileState>({kind:'loading'})
  const [attempt,setAttempt]=useState(0)
  const [leaving,setLeaving]=useState(false)
  const [logoutFailed,setLogoutFailed]=useState(false)
  const expiredRef=useRef(onExpired)
  expiredRef.current=onExpired
  const userId=session.user.id
  const view=location.pathname.replace(/\/$/,'')==='/cabinet/work'?'work':'profile'
  useEffect(()=>{document.title=`${view==='work'?'Работа':'Личные данные'} | АСТ Форум`},[view])
  useEffect(()=>{
    const controller=new AbortController()
    const timer=window.setTimeout(()=>controller.abort(),10_000)
    let active=true
    void (async()=>{
      try {
        const response=await fetch('/api/profile',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
        if(!active) return
        if(response.status===401){setValue({kind:'expired'});expiredRef.current();return}
        if(response.status!==200) throw new Error('Profile unavailable')
        const result=await response.json() as {userId?:unknown;profile?:unknown}
        if(result.userId!==userId || !result.profile || typeof result.profile!=='object' || Array.isArray(result.profile)) throw new Error('Invalid profile')
        if(active && !controller.signal.aborted) setValue({kind:'ready',profile:result.profile as SberProfile})
      } catch {if(active) setValue({kind:'error'})}
      finally {window.clearTimeout(timer)}
    })()
    return()=>{active=false;window.clearTimeout(timer);controller.abort()}
  },[userId,attempt])
  const logout=async()=>{
    if(leaving)return
    setLeaving(true);setLogoutFailed(false)
    try {
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store'})
      if(response.status!==204)throw new Error('Logout unavailable')
      setValue({kind:'expired'});expiredRef.current();navigate('/')
    } catch {setLogoutFailed(true)}
    finally {setLeaving(false)}
  }
  if(value.kind==='expired')return null
  return <ProfilePage profile={value.kind==='ready'?value.profile:{}} approvedScopes={profileScopes}
    state={value.kind==='ready'?'ready':value.kind==='error'?'error':'loading'} view={view}
    onRetry={()=>{setValue({kind:'loading'});setAttempt(n=>n+1)}}
    account={{root:'/cabinet/',logo:'/assets/brand-logo-horizontal-color.png',displayName:session.user.displayName,
      individual:session.roles?.includes('individual')??false,onLogout:()=>void logout(),leaving,logoutFailed}}/>
}
export function Cabinet({navigate=returnHome}:{navigate?:(url:string)=>void}={}) {
  const {session,loading,unavailable,retry}=usePublicSession()
  const guest=!loading&&!unavailable&&!session
  useEffect(()=>{if(guest)navigate('/')},[guest,navigate])
  if(guest)return null
  if(loading)return <main id="main" className="container destination-main"><Stack direction="horizontal" gap="normal" align="center"><Spinner size="small"/><Text role="status">Проверяем вход…</Text></Stack></main>
  if(unavailable)return <main id="main" className="container destination-main"><Banner title="Не удалось проверить вход" variant="warning"><Button onClick={retry}>Повторить</Button></Banner></main>
  if(!session)return null
  return <AuthenticatedCabinet key={session.user.id} session={session} onExpired={retry} navigate={navigate}/>
}
