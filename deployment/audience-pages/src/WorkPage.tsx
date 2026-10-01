import {useState} from 'react'
import {Banner, Button, Heading, Label, Stack, Text} from '@primer/react'
import {Card} from '@primer/react/experimental'
import content from './audience-content.json'
import type {Intent} from './AudiencePage'
import {ActionButton, Faq, PageHero, Section, Steps} from './PageSections'

export function WorkPage({onAction}: {onAction: (intent: Intent, trigger: HTMLButtonElement | null) => void}) {
  const [format, setFormat] = useState<'orders'|'jobs'|null>(() => {
    try {const saved = sessionStorage.getItem('forum.work.format'); return saved === 'orders' || saved === 'jobs' ? saved : null} catch {return null}
  })
  const select = (value: 'orders'|'jobs') => {setFormat(value); try {sessionStorage.setItem('forum.work.format', value)} catch { /* The current selection remains available without storage. */ }}
  const act = () => onAction({audience:'individual', action:'find-orders', direction:'orders',returnTo:'/work/'},document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  const faq = content.work.faq.map(x => x.question === 'Здесь только подработка или есть работа в штате?' ? {...x,answer:'Сейчас можно искать отдельные заказы на работы. Раздел вакансий строительных компаний готовится: работа в штате — скоро.'} : x)
  return <main id="main" tabIndex={-1}>
    <PageHero eyebrow={content.work.hero[0]} title={content.work.hero[1]} description="Берите отдельные заказы. Выбирайте задачи по своим навыкам, месту работы и условиям. Работа в штате — скоро." image="audience-specialist-left-mirrored.png">
      <Stack direction="horizontal" gap="normal" wrap="wrap" className="hero-actions"><ActionButton label="Найти подработку" onClick={act} /><Button as="a" size="large" href="#formats">Выбрать формат работы</Button></Stack>
      <Text as="p" size="small" className="muted">Для просмотра подходящих заказов понадобится регистрация через Сбер ID.</Text>
    </PageHero>
    <Section id="formats" title="Какую работу вы ищете?"><div className="two-columns">{content.work.formats.map((item,index) => <Card key={item.title}>
      <Stack gap="normal"><Card.Heading as="h3">{item.title}</Card.Heading><Card.Description>{index === 1 ? 'Мы готовим раздел вакансий строительных компаний. Сейчас на платформе можно искать отдельные заказы на работы.' : item.description}</Card.Description>
        {index === 1 && <Label>Работа в штате — скоро</Label>}
        <Button aria-pressed={format === (index === 0 ? 'orders' : 'jobs')} onClick={() => select(index === 0 ? 'orders' : 'jobs')}>{item.action}</Button>
      </Stack></Card>)}</div>
      <Text as="p" size="small" className="muted section-note" aria-live="polite">{format ? `Выбрано: ${format === 'orders' ? 'заказы и подработка' : 'работа в штате'}. Можно сменить формат выше.` : 'Выберите формат или ознакомьтесь с обоими сценариями ниже. Для этого регистрация не нужна.'}</Text>
    </Section>
    <Section id="skills" title="Найдите применение вашим навыкам"><Text as="p" size="large" className="muted">Отделка, монтаж, электрика, сантехника и другие строительные работы. Укажите, что умеете делать и где готовы работать.</Text><Text as="p" size="small" className="muted section-note">Примеры ниже объясняют сценарии и не означают, что сейчас есть открытый заказ или вакансия.</Text></Section>
    {format !== 'jobs' && <Section id="order-example" title="Сначала условия — потом решение"><div className="two-columns example-layout">
      <Text as="p" size="large" className="muted">Посмотрите, что нужно сделать, какой объём выполнить, в каком районе и к какому сроку. Изучите требования и предложите свою стоимость работы.</Text>
      <Example label="Пример заказа" title="Укладка плитки в помещении" items={['Объём: 40 м²','Район работ: Москва, САО','Срок выполнения: в течение двух недель после согласования','Стоимость: предложите свою цену','Материалы: предоставляет заказчик']} note="Так может выглядеть заказ после регистрации. Это демонстрационный пример." />
    </div></Section>}
    {format !== 'orders' && <Section id="job-example" title="Выбирайте работу с понятными условиями"><div className="two-columns example-layout">
      <Stack gap="normal"><Banner title="Работа в штате — скоро" variant="info"><Text as="p">Мы готовим раздел вакансий строительных компаний. Сейчас на платформе можно искать отдельные заказы на работы.</Text></Banner><Text as="p" className="muted">Сравните обязанности, зарплату, график и место работы. Обратите внимание на требования к опыту и условия оформления.</Text></Stack>
      <Example label="Пример вакансии" title="Монтажник в строительную компанию" items={['Зарплата: 100 000–120 000 ₽ в месяц до вычета налогов','График: 5/2','Место работы: Москва','Опыт: от одного года','Оформление: в штат по трудовому договору']} note="Все условия приведены для примера. Это не действующая вакансия и не ориентир зарплаты на рынке." />
    </div></Section>}
    <Section id="how" title="Как это работает"><Stack gap="spacious">
      {format !== 'jobs' && <Stack gap="normal"><Heading as="h3" variant="medium">Заказы и подработка</Heading><Steps items={content.work.orderSteps} /></Stack>}
      {format !== 'orders' && <Stack gap="normal"><Heading as="h3" variant="medium">Работа в штате</Heading><Text as="p" className="muted">Так будет устроен поиск вакансий после запуска раздела.</Text><Steps items={content.work.jobSteps} /></Stack>}
    </Stack></Section>
    <Faq title="Вопросы о работе и подработке" items={faq} />
    <section className="section container" aria-labelledby="final-title"><Card><Stack gap="spacious"><Heading as="h2" id="final-title" variant="large">{format === 'orders' ? 'Используйте свои навыки в новых заказах' : format === 'jobs' ? 'Работа в штате — скоро' : 'Выберите следующий шаг'}</Heading>
      <Text as="p" size="large" className="muted">{format === 'jobs' ? 'Мы готовим раздел вакансий строительных компаний. Сейчас на платформе можно искать отдельные заказы на работы.' : 'Укажите, какие работы выполняете и где готовы работать. Находите подходящие задачи и предлагайте свои условия.'}</Text><ActionButton label="Найти подработку" onClick={act} /><Text size="small" className="muted">Продолжить через Сбер ID</Text>
    </Stack></Card></section>
  </main>
}
function Example({label, title, items, note}: {label: string; title: string; items: string[]; note: string}) {
  return <Card><Stack gap="normal"><Label>{label}</Label><Card.Heading as="h3">{title}</Card.Heading><Stack as="ul" gap="condensed" className="example-facts">{items.map(item => <Text as="li" key={item}>{item}</Text>)}</Stack><Text as="p" size="small" className="muted">{note}</Text></Stack></Card>
}
