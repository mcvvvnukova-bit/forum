import {useRef, useState} from 'react'
import type {ElementType, MouseEvent} from 'react'
import {Banner, Button, Details, Dialog, FormControl, Heading, IconButton, Link, Radio, RadioGroup, Text} from '@primer/react'
import {ArrowRightIcon, CheckCircleIcon, ChecklistIcon, ChevronDownIcon, FileIcon, OrganizationIcon, PackageIcon, ThreeBarsIcon, ToolsIcon} from '@primer/octicons-react'
import brandLogo from '../landing/assets/brand-logo-horizontal-color.png'
import customerIllustration from '../landing/assets/audience-customer.png'
import {authErrorMessages, useLandingSession} from '../landing/use-landing-session'
import {openDemoBooking} from '../landing/cal-diy-embed'
import {DemoSection} from '../shared/DemoSection'
import {preserveCustomerIntent, rememberCustomerAuth} from './customer-intent'
import {comparisons, customerDemoNotes, customerDemoUrl, customerNav, needs, questions, rules, steps} from './customer-content'

type Destinations = {registration?: string; newOrder?: string}
type DialogKind = 'register' | 'participant' | 'order' | 'login' | 'menu' | 'contacts' | 'agreement' | 'privacy' | 'cabinet'
function destinationUrl(path: string | undefined, extras: Record<string, string> = {}) {
  if (!path?.startsWith('/') || path.startsWith('//')) return undefined
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries({...extras, audience: 'customer', next: 'create-order', returnTo: '/customers/'})) url.searchParams.set(key, value)
  return `${url.pathname}${url.search}${url.hash}`
}

function onCustomerDemoClick(event: MouseEvent<HTMLElement>) {
  preserveCustomerIntent()
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  event.preventDefault()
  void openDemoBooking({notes: customerDemoNotes, audience: 'Заказчик'}).catch(() => window.location.assign(customerDemoUrl))
}

function DemoLink() {
  return <Button as="a" href={customerDemoUrl} onClick={onCustomerDemoClick} className="customer-button">Записаться на демо</Button>
}

function SectionHeading({id, number, eyebrow, children}: {id: string; number: string; eyebrow: string; children: string}) {
  return <div className="customer-section-heading">
    <Text as="p" className="customer-eyebrow">{number} / {eyebrow}</Text>
    <Heading as="h2" id={id} className="customer-heading">{children}</Heading>
  </div>
}

function ContentCard({title, text, icon: Icon}: {title: string; text: string; icon: ElementType}) {
  return <article className="customer-card">
    <span className="customer-card-icon"><Icon size={24} aria-hidden="true" /></span>
    <Heading as="h3" className="customer-card-title">{title}</Heading>
    <Text as="p" className="customer-body">{text}</Text>
  </article>
}

