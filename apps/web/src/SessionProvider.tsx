import {createContext, useContext, useEffect, useState} from 'react'
import type {PropsWithChildren} from 'react'
import {requestSession} from './session'
import type {SessionResult} from './session'

type Value = SessionResult & {retry: () => void}
const Context = createContext<Value | null>(null)
export const useSharedSession = () => useContext(Context)
function useRequest(enabled:boolean):Value {
  const [attempt, setAttempt] = useState(0)
  const [value, setValue] = useState<SessionResult>({session:null, loading:enabled, unavailable:false})
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void requestSession(controller.signal).then(result => {if (!controller.signal.aborted) setValue(result)})
    return () => controller.abort()
  }, [attempt, enabled])
  const retry = () => {setValue({session:null, loading:true, unavailable:false}); setAttempt(value => value+1)}
  return {...value, retry}
}
// Component harnesses use the same request contract without a provider. The
// actual public bootstrap always supplies one provider, so fallback is disabled.
export function usePublicSession(enabled=true):Value {
  const shared=useSharedSession()
  const local=useRequest(enabled && shared===null)
  return shared ?? local
}
export function SessionProvider({children}: PropsWithChildren) {
  const value=useRequest(true)
  return <Context.Provider value={value}>{children}</Context.Provider>
}
