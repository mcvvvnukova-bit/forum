import {useState} from 'react'
import {Button, Stack} from '@primer/react'
import {Card} from '@primer/react/experimental'
import content from './audience-content.json'
import type {Intent} from './AudiencePage'
import {ActionButton, Faq, FinalAction, PageHero, Section, Steps} from './PageSections'
import {WorkExamples} from './WorkExamples'

export function WorkPage({onAction}: {onAction: (intent: Intent, trigger: HTMLButtonElement | null) => void}) {
  const [format, setFormat] = useState<'orders'|'jobs'|null>(() => {
    try {const saved = sessionStorage.getItem('forum.work.format'); return saved === 'orders' || saved === 'jobs' ? saved : null} catch {return null}
  })
  const start = (choice: 'orders'|'jobs'|null) => onAction({audience:'individual', action:choice === 'jobs' ? 'find-jobs' : choice === 'orders' ? 'find-orders' : 'find-work', ...(choice ? {direction:choice} : {}),returnTo:'/work/'},document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  const choose = (choice: 'orders'|'jobs') => {
    setFormat(choice)
    try {sessionStorage.setItem('forum.work.format', choice)} catch { /* Keep the current choice available without storage. */ }
    start(choice)
  }
  const act = () => start(format)
  return <main id="main" tabIndex={-1}>
    <PageHero eyebrow={content.work.hero[0]} title={content.work.hero[1]} description={content.work.hero[2]} image="audience-specialist-left-mirrored.png">
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label="Найти работу" onClick={act} /><Button as="a" size="large" href="#formats">Выбрать формат работы</Button></Stack>
    </PageHero>
    <Section id="formats" title="Какую работу вы ищете?"><div className="two-columns">{content.work.formats.map((item,index) => <Card key={item.title} className="audience-card">
      <Stack gap="spacious" className="audience-content"><Stack.Item grow><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{item.description}</Card.Description></Stack.Item>
        <Button onClick={() => choose(index === 0 ? 'orders' : 'jobs')}>{item.action}</Button>
      </Stack></Card>)}</div>
    </Section>
    <WorkExamples />
    <Section id="how" title="Как это работает"><Steps items={content.work.steps} /></Section>
    <Faq title="Вопросы о работе и подработке" items={content.work.faq} />
    <FinalAction title={format === 'orders' ? 'Используйте свои навыки в новых заказах' : format === 'jobs' ? 'Найдите работу в штате' : 'Выберите следующий шаг'} description="Укажите, какие работы выполняете и где готовы работать. Находите подходящие задачи." label="Найти работу" onAction={act} />
  </main>
}
