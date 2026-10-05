import {ProfilePage} from './ProfilePage'
import {approvedScopes, demoProfile} from './fixtures'

export function App() {
  return <ProfilePage profile={demoProfile} approvedScopes={approvedScopes}/>
}
