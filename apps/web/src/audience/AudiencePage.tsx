import {Button, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {BriefcaseIcon, PackageIcon, PencilIcon, ToolsIcon} from '@primer/octicons-react'
import content from './audience-content.json'
import {ActionButton, Faq, FinalAction, InfoCards, PageHero, Section, Steps} from './PageSections'
import {isSupplierDirection, readIntent} from './intent'
import type {SupplierDirection} from './intent'
import {DemoSection, RulesSection} from './StandardSections'

export type Intent = {audience: 'customer'|'supplier'|'individual'; action: 'create-order'|'find-orders'|'find-jobs'|'find-work'; direction?: SupplierDirection|'orders'|'jobs'; returnTo: '/customers/'|'/suppliers/'|'/work/'}
const supplierIcons = {goods: PackageIcon, design: PencilIcon, construction: ToolsIcon, leasing: BriefcaseIcon, services: BriefcaseIcon}
type Props = {kind: 'customers'|'suppliers'; onAction: (intent: Intent, trigger: HTMLButtonElement | null) => void; onDemo: (trigger: HTMLButtonElement, audience: string) => void}
export function AudiencePage({kind, onAction, onDemo}: Props) {
  const c = content[kind]
  const isCustomer = kind === 'customers'
  const intent: Intent = {audience: isCustomer ? 'customer' : 'supplier', action: isCustomer ? 'create-order' : 'find-orders', returnTo: `/${kind}/`}
  const act = (direction?: Intent['direction']) => {
    const previous = readIntent()
    const selected = direction ?? (previous?.audience === 'supplier' && !isCustomer ? previous.direction : undefined)
    onAction({...intent, ...(selected ? {direction: selected} : {})}, document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  }
  const audience = isCustomer ? 'Заказчик' : 'Компания-исполнитель'
  return <main id="main" tabIndex={-1}>
    <PageHero eyebrow={c.eyebrow} title={isCustomer ? <>Находите поставщиков и подрядчиков <br className="desktop-title-break" />для ваших строительных объектов</> : c.title} description={c.description} image={isCustomer ? 'audience-customer.png' : 'audience-supplier.png'}>
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label={c.action} onClick={() => act()} /><Button as="a" href="#how" size="large">{c.secondary}</Button></Stack>
      {c.note && <Text as="p" size="small" className="muted">{c.note}</Text>}
    </PageHero>
    <Section id="needs" title={isCustomer ? 'Что нужно вашему объекту?' : 'Какие заказы вы ищете?'}>
      {isCustomer ? <InfoCards items={content.customers.needs} /> : <div className="two-columns">{content.suppliers.needs.map(item => {
        const direction = item.direction
        if (!isSupplierDirection(direction)) throw new Error(`Unknown supplier direction: ${direction}`)
        return <Card key={direction} className="audience-card"><Stack gap="spacious" className="audience-content">
          <Card.Icon icon={supplierIcons[direction]} /><Stack.Item grow><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{item.description}</Card.Description></Stack.Item>
          <Button onClick={() => act(direction)}>{item.action}</Button>
        </Stack></Card>
      })}</div>}
    </Section>
    {isCustomer && <Section id="estimate" title="Начните со сметы или конкретной потребности"><Card><Text as="p" size="large" className="muted">{content.customers.estimate}</Text></Card></Section>}
    <Section id="how" title={isCustomer ? 'Как проходит закупка' : 'Как получить заказ'}><Steps items={c.steps} /></Section>
    <Section id="comparison" title={isCustomer ? 'Принимайте решение на ваших условиях' : 'Покажите, почему ваша компания подходит'}><InfoCards items={c.comparison} /></Section>
    <DemoSection onDemo={trigger => onDemo(trigger, audience)} />
    <RulesSection />
    <Faq title={isCustomer ? 'Часто задаваемые вопросы' : 'Вопросы поставщиков и подрядчиков'} items={c.faq} />
    <FinalAction title={c.final[0]} description={c.final[1]} label={c.final[2]} onAction={() => act()} />
  </main>
}
