import {useEffect} from 'react'
import {ProfilePage} from './ProfilePage'
import {approvedScopes, demoProfile} from './fixtures'

export function App() {
  const view = window.location.pathname === '/profile/work' ? 'work' : 'profile'
  useEffect(() => {
    document.title = `${view === 'work' ? 'Работа' : 'Личные данные'} | АСТ Форум`
  }, [view])
  return <ProfilePage profile={demoProfile} approvedScopes={approvedScopes} view={view}/>
}
