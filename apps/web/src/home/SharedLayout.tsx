import {useLayoutEffect, useRef} from 'react'
import {Button, Heading, Link, Stack, Text} from '@primer/react'
import {ArrowRightIcon} from '@primer/octicons-react'
import {audiences} from './content'
import {destinations} from './config'

export function SiteHeader({authorized = false}: {authorized?: boolean}) {
  const headerRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const root = document.documentElement
    const updateHeight = () => root.style.setProperty('--site-header-height', `${header.getBoundingClientRect().height}px`)
    updateHeight()
    const observer = new window.ResizeObserver(updateHeight)
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--site-header-height')
    }
  }, [])

  return (
    <header ref={headerRef} className="site-header" id="top">
      <Link className="skip-link" href="#main">Перейти к содержанию</Link>
      <div className="container header-layout">
        <Link href="/" className="brand" aria-label="АСТ Форум — главная">
          <img src="/assets/brand-logo-horizontal-color.png" alt="АСТ Форум" width="144" height="48" />
        </Link>
        <nav aria-label="Основная навигация" className="header-navigation">
          {audiences.map(item => <Link key={item.key} href={destinations[item.key]} muted>{item.nav}</Link>)}
          <Link href="/#rules" muted>О платформе</Link>
        </nav>
        <Button as="a" href={authorized ? destinations.cabinet : destinations.login} trailingVisual={ArrowRightIcon}>
          {authorized ? 'В кабинет' : 'Войти'}
        </Button>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer" id="contacts">
      <div className="container footer-grid">
        <Stack gap="normal">
          <Link href="/" className="brand" aria-label="АСТ Форум — главная">
            <img src="/assets/brand-logo-horizontal-color.png" alt="АСТ Форум" width="144" height="48" loading="lazy" />
          </Link>
          <Text as="p" className="muted">АСТ Форум — заказы, исполнители<br />и работа в строительстве</Text>
        </Stack>
        <Stack gap="normal" as="nav" aria-label="Для участников">
          <Heading as="h2" variant="small">Для участников</Heading>
          {audiences.map(item => <Link key={item.key} href={destinations[item.key]} muted>{item.nav}</Link>)}
        </Stack>
        <Stack gap="condensed">
          <Heading as="h2" variant="small">Контакты</Heading>
          <Text as="p" size="small" className="muted">ООО «Форум»</Text>
          <Text as="p" size="small" className="muted">ИНН 9709128511</Text>
          <Text as="p" size="small" className="muted">ОГРН 1257700433935</Text>
          <Text as="p" size="small" className="muted"><Link href="mailto:info@astforum.ru" muted>info@astforum.ru</Link></Text>
          <Text as="p" size="small" className="muted">+7 (495) 205-45-65</Text>
        </Stack>
      </div>
      <div className="container footer-bottom">
        <Text size="small" className="muted">© 2026 ООО «Форум»</Text>
        <nav aria-label="Служебные ссылки" className="legal-links">
          <Link href={destinations.privacy} muted>Политика обработки персональных данных</Link>
          <Link href={destinations.cookies} muted>Использование cookies</Link>
        </nav>
      </div>
    </footer>
  )
}
