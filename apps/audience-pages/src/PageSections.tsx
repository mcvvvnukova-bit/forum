import {Button, Details, Heading, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {ArrowRightIcon, ChevronDownIcon} from '@primer/octicons-react'
import type {ReactNode} from 'react'

export type Item = {title: string; description: string}
export function Section({id, title, children}: {id: string; title: string; children: ReactNode}) {
  return <section className="section container" id={id} aria-labelledby={`${id}-title`}>
    <Heading as="h2" variant="large" id={`${id}-title`} className="section-title">{title}</Heading>{children}
  </section>
}
export function Steps({items}: {items: Item[]}) {
  return <Stack as="ol" gap="normal" className="procurement-steps">
    {items.map((item, index) => <Stack as="li" key={item.title} direction="horizontal" gap="spacious" align="start">
      <Text className="step-number" weight="semibold" aria-hidden="true">{String(index + 1).padStart(2, '0')}</Text>
      <Stack gap="condensed"><Heading as="h3" variant="small">{item.title.replace(/^\d+\. /, '')}</Heading><Text as="p" className="muted">{item.description}</Text></Stack>
    </Stack>)}
  </Stack>
}
export function InfoCards({items}: {items: Item[]}) {
  return <div className="three-columns">{items.map(item => <Card key={item.title}><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{item.description}</Card.Description></Card>)}</div>
}
export function Faq({title, items}: {title: string; items: {question: string; answer: string}[]}) {
  return <Section id="faq" title={title}><Stack gap="normal">{items.map((item, index) => <Card key={item.question} padding="none">
    <Details open={index === 0} className="faq-item"><Details.Summary className="faq-summary">
      <Stack direction="horizontal" gap="normal" justify="space-between" align="center"><Text weight="semibold" size="large">{item.question}</Text><ChevronDownIcon className="faq-chevron" aria-hidden="true" /></Stack>
    </Details.Summary><Text as="p" className="faq-answer muted">{item.answer}</Text></Details>
  </Card>)}</Stack></Section>
}
export function PageHero({eyebrow, title, description, image, children}: {eyebrow: string; title: ReactNode; description: string; image: string; children: ReactNode}) {
  return <section className="hero" aria-labelledby="hero-title"><div className="container hero-layout audience-hero">
    <Stack gap="spacious" className="hero-content"><Text size="medium" weight="semibold" className="muted">{eyebrow}</Text>
      <Heading as="h1" id="hero-title" className="hero-title">{title}</Heading><Text as="p" size="large" className="hero-description muted">{description}</Text>{children}
    </Stack><img src={`/audience-assets/media/${image}`} alt="" width="1024" height="1024" className="audience-illustration" fetchPriority="high" /></div></section>
}
export function ActionButton({label, onClick}: {label: string; onClick: () => void}) {
  return <Button size="large" variant="primary" trailingVisual={ArrowRightIcon} onClick={onClick}>{label}</Button>
}
export function FinalAction({title, description, label, onAction}: {title: string; description: string; label: string; onAction: () => void}) {
  return <section className="section container" aria-labelledby="final-title"><Card className="final-action-card">
    <Stack gap="spacious" direction={{narrow:'vertical',regular:'horizontal'}} align={{narrow:'start',regular:'center'}} justify="space-between">
      <Stack gap="normal" className="final-action-copy"><Heading as="h2" variant="large" id="final-title">{title}</Heading><Text as="p" size="large" className="muted">{description}</Text></Stack>
      <Stack className="final-action-buttons"><ActionButton label={label} onClick={onAction} /></Stack>
    </Stack>
  </Card></section>
}
