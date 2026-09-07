import type {CSSProperties, ElementType, HTMLAttributes, MouseEvent, MouseEventHandler} from 'react'
import {Button, Heading, Link, Text} from '@primer/react'
import {ChevronDownIcon} from '@primer/octicons-react'
import brandLogo from './assets/brand-logo-horizontal-color.png'
import heroIllustration from './assets/hero-illustration-process-interface-v1.png'
import audienceCustomer from './assets/audience-customer.png'
import audienceSupplier from './assets/audience-supplier.png'
import audienceContractor from './assets/audience-contractor.png'
import audienceSpecialist from './assets/audience-specialist-left-mirrored.png'
import vortexIllustration from './assets/vortex-selected-concept-01.png'
import logoRentaero from './assets/logo-rentaero-gray.png'
import logoTahoban from './assets/logo-gray-tahoban.png'
import logoSferaSnab from './assets/logo-gray-sfera-snab.png'
import logoSpectransservice from './assets/logo-gray-spectransservice.png'
import logoToolTech from './assets/logo-tool-tech-gray.png'
import logoProfmaster from './assets/logo-gray-profmaster.png'
import logoPolygroup from './assets/logo-polycorr-gray.png'
import logoZelenayaDoroga from './assets/logo-gray-zelenaya-doroga.png'
import logoGeoprom from './assets/logo-gray-geoprom.png'
import logoVseinstrumenti from './assets/logo-gray-vseinstrumenti.png'
import logoVostokService from './assets/logo-gray-vostok-service.png'
import logoBkResource from './assets/logo-gray-bk-resource.png'
import logoBinLeasing from './assets/logo-gray-bin-leasing.png'
import {BOOKING_URL, onDemoBookingClick} from './cal-diy-embed'

type AudienceCard = {
  className: string
  description: string[]
  image: string
  imageAlt: string
  mediaSide: 'left' | 'right'
  number: string
  title: string
}

type PartnerLogo = {
  className?: string
  height: string
  image: string
  name: string
  opacity: string
  width: string
}

type FaqItem = {
  answer: string
  defaultOpen?: boolean
  question: string
}

type BoxProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  open?: boolean
}

function Box({as: Component = 'div', ...props}: BoxProps) {
  return <Component {...props} />
}

const navItems = [
  {href: '#audience', label: 'Для кого'},
  {href: '#process', label: 'Как работает'},
  {href: '#demo', label: 'Демо'},
  {href: '#cases', label: 'Кейсы'},
  {href: '#faq', label: 'FAQ'},
]

const audienceCards: AudienceCard[] = [
  {
    className: 'audience-card--customer',
    description: ['Публикуйте целые сметы', 'или отдельные заказы'],
    image: audienceCustomer,
    imageAlt: 'Заказчик со строительной сметой',
    mediaSide: 'right',
    number: '01',
    title: 'Заказчик',
  },
  {
    className: 'audience-card--supplier',
    description: ['Находите релевантные', 'потребности заказчиков,', 'планируйте поставки'],
    image: audienceSupplier,
    imageAlt: 'Поставщик с погрузчиком',
    mediaSide: 'left',
    number: '02',
    title: 'Поставщик',
  },
  {
    className: 'audience-card--contractor',
    description: ['Находите заказы,', 'по вашему профилю'],
    image: audienceContractor,
    imageAlt: 'Исполнитель со строительным инструментом',
    mediaSide: 'right',
    number: '03',
    title: 'Исполнитель',
  },
  {
    className: 'audience-card--specialist',
    description: ['Работайте по ГПХ,', 'как самозанятый или в штате'],
    image: audienceSpecialist,
    imageAlt: 'Частный специалист у оконного проема',
    mediaSide: 'left',
    number: '04',
    title: 'Частный специалист',
  },
]

const metrics = [
  {label: 'открытых заказов', value: '28'},
  {label: 'сумма сделок, заключенных на площадке', value: '679 млн'},
  {label: 'проверенных исполнителей', value: '130'},
]

