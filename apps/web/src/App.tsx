import {App as Home} from './home/App'
import {App as Audience} from './audience/App'
import {PublicAuth} from './auth/PublicAuth'
import {SessionProvider} from './SessionProvider'
import {usePublicPageUrl} from './navigation'

export function App() {
  const page = new URL(usePublicPageUrl(), location.origin)
  const path = page.pathname.replace(/\/$/, '')
  const standalone = path === '/login' || path === '/register'
  const audience = ['/customers', '/suppliers', '/work', '/participate'].includes(path)
  return <SessionProvider>
    {!standalone && (audience ? <Audience /> : <Home />)}
    <PublicAuth />
  </SessionProvider>
}
