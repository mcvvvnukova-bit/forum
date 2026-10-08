import {useRef, useState} from 'react'
import {Banner, Button, Dialog, Heading, Link, IconButton, NavList, Spinner, Stack, Text} from '@primer/react'
import {BookIcon, BriefcaseIcon, FileIcon, GearIcon, HomeIcon, InfoIcon, LocationIcon, MailIcon, OrganizationIcon, PersonIcon, QuestionIcon, ShieldLockIcon, ThreeBarsIcon} from '@primer/octicons-react'
import {buildProfileSections, type ProfileSection, type SberProfile} from './profile'

type ProfileView = 'profile' | 'work'
type Account = {root: string; logo: string; displayName: string; individual: boolean; onLogout: () => void; leaving: boolean; logoutFailed: boolean}
export type ProfilePageProps = {profile: SberProfile; approvedScopes: readonly string[]; state?: 'ready' | 'loading' | 'error'; onRetry?: () => void; view?: ProfileView; account?: Account}
const icons = {personal: PersonIcon, identity: FileIcon, addresses: LocationIcon, tax: FileIcon, contacts: MailIcon, pension: ShieldLockIcon, work: BriefcaseIcon, education: BookIcon, 'self-employment': PersonIcon, 'international-passport': FileIcon, 'previous-passport': FileIcon}
function ProfileNavigation({onNavigate, disabled = false, view, root}: {onNavigate?: () => void; disabled?: boolean; view: ProfileView; root: string}) {
  const profileRoot = root
  return <NavList aria-label="Навигация личного кабинета">
    <NavList.Group>
      <NavList.GroupHeading>Мой профиль</NavList.GroupHeading>
      <NavList.Item href={disabled ? '#main' : `${profileRoot}#personal`} onClick={onNavigate} aria-current={view === 'profile' ? 'page' : undefined}><NavList.LeadingVisual><PersonIcon/></NavList.LeadingVisual>Личные данные</NavList.Item>
      <NavList.Item href={root === import.meta.env.BASE_URL ? '/profile/work#main' : `${root}work/#main`} onClick={onNavigate} aria-current={view === 'work' ? 'page' : undefined}><NavList.LeadingVisual><BriefcaseIcon/></NavList.LeadingVisual>Работа</NavList.Item>
    </NavList.Group>
    <NavList.Divider/>
    <NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><OrganizationIcon/></NavList.LeadingVisual>Добавить компанию</NavList.Item>
    <NavList.Item inactiveText="Раздел пока недоступен"><NavList.LeadingVisual><GearIcon/></NavList.LeadingVisual>Настройки</NavList.Item>
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
export function ProfilePage({profile, approvedScopes, state = 'ready', onRetry, view = 'profile', account}: ProfilePageProps) {
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
        <Link href={`${profileRoot}#main`} aria-label="АСТ Форум: личный кабинет" className="brand-link"><img src={account?.logo ?? `${profileRoot}assets/forum-logo.png`} width="144" height="48" alt="АСТ Форум"/></Link>
      </div>
      <Link href={`${profileRoot}#main`} className="account-link" aria-current={view === 'profile' ? 'page' : undefined}><PersonIcon/><Text>{accountName}</Text></Link>
    </header>
    <div className="cabinet-body">
      <aside className="sidebar">
        <div className="workspace-heading"><HomeIcon size={20}/><Text weight="semibold">Личный кабинет</Text></div>
        <ProfileNavigation disabled={state !== 'ready'} view={view} root={profileRoot}/>
        <div className="sidebar-bottom"><Button ref={supportRef} variant="invisible" leadingVisual={QuestionIcon} onClick={() => setDialog('support')}>Связаться с поддержкой</Button></div>
      </aside>
      <main className="profile-main" id="main" tabIndex={-1}>
        <Stack>
          {!account && <Banner title="Демонстрационный профиль" description="Все показанные данные вымышлены. Подключение к Сбер ID отсутствует."/>}
          {account?.logoutFailed && <Banner title="Не удалось выйти. Повторите попытку" variant="warning"/>}
          <div className="page-heading">
          <div><Text as="p" size="small" className="eyebrow muted">Мой профиль</Text><Heading as="h1" variant="large">{view === 'work' ? 'Работа' : 'Личные данные'}</Heading></div>
          <Button ref={editRef} leadingVisual={InfoIcon} onClick={() => setDialog('edit')}>Как изменить данные</Button>
          </div>
        </Stack>
        {state === 'loading' && <div className="state-content" role="status"><Spinner size="medium"/><Heading as="h2" variant="small">Загружаем профиль</Heading><Text className="muted">Подготавливаем ваши данные.</Text></div>}
        {state === 'error' && <div className="state-content"><Banner variant="critical" title="Не удалось загрузить профиль" description="Попробуйте ещё раз. Если ошибка повторится, обратитесь в поддержку." primaryAction={<Button onClick={onRetry}>Повторить</Button>}/></div>}
        {state === 'ready' && <div className={view === 'work' ? 'profile-grid work-grid' : 'profile-grid'}>{visibleSections.map(s => <ProfileCard key={s.id} section={s}/>)}</div>}
        <footer className="profile-footer"><Text size="small" className="muted">© 2026 АСТ Форум</Text>{account && <Stack direction="horizontal" gap="normal" align="center">{account.individual && <Text size="small">Физлицо</Text>}<Link href="/">На главную</Link><Button onClick={account.onLogout} disabled={account.leaving}>{account.leaving ? 'Выходим…' : 'Выйти'}</Button></Stack>}</footer>
      </main>
    </div>
    {dialog === 'edit' && <Dialog title="Изменение данных профиля" onClose={close} returnFocusRef={editRef} width="large" footerButtons={[{content: 'Понятно', onClick: close}]}>
      <Stack gap="normal"><Text as="p">{account ? 'Профиль доступен для просмотра. Изменение этих сведений в системе пока недоступно.' : 'Это макет с вымышленными данными. Изменение данных в макете недоступно; подключение к Сбер ID отсутствует.'}</Text></Stack>
    </Dialog>}
    {dialog === 'menu' && <Dialog title="Разделы профиля" onClose={close} returnFocusRef={menuRef} position={{narrow: 'bottom', regular: 'center', wide: 'center'}} width="large"><ProfileNavigation onNavigate={close} disabled={state !== 'ready'} view={view} root={profileRoot}/></Dialog>}
    {dialog === 'support' && <Dialog title="Поддержка АСТ Форум" onClose={close} returnFocusRef={supportRef} width="large" footerButtons={[{content: 'Закрыть', onClick: close}]}><Stack gap="normal"><Text as="p">По вопросам работы с профилем напишите в поддержку площадки.</Text><Link href="mailto:info@astforum.ru">info@astforum.ru</Link>{!account && <Text as="p" className="muted">В этом макете используются только вымышленные данные.</Text>}</Stack></Dialog>}
  </div>
}