const partnerLogos: PartnerLogo[] = [
  {height: '56px', image: logoRentaero, name: 'Rentaero', opacity: '0.9', width: '149.333px'},
  {height: '42.279px', image: logoTahoban, name: 'Тахобан', opacity: '0.9', width: '179.2px'},
  {height: '40.674px', image: logoSferaSnab, name: 'Сфера-Снаб', opacity: '0.9', width: '179.2px'},
  {height: '56px', image: logoSpectransservice, name: 'Спецтранссервис', opacity: '0.72', width: '162.791px'},
  {height: '74px', image: logoToolTech, name: 'Tool Tech', opacity: '0.9', width: '145px'},
  {height: '32px', image: logoProfmaster, name: 'ПрофМастер', opacity: '0.9', width: '173px'},
  {height: '56px', image: logoPolygroup, name: 'Поли-групп', opacity: '0.9', width: '105px'},
  {height: '68px', image: logoZelenayaDoroga, name: 'Зелёная дорога', opacity: '0.82', width: '68px'},
  {height: '72px', image: logoGeoprom, name: 'Геопром', opacity: '0.88', width: '145.6px'},
  {height: '50.056px', image: logoVseinstrumenti, name: 'ВсеИнструменты.ру', opacity: '0.9', width: '179.2px'},
  {
    className: 'partner-logo-card--row-three-start',
    height: '31.015px',
    image: logoVostokService,
    name: 'Восток-Сервис',
    opacity: '0.9',
    width: '179.2px',
  },
  {height: '56px', image: logoBkResource, name: 'БК-Ресурс', opacity: '0.72', width: '111.067px'},
  {height: '48.556px', image: logoBinLeasing, name: 'БИН Лизинг', opacity: '0.72', width: '179.2px'},
]

const faqItems: FaqItem[] = [
  {
    answer:
      'Зарегистрироваться могут юридические лица, ИП, их представители и физические лица, которые хотят выполнять заказы напрямую.',
    defaultOpen: true,
    question: 'Кто может зарегистрироваться?',
  },
  {
    answer: 'Нет, каталог заказов и данные участников доступны после регистрации.',
    question: 'Можно ли посмотреть заказы и участников без регистрации?',
  },
  {
    answer: 'Вы выбираете удобное время, а мы отправляем ссылку на встречу в Телемосте.',
    question: 'Как проходит демо?',
  },
  {
    answer:
      'Стороны ведут ключевые этапы, договорённости и завершение проекта в системе. Все документы могут быть подписаны на платформе через ЭЦП.',
    question: 'Как проходит сопровождение сделки?',
  },
]

function BrandLogo({className}: {className?: string}) {
  return <img className={className ?? 'brand-logo'} src={brandLogo} alt="Форум" width="1600" height="600" />
}

function PrimaryLinkButton({
  children,
  className,
  href,
  onClick,
}: {
  children: string
  className: string
  href: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <Button
      as="a"
      href={href}
      onClick={(event) => onClick?.(event as unknown as MouseEvent<HTMLAnchorElement>)}
      variant="primary"
      className={`landing-button ${className}`}
    >
      {children}
    </Button>
  )
}

function SecondaryLinkButton({children, className, href}: {children: string; className: string; href: string}) {
  return (
    <Button as="a" href={href} className={`landing-button landing-button--secondary ${className}`}>
      {children}
    </Button>
  )
}

