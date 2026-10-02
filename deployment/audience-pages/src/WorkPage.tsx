import {useState} from 'react'
import {Button, Heading, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import content from './audience-content.json'
import type {Intent} from './AudiencePage'
import {ActionButton, Faq, FinalAction, PageHero, Section, Steps} from './PageSections'
import {WorkExample} from './WorkExample'

export function WorkPage({onAction}: {onAction: (intent: Intent, trigger: HTMLButtonElement | null) => void}) {
  const [format, setFormat] = useState<'orders'|'jobs'|null>(() => {
    try {const saved = sessionStorage.getItem('forum.work.format'); return saved === 'orders' || saved === 'jobs' ? saved : null} catch {return null}
  })
  const select = (value: 'orders'|'jobs') => {setFormat(value); try {sessionStorage.setItem('forum.work.format', value)} catch { /* Keep the current choice available without storage. */ }}
  const act = () => onAction({audience:'individual', action:format === 'jobs' ? 'find-jobs' : format === 'orders' ? 'find-orders' : 'find-work', ...(format ? {direction:format} : {}),returnTo:'/work/'},document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  return <main id="main" tabIndex={-1}>
    <PageHero eyebrow={content.work.hero[0]} title={content.work.hero[1]} description={content.work.hero[2]} image="audience-specialist-left-mirrored.png">
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label="Найти работу" onClick={act} /><Button as="a" size="large" href="#formats">Выбрать формат работы</Button></Stack>
    </PageHero>
    <Section id="formats" title="Какую работу вы ищете?"><div className="two-columns">{content.work.formats.map((item,index) => <Card key={item.title} className="audience-card">
      <Stack gap="spacious" className="audience-content"><Stack.Item grow><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{item.description}</Card.Description></Stack.Item>
        <Button aria-pressed={format === (index === 0 ? 'orders' : 'jobs')} onClick={() => select(index === 0 ? 'orders' : 'jobs')}>{item.action}</Button>
      </Stack></Card>)}</div>
    </Section>
    {format !== 'jobs' && <Section id="skills" title="Найдите применение вашим навыкам"><div className="two-columns example-layout" id="order-example">
      <Stack gap="normal"><Text as="p" size="large" className="muted">Отделка, монтаж, электрика, сантехника и другие строительные работы. Укажите, что умеете делать и где готовы работать.</Text>
        <Heading as="h3" variant="medium">Сначала условия — потом решение</Heading><Text as="p" size="large" className="muted">Посмотрите, что нужно сделать, какой объём выполнить, в каком районе и к какому сроку. Изучите требования и предложите свою стоимость работы.</Text></Stack>
      <WorkExample image="work-order-interface-v1.png" title="Укладка плитки в помещении" items={['Объём: 40 м²','Район работ: Москва, САО','Срок выполнения: в течение двух недель после согласования','Стоимость: предложите свою цену','Материалы: предоставляет заказчик']} />
    </div></Section>}
    {format !== 'orders' && <Section id="job-example" title="Официальное трудоустройство в штат"><div className="two-columns example-layout">
      <Text as="p" size="large" className="muted">Сравните обязанности, зарплату, график и место работы. Обратите внимание на требования к опыту и условия оформления.</Text>
      <WorkExample image="work-vacancy-interface-v1.png" title="Монтажник в строительную компанию" items={['Зарплата: 100 000–120 000 ₽ в месяц до вычета налогов','График: 5/2','Место работы: Москва','Опыт: от одного года','Оформление: в штат по трудовому договору']} />
    </div></Section>}
    <Section id="how" title="Как это работает"><Steps items={content.work.steps} /></Section>
    <Faq title="Вопросы о работе и подработке" items={content.work.faq} />
    <FinalAction title={format === 'orders' ? 'Используйте свои навыки в новых заказах' : format === 'jobs' ? 'Найдите работу в штате' : 'Выберите следующий шаг'} description="Укажите, какие работы выполняете и где готовы работать. Находите подходящие задачи." label="Найти работу" onAction={act} />
  </main>
}
