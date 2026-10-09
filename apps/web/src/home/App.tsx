import {useRef, useState} from 'react'
import {Banner, Button, Heading, Link, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {HomePage} from './HomePage'
import {DemoDialog} from './DemoDialog'
import {SiteFooter, SiteHeader} from './SharedLayout'
import {audiences} from './content'
import {destinations} from './config'
import {useForumSession} from './useForumSession'
import {AuthNotice} from './AuthNotice'
import {usePublicPageUrl} from '../navigation'
import {Cabinet} from './Cabinet'

function DestinationPreview({path}: {path: string}) {
  const audience = audiences.find(item => item.path === path)
  const titles: Record<string, string> = {
    '/authorization/': 'Вход и регистрация',
    '/cabinet/': 'Личный кабинет',
    '/privacy/': 'Политика обработки персональных данных',
    '/cookies/': 'Использование cookies',
  }
  const title = audience?.nav || titles[path] || 'Страница не найдена'
  return (
    <main id="main" tabIndex={-1} className="container destination-main">
      <Stack gap="spacious" className="destination-content">
        <Link href="/">← На главную</Link>
        <Heading as="h1" variant="large">{title}</Heading>
        {audience && (
          <Card>
            <Card.Heading as="h2">{audience.title}</Card.Heading>
            <Card.Description>{audience.description}</Card.Description>
            <Card.Metadata>
              <Text as="ol" size="medium" className="audience-steps muted">
                {audience.steps.map(step => <li key={step}>{step}</li>)}
              </Text>
            </Card.Metadata>
          </Card>
        )}
        <Banner title="Локальный просмотр перехода" variant="info">
          <Text as="p">
            {audience
              ? `Главная ведёт в раздел «${audience.nav}». Полная страница ${audience.code} создаётся отдельно.`
              : path === '/authorization/' || path === '/cabinet/'
                ? 'В этой локальной версии вход и создание учётной записи не подключены.'
                : path === '/privacy/' || path === '/cookies/'
                  ? 'Перед использованием сайта здесь должен быть размещён действующий документ оператора.'
                  : 'Проверьте адрес или вернитесь на главную.'}
          </Text>
        </Banner>
        {audience && <Button as="a" href={destinations.start} variant="primary">Начать работу</Button>}
        <Button as="a" href="/">Вернуться на главную</Button>
      </Stack>
    </main>
  )
}

export function App() {
  const authorized = useForumSession()
  const [demoOpen, setDemoOpen] = useState(false)
  const demoTriggerRef = useRef<HTMLElement | null>(null)
  const openDemo = (trigger: HTMLButtonElement) => {
    demoTriggerRef.current = trigger
    setDemoOpen(true)
  }
  const pageUrl = usePublicPageUrl()
  const page = new URL(pageUrl, window.location.origin)
  const pathname = page.pathname
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  // A documented, read-only preview state. This never asserts a real session.
  const authorizedPreview = import.meta.env.VITE_FORUM_SESSION !== 'true' && page.searchParams.get('previewSession') === 'authorized'
  if (path === '/cabinet/' || path === '/cabinet/work/' || path === '/cabinet/organizations/') return <Cabinet />
  return (
    <>
      <SiteHeader authorized={authorized || authorizedPreview} />
      {import.meta.env.VITE_FORUM_SESSION === 'true' && !authorized && <AuthNotice />}
      {path === '/' ? <HomePage onDemo={openDemo} /> : <DestinationPreview path={path} />}
      <SiteFooter />
      {demoOpen && <DemoDialog onClose={() => setDemoOpen(false)} returnFocusRef={demoTriggerRef} />}
    </>
  )
}
