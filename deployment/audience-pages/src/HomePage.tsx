import {Button, Details, Heading, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {ArrowRightIcon, BriefcaseIcon, ChevronDownIcon, PackageIcon, PersonIcon} from '@primer/octicons-react'
import {audiences, faq, metrics, partners} from './content'
import {destinations} from './config'
import {DemoSection, RulesSection} from './StandardSections'

const audienceIcons = [PackageIcon, BriefcaseIcon, PersonIcon]

export function HomePage({onDemo}: {onDemo: (trigger: HTMLButtonElement) => void}) {
  return (
    <main id="main" tabIndex={-1}>
      <section className="hero" aria-labelledby="hero-title" data-section="hero">
        <div className="container hero-layout">
          <Stack gap="spacious" className="hero-content">
            <Heading as="h1" id="hero-title" className="hero-title">Заказы, исполнители и работа в строительстве</Heading>
            <Text as="p" size="large" className="hero-description muted">
              Размещайте заказы на материалы, работы и услуги.<br />
              Находите новые проекты для компании, подработку или работу в штате для себя.
            </Text>
            <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions">
              <Button as="a" href={destinations.login} variant="primary" size="large" trailingVisual={ArrowRightIcon}>Начать работу</Button>
              <Button size="large" onClick={event => onDemo(event.currentTarget)}>Записаться на демо</Button>
            </Stack>
          </Stack>
          <img src="/audience-assets/media/hero-illustration-process-interface.png" alt="Интерфейс строительной площадки Форум" width={1536} height={1024} className="hero-illustration" fetchPriority="high" decoding="async" />
        </div>
      </section>

      <section className="section container" aria-labelledby="audiences-title" id="audiences" data-section="audiences">
        <Heading as="h2" variant="large" id="audiences-title" className="section-title">С какой задачей вы пришли?</Heading>
        <div className="three-columns">
          {audiences.map((item, index) => (
            <Card key={item.key} className="audience-card">
              <Stack gap="normal" className="audience-content">
                <Card.Icon icon={audienceIcons[index]} />
                <Stack.Item grow>
                  <Stack gap="condensed">
                    <Card.Heading as="h3">{item.title}</Card.Heading>
                    <Text as="ol" size="medium" className="audience-steps muted">
                      {item.steps.map(step => <li key={step}>{step}</li>)}
                    </Text>
                  </Stack>
                </Stack.Item>
                <Button as="a" href={destinations[item.key]}>{item.action}</Button>
              </Stack>
            </Card>
          ))}
        </div>
      </section>

      <section className="metrics-section" aria-labelledby="metrics-title" data-section="metrics">
        <div className="container">
          <Heading as="h2" variant="large" id="metrics-title" className="section-title">Показатели площадки</Heading>
          <div className="three-columns">
            {metrics.map(metric => (
              <Stack key={metric.value} gap="condensed">
                <Text as="p" className="metric-value">{metric.value}</Text>
                <Text as="p" className="muted">{metric.label}</Text>
              </Stack>
            ))}
          </div>
        </div>
      </section>

      <RulesSection />
      <DemoSection onDemo={onDemo} />

      <section className="section container" id="partners" aria-labelledby="partners-title" data-section="partners">
        <Heading as="h2" variant="large" id="partners-title" className="section-title">Нам доверяют</Heading>
        <div className="partner-grid">
          {partners.map(partner => (
            <Card key={partner.name} layout="compact" padding="none" borderRadius="medium" className="partner-card">
              <Stack align="center" justify="center" gap="tight" className="partner-content">
                <img src={`/audience-assets/media/${partner.file}`} alt={partner.name} width={partner.width} height={partner.height} className="partner-logo" loading="lazy" />
                {partner.caption && <Text size="medium" weight="semibold" className="muted">{partner.caption}</Text>}
              </Stack>
            </Card>
          ))}
        </div>
      </section>

      <section className="section container faq-section" id="faq" aria-labelledby="faq-title" data-section="faq">
        <Heading as="h2" variant="large" id="faq-title" className="section-title">Ответы на частые вопросы</Heading>
        <Stack gap="normal">
          {faq.map((item, index) => (
            <Card key={item.question} padding="none">
              <Details open={index === 0} className="faq-item">
                <Details.Summary className="faq-summary">
                  <Stack direction="horizontal" align="center" justify="space-between" gap="normal">
                    <Text weight="semibold" size="large">{item.question}</Text>
                    <ChevronDownIcon className="faq-chevron" aria-hidden="true" />
                  </Stack>
                </Details.Summary>
                <Text as="p" className="faq-answer muted">{item.answer}</Text>
              </Details>
            </Card>
          ))}
        </Stack>
      </section>
    </main>
  )
}
