import {useRef, useState} from 'react'
import {Banner, Button, Dialog, Heading, Label, Link, IconButton, NavList, Spinner, Stack, Text} from '@primer/react'
import {ArrowUpRightIcon, BriefcaseIcon, FileIcon, GearIcon, HomeIcon, InfoIcon, LocationIcon, MailIcon, OrganizationIcon, PersonIcon, QuestionIcon, ShieldLockIcon, ThreeBarsIcon} from '@primer/octicons-react'
import {buildProfileSections, type ProfileSection, type SberProfile} from './profile'

type ProfileView = 'profile' | 'work'
export type ProfilePageProps = {profile: SberProfile; approvedScopes: readonly string[]; state?: 'ready' | 'loading' | 'error'; onRetry?: () => void; view?: ProfileView}
const icons = {personal: PersonIcon, identity: FileIcon, addresses: LocationIcon, tax: FileIcon, contacts: MailIcon, pension: ShieldLockIcon, work: BriefcaseIcon}
const navItems = [{id: 'personal', name: 'Личные данные', icon: PersonIcon}, {id: 'identity', name: 'Документ', icon: FileIcon}, {id: 'addresses', name: 'Адреса', icon: LocationIcon}, {id: 'tax', name: 'ИНН и СНИЛС', icon: ShieldLockIcon}, {id: 'contacts', name: 'Контакты', icon: MailIcon}]
function ProfileNavigation({onNavigate, disabled = false, view}: {onNavigate?: () => void; disabled?: boolean; view: ProfileView}) {
  return <NavList aria-label="Навигация личного кабинета">
    <NavList.Group>
      <NavList.GroupHeading>Мой профиль</NavList.GroupHeading>
      {navItems.map(item => <NavList.Item key={item.id} href={disabled ? '#main' : `/#${item.id}`} onClick={onNavigate}>
        <NavList.LeadingVisual><item.icon/></NavList.LeadingVisual>{item.name}
      </NavList.Item>)}
      <NavList.Item href="/profile/work#main" onClick={onNavigate} aria-current={view === 'work' ? 'page' : undefined}><NavList.LeadingVisual><BriefcaseIcon/></NavList.LeadingVisual>Работа и образование</NavList.Item>
    </NavList.Group>
    <NavList.Divider/>
    <NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><GearIcon/></NavList.LeadingVisual>Настройки</NavList.Item>
    <NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><OrganizationIcon/></NavList.LeadingVisual>Добавить компанию</NavList.Item>
  </NavList>
}
function ProfileCard({section}: {section: ProfileSection}) {
  const Icon = icons[section.id as keyof typeof icons] ?? InfoIcon
  return <section className="profile-card" id={section.id} aria-labelledby={`${section.id}-title`}>
    <div className="card-heading"><Icon size={20}/><Heading as="h2" variant="small" id={`${section.id}-title`}>{section.title}</Heading></div>
    <dl className="data-list">{section.fields.map(field => <div className="data-row" key={field.id}>
      <Text as="dt" size="small" className="muted">{field.label}</Text>
      <Text as="dd" className={field.status === 'provided' ? 'field-value' : 'field-value missing-value'}>{field.value}</Text>
    </div>)}</dl>
    {section.id === 'work' && <Text as="p" size="small" className="card-note muted">Эти сведения не определяют ваши права в организации.</Text>}
  </section>
}
export function ProfilePage({profile, approvedScopes, state = 'ready', onRetry, view = 'profile'}: ProfilePageProps) {
  const [dialog, setDialog] = useState<'edit' | 'menu' | 'support' | null>(null)
  const editRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const supportRef = useRef<HTMLButtonElement>(null)
  const sections = state === 'ready' ? buildProfileSections(profile, approvedScopes) : []
  const visibleSections = sections.filter(section => view === 'work' ? section.id === 'work' : section.id !== 'work')
  const fullName = sections.flatMap(s => s.fields).find(f => f.id === 'full_name')
  const accountName = fullName?.status === 'provided' ? fullName.value.split(' ').slice(0, 2).reverse().join(' ') : 'Мой профиль'
  const close = () => setDialog(null)
  return <div className="cabinet">
    <header className="cabinet-header">
      <Link href="#main" className="skip-link">Перейти к содержанию</Link>
      <div className="header-brand"><IconButton ref={menuRef} className="mobile-menu" icon={ThreeBarsIcon} aria-label="Открыть меню профиля" onClick={() => setDialog('menu')}/>
        <Link href="/#main" aria-label="АСТ Форум: личный кабинет" className="brand-link"><img src="/assets/forum-logo.png" width="144" height="48" alt="АСТ Форум"/></Link>
      </div>
      <Link href="/#main" className="account-link" aria-current={view === 'profile' ? 'page' : undefined}><PersonIcon/><Text>{accountName}</Text></Link>
    </header>
    <div className="cabinet-body">
      <aside className="sidebar">
        <div className="workspace-heading"><HomeIcon size={20}/><Text weight="semibold">Личный кабинет</Text></div>
        <ProfileNavigation disabled={state !== 'ready'} view={view}/>
        <div className="sidebar-bottom"><Button ref={supportRef} variant="invisible" leadingVisual={QuestionIcon} onClick={() => setDialog('support')}>Связаться с поддержкой</Button></div>
      </aside>
      <main className="profile-main" id="main" tabIndex={-1}>
        <div className="page-heading">
          <div><Text as="p" size="small" className="eyebrow muted">УЧЁТНАЯ ЗАПИСЬ</Text><Heading as="h1" variant="large">{view === 'work' ? 'Работа и образование' : 'Профиль'}</Heading><Text as="p" className="page-description muted">{view === 'work' ? 'Ваши сведения о работе, образовании и самозанятости.' : 'Ваши личные данные и документы в АСТ Форум.'}</Text></div>
          <Button ref={editRef} leadingVisual={InfoIcon} onClick={() => setDialog('edit')}>Как изменить данные</Button>
        </div>
        <div className="source-notice"><ShieldLockIcon size={20}/><div><Text weight="semibold">Данные из Сбер ID</Text><Text as="p" size="small" className="muted">Доступны только для просмотра. Состав данных зависит от вашего согласия на передачу.</Text></div><Label variant="secondary">Только просмотр</Label></div>
        {state === 'loading' && <div className="state-content" role="status"><Spinner size="medium"/><Heading as="h2" variant="small">Загружаем профиль</Heading><Text className="muted">Подготавливаем ваши данные.</Text></div>}
        {state === 'error' && <div className="state-content"><Banner variant="critical" title="Не удалось загрузить профиль" description="Попробуйте ещё раз. Если ошибка повторится, обратитесь в поддержку." primaryAction={<Button onClick={onRetry}>Повторить</Button>}/></div>}
        {state === 'ready' && <div className={view === 'work' ? 'profile-grid work-grid' : 'profile-grid'}>{visibleSections.map(s => <ProfileCard key={s.id} section={s}/>)}</div>}
        <footer className="profile-footer"><Text size="small" className="muted">© 2026 АСТ Форум</Text></footer>
      </main>
    </div>
    {dialog === 'edit' && <Dialog title="Изменение данных профиля" onClose={close} returnFocusRef={editRef} width="large" footerButtons={[{content: 'Понятно', onClick: close}]}>
      <Stack gap="normal"><Text as="p">Личные данные поступают из Сбер ID. Если в них есть ошибка, измените сведения в своём профиле Сбера или обратитесь в поддержку банка.</Text><Link href="https://online.sberbank.ru/" target="_blank" rel="noopener noreferrer">Открыть СберБанк Онлайн <ArrowUpRightIcon/></Link></Stack>
    </Dialog>}
    {dialog === 'menu' && <Dialog title="Разделы профиля" onClose={close} returnFocusRef={menuRef} position={{narrow: 'bottom', regular: 'center', wide: 'center'}} width="large"><ProfileNavigation onNavigate={close} disabled={state !== 'ready'} view={view}/></Dialog>}
    {dialog === 'support' && <Dialog title="Поддержка АСТ Форум" onClose={close} returnFocusRef={supportRef} width="large" footerButtons={[{content: 'Закрыть', onClick: close}]}><Stack gap="normal"><Text as="p">По вопросам работы с профилем напишите в поддержку площадки.</Text><Link href="mailto:info@astforum.ru">info@astforum.ru</Link><Text as="p" className="muted">Изменения в данных Сбер ID выполняются в Сбере.</Text></Stack></Dialog>}
  </div>
}
