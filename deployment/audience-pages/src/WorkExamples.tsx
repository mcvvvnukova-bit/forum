import {useEffect, useRef, useState} from 'react'
import {Heading, IconButton, Stack, Text} from '@primer/react'
import {ChevronLeftIcon, ChevronRightIcon} from '@primer/octicons-react'
import {WorkExample} from './WorkExample'

type Slide = 'orders'|'jobs'
function slideForHash(hash: string): Slide|null {
  if (hash === '#job-example') return 'jobs'
  if (hash === '#skills' || hash === '#order-example') return 'orders'
  return null
}

export function WorkExamples() {
  const [slide, setSlide] = useState<Slide>(() => slideForHash(window.location.hash) || 'orders')
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const scrollToExamples = () => rootRef.current?.scrollIntoView?.({block:'start'})
    if (slideForHash(window.location.hash)) scrollToExamples()
    const handleHash = () => {
      const next = slideForHash(window.location.hash)
      if (next) {setSlide(next); scrollToExamples()}
    }
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])
  const toggle = () => setSlide(current => current === 'orders' ? 'jobs' : 'orders')
  const orders = slide === 'orders'
  return <section id="skills" ref={rootRef} className="section container" aria-label="Примеры работы и подработки" aria-roledescription="карусель">
    <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="normal" className="work-examples-header">
      <Heading as="h2" variant="large">{orders ? 'Найдите применение вашим навыкам' : 'Официальное трудоустройство в штат'}</Heading>
      <Stack direction="horizontal" align="center" gap="normal">
        <IconButton size="large" icon={ChevronLeftIcon} aria-label="Предыдущий пример" aria-controls="work-example-slide" onClick={toggle} />
        <Text role="status" aria-live="polite" aria-atomic="true" className="muted">{orders ? '1' : '2'} из 2</Text>
        <IconButton size="large" icon={ChevronRightIcon} aria-label="Следующий пример" aria-controls="work-example-slide" onClick={toggle} />
      </Stack>
    </Stack>
    <div id="work-example-slide" role="group" aria-roledescription="слайд" aria-label={orders ? '1 из 2: Заказы и подработка' : '2 из 2: Работа в штате'}>
      {orders ? <div className="two-columns example-layout" id="order-example">
        <Stack gap="normal"><Text as="p" size="large" className="muted">Укажите, что умеете делать и где готовы работать.</Text>
          <Heading as="h3" variant="medium">Сначала условия — потом решение</Heading><Text as="p" size="large" className="muted">Посмотрите, что нужно сделать, какой объём выполнить, в каком районе и к какому сроку. Изучите требования и предложите свою стоимость работы.</Text></Stack>
        <WorkExample image="work-order-interface-v1.png" title="Укладка плитки в помещении" items={['Объём: 40 м²','Район работ: Москва, САО','Срок выполнения: в течение двух недель после согласования','Стоимость: предложите свою цену','Материалы: предоставляет заказчик']} />
      </div> : <div className="two-columns example-layout" id="job-example">
        <Text as="p" size="large" className="muted">Сравните обязанности, зарплату, график и место работы. Обратите внимание на требования к опыту и условия оформления.</Text>
        <WorkExample image="work-vacancy-interface-v1.png" title="Монтажник в строительную компанию" items={['Зарплата: 100 000–120 000 ₽ в месяц до вычета налогов','График: 5/2','Место работы: Москва','Опыт: от одного года','Оформление: в штат по трудовому договору']} />
      </div>}
    </div>
  </section>
}
