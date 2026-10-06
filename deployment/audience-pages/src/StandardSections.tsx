import {Button, Heading, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {ArrowRightIcon, CheckCircleIcon, ShieldCheckIcon, TasklistIcon} from '@primer/octicons-react'
import {demo, rules} from './content'

const ruleIcons = [ShieldCheckIcon, TasklistIcon, CheckCircleIcon]

export function RulesSection() {
  return <section className="section container" id="rules" aria-labelledby="rules-title" data-section="rules">
    <Heading as="h2" variant="large" id="rules-title" className="section-title">Понятные правила работы</Heading>
    <div className="three-columns">{rules.map((rule, index) => <Card key={rule.title} layout="compact">
      <Card.Icon icon={ruleIcons[index]} />
      <Card.Heading as="h3">{rule.title}</Card.Heading>
      <Card.Description>{rule.description}</Card.Description>
    </Card>)}</div>
  </section>
}

export function DemoSection({onDemo}: {onDemo: (trigger: HTMLButtonElement) => void}) {
  return <section className="section container demo-section" id="demo" aria-labelledby="demo-title" data-section="demo">
    <Card className="demo-card">
      <Stack direction={{narrow: 'vertical', regular: 'horizontal'}} align={{narrow: 'start', regular: 'center'}} gap="spacious" justify="space-between">
        <Stack gap="normal" className="demo-copy">
          <Heading as="h2" variant="large" id="demo-title">{demo.title}</Heading>
          <Text as="p" size="large" className="muted">{demo.description}<br />{demo.followUp}</Text>
        </Stack>
        <Button onClick={event => onDemo(event.currentTarget)} variant="primary" size="large" trailingVisual={ArrowRightIcon}>Выбрать время</Button>
      </Stack>
    </Card>
  </section>
}