export function CustomerLanding({destinations = {}}: {destinations?: Destinations}) {
  const {session, isLoading} = useLandingSession()
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [subject, setSubject] = useState('legal')
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const participant = session?.participant
  const isCustomer = typeof participant?.id === 'string' && participant.id.length > 0 && participant.role === 'customer' && participant.status === 'active'
  const registrationUrl = destinationUrl(destinations.registration, {intent: 'register', subject})
  const orderUrl = isCustomer ? destinationUrl(destinations.newOrder, {participant: participant.id}) : undefined
  const authError = new URLSearchParams(window.location.search).get('auth_error')

  function open(kind: DialogKind, event?: MouseEvent<HTMLElement>) {
    if (event) dialogTrigger.current = event.currentTarget
    preserveCustomerIntent()
    setDialog(kind)
  }

  function renderOrderAction() {
    if (orderUrl) return <Button as="a" href={orderUrl} onClick={preserveCustomerIntent} variant="primary" className="customer-button" trailingVisual={ArrowRightIcon}>Разместить заказ</Button>
    return <Button variant="primary" className="customer-button" trailingVisual={ArrowRightIcon} disabled={isLoading} onClick={(event) => open(!session ? 'register' : isCustomer ? 'order' : 'participant', event)}>Разместить заказ</Button>
  }

  const titles: Record<DialogKind, string> = {
    register: 'Регистрация компании-заказчика', participant: 'Выберите участника-заказчика', order: 'Создание заказа', login: 'Войти в аккаунт', menu: 'Навигация', contacts: 'Контакты', agreement: 'Пользовательское соглашение', privacy: 'Политика конфиденциальности', cabinet: 'Личный кабинет',
  }

  return <div className="landing-page customer-page">
    <Link href="#customer-main" className="customer-skip-link">Перейти к содержанию</Link>
    <header className="landing-header customer-header">
      <div className="landing-container landing-header__inner">
        <Link href="/" className="landing-header__brand" aria-label="АСТ Форум — главная">
          <img src={brandLogo} className="landing-header__logo" alt="АСТ Форум" width="1600" height="600" />
        </Link>
        <nav className="customer-desktop-nav" aria-label="Основная навигация">
          {customerNav.map(item => <Link key={item.label} href={item.href} aria-current={item.href === '/customers/' ? 'page' : undefined} className="customer-nav-link">{item.label}</Link>)}
        </nav>
        <div className="customer-header-actions">
          <Button variant="invisible" className="customer-login" onClick={event => open(session ? 'cabinet' : 'login', event)}>{session ? 'В кабинет' : 'Войти'}</Button>
          <IconButton icon={ThreeBarsIcon} aria-label="Открыть меню" variant="invisible" className="customer-menu-button" onClick={event => open('menu', event)} />
        </div>
      </div>
    </header>

    <main id="customer-main" tabIndex={-1}>
      {authError && <div className="landing-container customer-auth-error"><Banner variant="warning" title={authErrorMessages[authError] ?? 'Не удалось завершить вход. Вы можете повторить попытку.'} description="Выбранное направление — разместить заказ — сохранено." /></div>}
      <section className="customer-hero" aria-labelledby="customer-hero-title">
        <div className="landing-container customer-hero-inner">
          <div className="customer-hero-copy">
            <Text as="p" className="customer-eyebrow">Для компаний-заказчиков</Text>
            <Heading as="h1" id="customer-hero-title" className="customer-hero-title">Находите поставщиков и подрядчиков для ваших строительных объектов</Heading>
            <Text as="p" className="customer-lead">Размещайте потребности в материалах, работах и услугах. Получайте предложения от подходящих исполнителей, сравнивайте цену, сроки и условия — и выбирайте, с кем работать.</Text>
            <div className="customer-actions">{renderOrderAction()}<Button as="a" href="#procurement" className="customer-button">Посмотреть, как это работает</Button></div>
            <Text as="p" className="customer-caption">Для размещения понадобится зарегистрировать компанию.</Text>
          </div>
          <div className="customer-hero-art">
            <img src={customerIllustration} alt="Заказчик со строительной сметой на фоне объекта" width="900" height="900" />
            <div className="customer-hero-note"><ChecklistIcon size={20} aria-hidden="true" /><Text>От потребности объекта<br />до выбора исполнителя</Text></div>
          </div>
        </div>
      </section>

      <section className="landing-container customer-section" aria-labelledby="needs-title">
        <SectionHeading id="needs-title" number="01" eyebrow="Задачи объекта">Что нужно вашему объекту?</SectionHeading>
        <div className="customer-card-grid">{needs.map((item, i) => <ContentCard key={item.title} {...item} icon={[PackageIcon, ToolsIcon, OrganizationIcon][i]} />)}</div>
      </section>

      <section className="customer-estimate-section" aria-labelledby="estimate-title">
        <div className="landing-container customer-estimate-inner">
          <div>
            <SectionHeading id="estimate-title" number="02" eyebrow="Удобная точка старта">Начните со сметы или конкретной потребности</SectionHeading>
            <Text as="p" className="customer-lead">Загрузите смету в Excel или внесите позиции заказа вручную. Сформируйте из них лоты — отдельные пакеты материалов, работ или услуг, на которые исполнители смогут подать предложения.</Text>
          </div>
          <figure className="customer-estimate-example">
            <figcaption className="customer-example-caption">Пример структуры заказа</figcaption>
            <div className="customer-estimate-file"><FileIcon size={24} aria-hidden="true" /><div><Text as="strong">Смета строительного объекта</Text><Text as="p" className="customer-caption">Excel или позиции, внесённые вручную</Text></div></div>
            <div className="customer-lot-list">{['Материалы и оборудование', 'Строительные и монтажные работы', 'Услуги для строительного проекта'].map((label, i) => <div className="customer-lot" key={label}><Text className="customer-lot-number">0{i + 1}</Text><Text>{label}</Text></div>)}</div>
            <Text as="p" className="customer-caption">Лоты формируете вы. Это иллюстрация, а не опубликованный заказ.</Text>
          </figure>
        </div>
      </section>

      <section id="procurement" className="landing-container customer-section customer-process" aria-labelledby="process-title">
        <div className="customer-process-intro"><SectionHeading id="process-title" number="03" eyebrow="Пять шагов">Как проходит закупка</SectionHeading><Text as="p" className="customer-body">Подготовьте потребность.<br />Сравните условия.<br />Выберите, с кем работать.</Text></div>
        <ol className="customer-steps">{steps.map((item, i) => <li className="customer-step" key={item.title}><Text className="customer-step-number" aria-hidden="true">0{i + 1}</Text><div><Heading as="h3" className="customer-card-title">{item.title}</Heading><Text as="p" className="customer-body">{item.text}</Text></div></li>)}</ol>
      </section>

      <section className="customer-comparison-section" aria-labelledby="comparison-title">
        <div className="landing-container customer-section">
          <SectionHeading id="comparison-title" number="04" eyebrow="Выбор за вами">Принимайте решение на основе условий</SectionHeading>
          <div className="customer-card-grid">{comparisons.map(item => <ContentCard key={item.title} {...item} icon={CheckCircleIcon} />)}</div>
        </div>
      </section>

      <section className="landing-container customer-section" aria-labelledby="rules-title">
        <SectionHeading id="rules-title" number="05" eyebrow="Условия участия">Понятные правила работы</SectionHeading>
        <div className="customer-rules">{rules.map((item, i) => <article className="customer-rule" key={item.title}><Text className="customer-rule-number">0{i + 1}</Text><Heading as="h3" className="customer-card-title">{item.title}</Heading><Text as="p" className="customer-body">{item.text}</Text></article>)}</div>
      </section>

      <section className="landing-container customer-section customer-faq" aria-labelledby="faq-title">
        <SectionHeading id="faq-title" number="06" eyebrow="До начала работы">Вопросы заказчиков</SectionHeading>
        <div className="customer-faq-list">{questions.map(item => <Details className="customer-faq-item" key={item.question}><Details.Summary className="customer-faq-summary"><Text>{item.question}</Text><ChevronDownIcon size={20} className="customer-faq-icon" aria-hidden="true" /></Details.Summary><Text as="p" className="customer-faq-answer">{item.answer}</Text></Details>)}</div>
      </section>

      <section className="customer-final" aria-labelledby="final-title">
        <div className="landing-container customer-final-inner">
          <Text as="p" className="customer-eyebrow">От потребности — к предложениям</Text>
          <Heading as="h2" id="final-title" className="customer-heading">Найдите исполнителей под задачи вашего объекта</Heading>
          <Text as="p" className="customer-lead">Начните с конкретной потребности: материалы, работы или услуги. Подготовьте заказ и получите предложения для сравнения.</Text>
          {renderOrderAction()}
        </div>
      </section>
      <DemoSection bookingUrl={customerDemoUrl} onBookingClick={onCustomerDemoClick} />
    </main>

    <footer className="customer-footer">
      <div className="landing-container customer-footer-inner">
        <div className="customer-footer-brand"><Link href="/" aria-label="АСТ Форум — главная"><img src={brandLogo} width="1600" height="600" alt="АСТ Форум" className="landing-footer__logo" /></Link><Text as="p" className="customer-caption">АСТ Форум — заказы, исполнители<br />и работа в строительстве</Text></div>
        <nav aria-label="Аудитории" className="customer-footer-nav">{customerNav.slice(0, 3).map(item => <Link className="customer-footer-link" key={item.label} href={item.href}>{item.label}</Link>)}</nav>
        <nav aria-label="Служебные разделы" className="customer-footer-nav">{([{kind: 'contacts', label: 'Контакты'}, {kind: 'agreement', label: 'Пользовательское соглашение'}, {kind: 'privacy', label: 'Политика конфиденциальности'}] as const).map(item => <Button variant="invisible" key={item.kind} className="customer-service-link" onClick={event => open(item.kind, event)}>{item.label}</Button>)}</nav>
      </div>
    </footer>

    {dialog && <Dialog title={titles[dialog]} width="large" onClose={() => setDialog(null)} returnFocusRef={dialogTrigger}>
      <div className="customer-dialog-content">
        {dialog === 'menu' ? <nav aria-label="Мобильная навигация" className="customer-mobile-nav">{customerNav.map(item => <Link key={item.label} href={item.href} onClick={() => setDialog(null)}>{item.label}</Link>)}</nav> : null}
        {dialog === 'register' ? <>
          <Text as="p">Подтвердите компанию через Контур.Диадок, подтвердите электронную почту и заполните профиль заказчика. После этого можно будет подготовить заказ.</Text>
          <RadioGroup name="company-type" onChange={value => value && setSubject(value)}><RadioGroup.Label>Тип компании</RadioGroup.Label>{[{id: 'legal', label: 'Юридическое лицо'}, {id: 'entrepreneur', label: 'Индивидуальный предприниматель'}].map(item => <FormControl key={item.id}><Radio value={item.id} checked={subject === item.id} /><FormControl.Label>{item.label}</FormControl.Label></FormControl>)}</RadioGroup>
          {registrationUrl ? <Button as="a" href={registrationUrl} variant="primary" onClick={rememberCustomerAuth}>Продолжить через Контур.Диадок</Button> : <><Banner variant="info" title="Регистрация компаний пока недоступна. Вы можете сначала познакомиться с платформой на демо." /><DemoLink /></>}
        </> : null}
        {dialog === 'participant' ? <><Text as="p">{participant?.role === 'provider' ? 'Текущий участник работает как исполнитель.' : 'Для текущего участника не подтверждён контекст заказчика.'} Для размещения заказа выберите участника-заказчика в кабинете или зарегистрируйте компанию-заказчика. Ваши текущие права не изменятся.</Text><Button variant="primary" onClick={() => setDialog('register')}>Зарегистрировать компанию-заказчика</Button><Button onClick={() => setDialog('cabinet')}>Выбрать участника в кабинете</Button></> : null}
        {dialog === 'order' ? <><Banner variant="info" title="Создание заказов пока недоступно. Выбранное направление сохранено." /><DemoLink /></> : null}
        {dialog === 'login' ? <><Text as="p">Выберите способ входа в существующий аккаунт. Вход не меняет роль участника.</Text><Banner variant="info" title="Вход компаний через Контур.Диадок пока недоступен." /><Button as="a" href="/auth/sber-id/start?intent=login" onClick={rememberCustomerAuth}>Войти по Сбер ID</Button><Text as="p" className="customer-caption">Сбер ID используется для входа физических лиц. Для размещения заказа нужен участник-компания в роли заказчика.</Text></> : null}
        {dialog === 'cabinet' ? <><Text as="p">{session ? `Вы вошли как ${session.user.displayName}. ` : ''}Личный кабинет с выбором участников пока недоступен. Выбранное направление сохранено.</Text><DemoLink /></> : null}
        {dialog === 'contacts' ? <><Text as="p">Контактные данные оператора пока не опубликованы. Вы можете выбрать время демонстрации и обсудить ваши задачи с командой АСТ Форум.</Text><DemoLink /></> : null}
        {(dialog === 'agreement' || dialog === 'privacy') ? <Text as="p">Документ пока не опубликован. Он будет доступен до начала регистрации.</Text> : null}
      </div>
    </Dialog>}
  </div>
}
