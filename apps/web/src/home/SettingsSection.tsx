import {useEffect, useRef, useState} from 'react'
import {Banner, Button, Checkbox, FormControl, Spinner, Stack, Text} from '@primer/react'

type Settings = {userId:string;workAsIndividual:boolean}
type State = {kind:'loading'} | {kind:'error'} | {kind:'ready'|'saving';enabled:boolean;notice?:'saved'|'uncertain'|'restricted'}
class SessionExpired extends Error {}
class ParticipationRestricted extends Error {}

async function requestSettings(userId:string, signal:AbortSignal, enabled?:boolean):Promise<Settings> {
  const controller=new AbortController()
  const abort=()=>controller.abort()
  signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted)abort()
  const timer=window.setTimeout(abort,10_000)
  try {
    const response=await fetch('/api/settings',{credentials:'same-origin',cache:'no-store',signal:controller.signal,
      ...(enabled===undefined?{}:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({workAsIndividual:enabled})})})
    if(response.status===401)throw new SessionExpired()
    if(response.status===409)throw new ParticipationRestricted()
    if(response.status!==200)throw new Error('Settings unavailable')
    const result:unknown=await response.json()
    if(!result || typeof result!=='object' || !('userId' in result) || result.userId!==userId
      || !('workAsIndividual' in result) || typeof result.workAsIndividual!=='boolean')throw new Error('Invalid settings')
    return {userId,workAsIndividual:result.workAsIndividual}
  } finally {window.clearTimeout(timer);signal.removeEventListener('abort',abort)}
}

export function SettingsSection({userId,onExpired}:{userId:string;onExpired:()=>void}) {
  const [state,setState]=useState<State>({kind:'loading'})
  const [attempt,setAttempt]=useState(0)
  const scope=useRef<AbortController|null>(null)
  const expired=useRef(onExpired)
  expired.current=onExpired
  useEffect(()=>{
    const controller=new AbortController()
    scope.current=controller
    void requestSettings(userId,controller.signal).then(value=>{
      if(!controller.signal.aborted)setState({kind:'ready',enabled:value.workAsIndividual})
    }).catch(error=>{
      if(controller.signal.aborted)return
      if(error instanceof SessionExpired)expired.current()
      else setState({kind:'error'})
    })
    return()=>controller.abort()
  },[userId,attempt])
  const save=async(enabled:boolean)=>{
    const signal=scope.current?.signal
    if(state.kind!=='ready' || !signal || signal.aborted)return
    setState({kind:'saving',enabled:state.enabled})
    try {
      const value=await requestSettings(userId,signal,enabled)
      if(!signal.aborted)setState({kind:'ready',enabled:value.workAsIndividual,notice:'saved'})
    } catch(error) {
      if(signal.aborted)return
      if(error instanceof SessionExpired){expired.current();return}
      // A timeout may follow a committed write. Only a fresh GET can establish
      // the saved choice; keep editing blocked if that read also fails.
      try {
        const value=await requestSettings(userId,signal)
        if(!signal.aborted)setState({kind:'ready',enabled:value.workAsIndividual,notice:error instanceof ParticipationRestricted?'restricted':'uncertain'})
      } catch(readError) {
        if(signal.aborted)return
        if(readError instanceof SessionExpired)expired.current()
        else setState({kind:'error'})
      }
    }
  }
  if(state.kind==='loading')return <Stack direction="horizontal" align="center" gap="normal"><Spinner size="small"/><Text role="status">Загружаем настройки…</Text></Stack>
  if(state.kind==='error')return <Banner title="Не удалось загрузить настройки" variant="critical" description="Проверьте соединение и повторите попытку."><Button onClick={()=>{setState({kind:'loading'});setAttempt(n=>n+1)}}>Повторить</Button></Banner>
  return <Stack gap="normal">
    <FormControl disabled={state.kind==='saving'}>
      <Checkbox checked={state.enabled} onChange={event=>void save(event.target.checked)}/>
      <FormControl.Label>Хочу работать на площадке как физическое лицо</FormControl.Label>
      <FormControl.Caption>Включает участие исполнителем от своего имени. При отключении ваш аккаунт и профиль сохраняются.</FormControl.Caption>
    </FormControl>
    <Text role="status" aria-live="polite">{state.kind==='saving'?'Сохраняем…':state.notice==='saved'?'Сохранено':''}</Text>
    {state.notice==='uncertain' && <Banner title="Не удалось подтвердить сохранение. Проверьте выбор и повторите при необходимости." variant="warning"/>}
    {state.notice==='restricted' && <Banner title="Участие исполнителем ограничено. Обратитесь в поддержку." variant="warning"/>}
  </Stack>
}
