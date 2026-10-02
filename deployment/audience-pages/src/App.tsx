import {useEffect, useRef, useState} from 'react'
import {Banner, Button, Dialog, Heading, Link, Stack, Text} from '@primer/react'
import {HomePage} from './HomePage'
import {DemoDialog} from './DemoDialog'
import {SiteFooter, SiteHeader} from './SharedLayout'
import {AudiencePage} from './AudiencePage'
import type {Intent} from './AudiencePage'
import {WorkPage} from './WorkPage'
import {readIntent, saveIntent} from './intent'
import {useSession} from './use-session'
import {Participation, ParticipationPage} from './Participation'

export function App() {
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoAudience, setDemoAudience] = useState<string | undefined>()
  const [intent, setIntent] = useState<Intent | null>(null)
  const {session, loading, unavailable} = useSession()
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const openDemo = (trigger: HTMLButtonElement, audience?: string) => {if (!intent) returnFocusRef.current = trigger; setDemoAudience(audience); setDemoOpen(true)}
  const openAction = (value: Intent, trigger: HTMLButtonElement | null) => {
    returnFocusRef.current = trigger
    saveIntent(value)
    setIntent(value)
  }
  const raw = window.location.pathname
  const path = raw.endsWith('/') ? raw : `${raw}/`
  useEffect(() => {
    const titles: Record<string,string> = {'/customers/':'Для заказчиков', '/suppliers/':'Для поставщиков и подрядчиков', '/work/':'Работа и подработка', '/participate/':'Вход и регистрация'}
    document.title = `${titles[path] || 'Заказы, исполнители и работа в строительстве'} — АСТ Форум`
  }, [path])
  const resumedIntent = path === '/participate/' && new URLSearchParams(window.location.search).get('resume') === '1' ? readIntent() : null
  const participation = (value: Intent, onReturn: () => void) => <Participation intent={value} session={session} loading={loading} unavailable={unavailable} onDemo={(trigger, audience) => {setIntent(null); openDemo(trigger, audience)}} onReturn={onReturn} />
  return <>
    <SiteHeader />
    {path === '/' ? <HomePage onDemo={openDemo} /> : path === '/customers/' || path === '/suppliers/' ? <AudiencePage kind={path === '/customers/' ? 'customers' : 'suppliers'} onAction={openAction} onDemo={openDemo} /> : path === '/work/' ? <WorkPage onAction={openAction} /> : path === '/participate/' ? <ParticipationPage>{resumedIntent ? participation(resumedIntent, () => {window.location.assign(resumedIntent.returnTo)}) : <Stack gap="normal"><Text as="p">Войдите в существующий аккаунт через Сбер ID или выберите направление работы.</Text><Button as="a" href="/auth/sber-id/start?intent=login">Войти через Сбер ID</Button><Link href="/customers/">Я заказчик</Link><Link href="/suppliers/">Я поставщик или подрядчик</Link><Link href="/work/">Я ищу работу</Link><Banner title="Регистрация компаний — скоро" variant="info">Мы готовим регистрацию через Контур.Диадок.</Banner></Stack>}</ParticipationPage> : <main id="main" className="container destination-main"><Heading as="h1">Страница не найдена</Heading><Link href="/">На главную</Link></main>}
    <SiteFooter />
    {demoOpen && <DemoDialog audience={demoAudience} onClose={() => setDemoOpen(false)} returnFocusRef={returnFocusRef} />}
    {intent && <Dialog title={intent.audience === 'customer' ? 'Регистрация компании-заказчика' : intent.audience === 'supplier' ? 'Регистрация компании-исполнителя' : 'Регистрация через Сбер ID'} onClose={() => setIntent(null)} returnFocusRef={returnFocusRef}>
      {participation(intent, () => setIntent(null))}
    </Dialog>}
  </>
}
