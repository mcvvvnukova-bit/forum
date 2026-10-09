import {useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {Banner, Button, Dialog, Heading, Link, IconButton, NavList, Spinner, Stack, Text} from '@primer/react'
import {BookIcon, BriefcaseIcon, FileIcon, GearIcon, HomeIcon, InfoIcon, LocationIcon, MailIcon, OrganizationIcon, PersonIcon, QuestionIcon, ShieldLockIcon, SignOutIcon, ThreeBarsIcon} from '@primer/octicons-react'
import {buildProfileSections, type ProfileSection, type SberProfile} from './profile'

type ProfileView = 'profile' | 'work' | 'settings' | 'organizations'
type Account = {root: string; logo: string; displayName: string; individual: boolean; onLogout: () => void; leaving: boolean; logoutFailed: boolean}
export type ProfilePageProps = {profile: SberProfile; approvedScopes: readonly string[]; state?: 'ready' | 'loading' | 'error'; onRetry?: () => void; view?: ProfileView; account?: Account; settingsContent?:ReactNode; organizations?:ReactNode}
const icons = {personal: PersonIcon, identity: FileIcon, addresses: LocationIcon, tax: FileIcon, contacts: MailIcon, pension: ShieldLockIcon, work: BriefcaseIcon, education: BookIcon, 'self-employment': PersonIcon, 'international-passport': FileIcon, 'previous-passport': FileIcon}
function ProfileNavigation({onNavigate, disabled = false, view, root, settings=false, live=false}: {onNavigate?: () => void; disabled?: boolean; view: ProfileView; root: string; settings?:boolean; live?:boolean}) {
  const profileRoot = root
  return <NavList aria-label="Навигация личного кабинета">
    <NavList.Group>
      <NavList.GroupHeading>Мой профиль</NavList.GroupHeading>
      <NavList.Item href={disabled ? '#main' : `${profileRoot}#personal`} onClick={onNavigate} aria-current={view === 'profile' ? 'page' : undefined}><NavList.LeadingVisual><PersonIcon/></NavList.LeadingVisual>Личные данные</NavList.Item>
      <NavList.Item href={root === import.meta.env.BASE_URL ? '/profile/work#main' : `${root}work/#main`} onClick={onNavigate} aria-current={view === 'work' ? 'page' : undefined}><NavList.LeadingVisual><BriefcaseIcon/></NavList.LeadingVisual>Работа</NavList.Item>
    </NavList.Group>
    <NavList.Divider/>
    {live ? <NavList.Item href={`${root}organizations/#main`} onClick={onNavigate} aria-current={view === 'organizations' ? 'page' : undefined}><NavList.LeadingVisual><OrganizationIcon/></NavList.LeadingVisual>Мои организации</NavList.Item> : <NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><OrganizationIcon/></NavList.LeadingVisual>Добавить компанию</NavList.Item>}
    {settings?<NavList.Item href={`${root}settings/#main`} onClick={onNavigate} aria-current={view==='settings'?'page':undefined}><NavList.LeadingVisual><GearIcon/></NavList.LeadingVisual>Настройки</NavList.Item>:<NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><GearIcon/></NavList.LeadingVisual>Настройки</NavList.Item>}
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
  </section>
}
export function ProfilePage({profile, approvedScopes, state = 'ready', onRetry, view = 'profile', account, settingsContent, organizations}: ProfilePageProps) {
  const profileRoot = account?.root ?? import.meta.env.BASE_URL
  const [dialog, setDialog] = useState<'edit' | 'menu' | 'support' | null>(null)
  const editRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const supportRef = useRef<HTMLButtonElement>(null)
  const sections = state === 'ready' ? buildProfileSections(profile, approvedScopes, account?.displayName) : []
  const visibleSections = sections.filter(section => {
    const belongsToWork = section.id === 'work' || section.id === 'self-employment'
    return view === 'work' ? belongsToWork : !belongsToWork
  })
  const fullName = sections.flatMap(s => s.fields).find(f => f.id === 'full_name')
  const accountName = account?.displayName ?? (fullName?.status === 'provided' ? fullName.value.split(' ').slice(0, 2).reverse().join(' ') : 'Мой профиль')
  const close = () => setDialog(null)
  return <div className="cabinet">
    <header className="cabinet-header">
      <Link href="#main" className="skip-link">Перейти к содержанию</Link>
      <div className="header-brand"><IconButton ref={menuRef} className="mobile-menu" icon={ThreeBarsIcon} aria-label="Открыть меню профиля" onClick={() => setDialog('menu')}/>
        <Link href={`${profileRoot}#main`} aria-label="АСТ Форум: личный кабинет" className={account ? "brand-link account-brand" : "brand-link"}><img src={account?.logo ?? `${profileRoot}assets/forum-logo.png`} width="144" height="48" alt="АСТ Форум"/></Link>
      </div>
      <Stack direction="horizontal" gap="condensed" align="center" className="header-account">
        <Link href={`${profileRoot}#main`} className="account-link" aria-current={view === 'profile' ? 'page' : undefined}><PersonIcon/><Text>{accountName}</Text></Link>
        {account && <IconButton icon={SignOutIcon} aria-label="Выйти" variant="invisible" onClick={account.onLogout} disabled={account.leaving} aria-busy={account.leaving}/>}
      </Stack>
    </header>
    <div className="cabinet-body">
      <aside className="sidebar">
        <div className="workspace-heading"><HomeIcon size={20}/><Text weight="semibold">Личный кабинет</Text></div>
        <ProfileNavigation disabled={state !== 'ready'} view={view} root={profileRoot} settings={Boolean(account && settingsContent)} live={!!account}/>
        <div className="sidebar-bottom"><Button ref={supportRef} variant="invisible" leadingVisual={QuestionIcon} onClick={() => setDialog('support')}>Связаться с поддержкой</Button></div>
      </aside>
      <main className="profile-main" id="main" tabIndex={-1}>
        <Stack>
          {!account && <Banner title="Демонстрационный профиль" description="Все показанные данные вымышлены. Подключение к Сбер ID отсутствует."/>}
          {account?.logoutFailed && <Banner title="Не удалось выйти. Повторите попытку" variant="warning"/>}
          <div className="page-heading">
          <div>{view!=='settings' && view!=='organizations' && <Text as="p" size="small" className="eyebrow muted">Мой профиль</Text>}<Heading as="h1" variant="large" id={view==='organizations'?'organizations-heading':undefined}>{view==='organizations'?'Мои организации':view==='settings'?'Настройки':view === 'work' ? 'Работа' : 'Личные данные'}</Heading></div>
          {view!=='settings' && view!=='organizations' && <Button ref={editRef} leadingVisual={InfoIcon} onClick={() => setDialog('edit')}>Как изменить данные</Button>}
          </div>
        </Stack>
        {state === 'loading' && <div className="state-content" role="status"><Spinner size="medium"/><Heading as="h2" variant="small">Загружаем профиль</Heading><Text className="muted">Подготавливаем ваши данные.</Text></div>}
        {state === 'error' && <div className="state-content"><Banner variant="critical" title="Не удалось загрузить профиль" description="Попробуйте ещё раз. Если ошибка повторится, обратитесь в поддержку." primaryAction={<Button onClick={onRetry}>Повторить</Button>}/></div>}
        {state === 'ready' && (view==='organizations'?organizations:view==='settings'?settingsContent:<div className={view === 'work' ? 'profile-grid work-grid' : 'profile-grid'}>{visibleSections.map(s => <ProfileCard key={s.id} section={s}/>)}</div>)}
        {!account && <footer className="profile-footer"><Text size="small" className="muted">© 2026 АСТ Форум</Text></footer>}
      </main>
    </div>
    {dialog === 'edit' && <Dialog title="Изменение данных профиля" onClose={close} returnFocusRef={editRef} width="large" footerButtons={[{content: 'Понятно', onClick: close}]}>
      <Stack gap="normal"><Text as="p">{account ? 'Профиль доступен для просмотра. Изменение этих сведений в системе пока недоступно.' : 'Это макет с вымышленными данными. Изменение данных в макете недоступно; подключение к Сбер ID отсутствует.'}</Text></Stack>
    </Dialog>}
    {dialog === 'menu' && <Dialog title="Разделы профиля" onClose={close} returnFocusRef={menuRef} position={{narrow: 'bottom', regular: 'center', wide: 'center'}} width="large"><ProfileNavigation onNavigate={close} disabled={state !== 'ready'} view={view} root={profileRoot} settings={Boolean(account && settingsContent)} live={!!account}/></Dialog>}
    {dialog === 'support' && <Dialog title="Поддержка АСТ Форум" onClose={close} returnFocusRef={supportRef} width="large" footerButtons={[{content: 'Закрыть', onClick: close}]}><Stack gap="normal"><Text as="p">По вопросам работы с профилем напишите в поддержку площадки.</Text><Link href="mailto:info@astforum.ru">info@astforum.ru</Link>{!account && <Text as="p" className="muted">В этом макете используются только вымышленные данные.</Text>}</Stack></Dialog>}
  </div>
}
