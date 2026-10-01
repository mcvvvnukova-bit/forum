import {Button, Heading, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import {BriefcaseIcon, PackageIcon} from '@primer/octicons-react'
import content from './audience-content.json'
import {ActionButton, Faq, InfoCards, PageHero, Section, Steps} from './PageSections'
import {readIntent} from './intent'

export type Intent = {audience: 'customer'|'supplier'|'individual'; action: 'create-order'|'find-orders'; direction?: 'goods'|'services'|'orders'|'jobs'; returnTo: '/customers/'|'/suppliers/'|'/work/'}
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
    <PageHero eyebrow={c.eyebrow} title={c.title} description={c.description} image={isCustomer ? 'audience-customer.png' : 'audience-supplier.png'}>
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label={c.action} onClick={() => act()} /><Button as="a" href="#how" size="large">{c.secondary}</Button></Stack>
      {c.note && <Text as="p" size="small" className="muted">{c.note}</Text>}
    </PageHero>
    <Section id="needs" title={isCustomer ? 'Что нужно вашему объекту?' : 'Какие заказы вы ищете?'}>
      {isCustomer ? <InfoCards items={content.customers.needs} /> : <>
        <div className="two-columns">{content.suppliers.needs.map((item,index) => <Card key={item.title}><Stack gap="spacious" className="audience-content">
          <Card.Icon icon={index === 0 ? PackageIcon : BriefcaseIcon} /><Stack.Item grow><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{item.description}</Card.Description></Stack.Item>
          <Button onClick={() => act(index === 0 ? 'goods' : 'services')}>{item.action}</Button>
        </Stack></Card>)}</div><Text as="p" className="muted section-note">Компания может указать несколько направлений деятельности. Доступные заказы зависят от категорий, географии, сроков и требований к участнику.</Text>
      </>}
    </Section>
    {isCustomer && <Section id="estimate" title="Начните со сметы или конкретной потребности"><Card><Text as="p" size="large" className="muted">{content.customers.estimate}</Text></Card></Section>}
    <Section id="how" title={isCustomer ? 'Как проходит закупка' : 'Как получить заказ'}><Steps items={c.steps} /></Section>
    <Section id="comparison" title={isCustomer ? 'Принимайте решение на ваших условиях' : 'Покажите, почему ваша компания подходит'}><InfoCards items={c.comparison} /></Section>
    <Section id="rules" title="Понятные правила работы"><InfoCards items={content.rules} /></Section>
    <Faq title={isCustomer ? 'Часто задаваемые вопросы' : 'Вопросы поставщиков и подрядчиков'} items={c.faq} />
    <section className="section container" aria-labelledby="final-title"><Card><Stack gap="spacious"><Heading as="h2" variant="large" id="final-title">{c.final[0]}</Heading><Text as="p" size="large" className="muted">{c.final[1]}</Text>
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label={c.final[2]} onClick={() => act()} /><Button size="large" onClick={e => onDemo(e.currentTarget, audience)}>Записаться на демо</Button></Stack>
    </Stack></Card></section>
  </main>
}