function AudienceCard({card}: {card: AudienceCard}) {
  const mediaClass = card.mediaSide === 'left' ? 'audience-card--media-left' : 'audience-card--media-right'

  return (
    <Box as="article" className={`audience-card ${mediaClass} ${card.className}`}>
      <Box className="audience-card__panel">
        <Text as="span" className="audience-card__number">
          {card.number}
        </Text>
        <Heading as="h3" className="audience-card__title">
          {card.title}
        </Heading>
        <Text as="p" className="audience-card__description">
          {card.description.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </Text>
      </Box>
      <img className="audience-card__image" src={card.image} alt={card.imageAlt} loading="lazy" />
    </Box>
  )
}

function Metrics() {
  return (
    <Box as="section" className="landing-stats" aria-label="Показатели площадки">
      <Box className="landing-stats__row">
        <Metric metric={metrics[0]} />
        <span className="landing-stats__divider" aria-hidden="true" />
        <Metric metric={metrics[1]} />
        <span className="landing-stats__divider" aria-hidden="true" />
        <Metric metric={metrics[2]} />
      </Box>
    </Box>
  )
}

function Metric({metric}: {metric: (typeof metrics)[number]}) {
  return (
    <Box className="landing-metric">
      <Text as="strong" className="landing-metric__value">
        {metric.value}
      </Text>
      <Text as="span" className="landing-metric__label">
        {metric.label}
      </Text>
    </Box>
  )
}

function Partners() {
  return (
    <Box as="section" id="cases" className="landing-trust" aria-labelledby="trust-title">
      <Box className="landing-container landing-trust__inner">
        <Heading id="trust-title" as="h2" className="landing-small-title">
          Нам доверяют
        </Heading>
        <Box className="partner-logos" aria-label="Логотипы партнеров">
          {partnerLogos.map((logo) => (
            <Box key={logo.name} className={`partner-logo-card ${logo.className ?? ''}`}>
              <img
                className="partner-logo-card__image"
                src={logo.image}
                alt={`Логотип ${logo.name}`}
                loading="lazy"
                style={
                  {
                    '--partner-logo-height': logo.height,
                    '--partner-logo-opacity': logo.opacity,
                    '--partner-logo-width': logo.width,
                  } as CSSProperties
                }
              />
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function Faq() {
  return (
    <Box as="section" id="faq" className="landing-faq" aria-labelledby="faq-title">
      <Box className="landing-faq__inner">
        <Heading id="faq-title" as="h2" className="landing-small-title">
          Частые вопросы
        </Heading>
        <Box className="landing-faq__list">
          {faqItems.map((item) => (
            <Box as="details" className="faq-item" open={item.defaultOpen} key={item.question}>
              <summary className="faq-item__summary">
                <Text as="span" className="faq-item__question">
                  {item.question}
                </Text>
                <ChevronDownIcon className="faq-item__icon" size={16} aria-hidden="true" />
              </summary>
              <Text as="p" className="faq-item__answer">
                {item.answer}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export function LandingApp() {
  return (
    <Box className="landing-page">
      <Box as="header" className="landing-header">
        <Box className="landing-container landing-header__inner">
          <Link href="#top" className="landing-header__brand" aria-label="Форум">
            <BrandLogo className="landing-header__logo" />
          </Link>
          <Box as="nav" className="landing-header__nav" aria-label="Основная навигация">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="landing-nav-link">
                {item.label}
              </Link>
            ))}
          </Box>
          <Box className="landing-header__actions">
            <Link href="/login" className="landing-login-link">
              Войти
            </Link>
            <PrimaryLinkButton href="/register" className="landing-header__register">
              Регистрация
            </PrimaryLinkButton>
          </Box>
        </Box>
      </Box>

      <Box as="main" id="top">
        <Box as="section" id="process" className="landing-hero" aria-labelledby="hero-title">
          <Box className="landing-hero__copy">
            <Heading id="hero-title" as="h1" className="landing-hero__title">
              Форум
            </Heading>
            <Text as="p" className="landing-hero__subtitle">
              электронная строительная площадка
            </Text>
            <Box className="landing-hero__actions">
              <PrimaryLinkButton href="/register" className="landing-hero__start">
                Начать работу
              </PrimaryLinkButton>
              <SecondaryLinkButton href="#demo" className="landing-hero__demo">
                Записаться на демо
              </SecondaryLinkButton>
            </Box>
          </Box>
          <img
            className="landing-hero__art"
            src={heroIllustration}
            alt="Интерфейс строительной площадки Форум"
            width="1536"
            height="1024"
            fetchPriority="high"
          />
        </Box>

        <Box as="section" id="audience" className="landing-audience" aria-labelledby="audience-title">
          <Box className="landing-audience__inner">
            <Box className="landing-section-heading">
              <Text as="p" className="landing-eyebrow">
                для кого
              </Text>
              <Heading id="audience-title" as="h2" className="landing-section-title">
                Одна площадка для всех
                <br />
                участников стройки
              </Heading>
            </Box>
            <img
              className="audience-vortex"
              src={vortexIllustration}
              alt=""
              loading="lazy"
              width="1536"
              height="1024"
              aria-hidden="true"
            />
            {audienceCards.map((card) => (
              <AudienceCard key={card.number} card={card} />
            ))}
          </Box>
        </Box>

        <Metrics />

        <Box as="section" id="demo" className="landing-demo" aria-labelledby="demo-title">
          <Box className="landing-demo__card">
            <Box className="landing-demo__copy">
              <Text as="p" className="landing-eyebrow">
                демо по вашим задачам
              </Text>
              <Heading id="demo-title" as="h2" className="landing-demo__title">
                Посмотрите «Форум» в работе
              </Heading>
              <Text as="p" className="landing-demo__text">
                За час покажем сценарии, ответим на вопросы и подскажем,
                <br />
                как запустить работу на площадке в вашей команде.
              </Text>
            </Box>
            <PrimaryLinkButton href={BOOKING_URL} onClick={onDemoBookingClick} className="landing-demo__button">
              Выбрать время
            </PrimaryLinkButton>
          </Box>
        </Box>

        <Partners />
        <Faq />
      </Box>

      <Box as="footer" className="landing-footer">
        <Box className="landing-footer__inner">
          <Box className="landing-footer__brand">
            <BrandLogo className="landing-footer__logo" />
            <Text as="p" className="landing-footer__text">
              <span>Платформа “Форум” включена в реестр российского ПО</span>
              <span>Запись №00000 от 00.00.2999</span>
            </Text>
          </Box>
          <Box as="nav" className="landing-footer__links" aria-label="Навигация в подвале">
            <Link href="#process" className="landing-footer-link">
              О платформе
            </Link>
            <Link href="#audience" className="landing-footer-link">
              Для заказчиков
            </Link>
            <Link href="#audience" className="landing-footer-link">
              Для исполнителей
            </Link>
            <Link href="#demo" className="landing-footer-link">
              Контакты
            </Link>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
