import {useState} from 'react'
import {Banner, Button, Heading, Link, Spinner, Stack, Text} from '@primer/react'
import {usePublicSession} from '../SessionProvider'

export function Cabinet() {
  const {session, loading, unavailable, retry}=usePublicSession()
  const [leaving,setLeaving]=useState(false)
  const [logoutFailed,setLogoutFailed]=useState(false)
  const logout=async () => {
    if (leaving) return
    setLeaving(true); setLogoutFailed(false)
    try {
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store'})
      if (response.status!==204) throw new Error('Logout unavailable')
      retry()
    } catch {setLogoutFailed(true)}
    finally {setLeaving(false)}
  }
  return <main id="main" tabIndex={-1} className="container destination-main">
    <Stack gap="spacious" className="destination-content">
      <Heading as="h1" variant="large">Личный кабинет</Heading>
      {loading ? <Stack direction="horizontal" gap="normal" align="center"><Spinner size="small"/><Text role="status">Проверяем вход…</Text></Stack>
        : unavailable ? <Banner title="Не удалось проверить вход" variant="warning"><Button onClick={retry}>Повторить</Button></Banner>
        : session ? <>
          <Heading as="h2">{session.user.displayName}</Heading>
          {session.roles?.includes('individual') && <Text as="p">Физлицо</Text>}
          {logoutFailed && <Banner title="Не удалось выйти. Повторите попытку" variant="warning"/>}
          <Button onClick={() => void logout()} disabled={leaving}>{leaving ? 'Выходим…' : 'Выйти'}</Button>
        </> : <><Text as="p">Войдите через Сбер ID, чтобы открыть личный кабинет</Text><Button as="a" href="/login" variant="primary">Войти через Сбер ID</Button></>}
      <Link href="/">На главную</Link>
    </Stack>
  </main>
}
