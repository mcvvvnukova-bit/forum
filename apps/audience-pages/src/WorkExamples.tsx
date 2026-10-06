import {useEffect, useRef, useState} from 'react'
import {Heading, IconButton, Stack, Text} from '@primer/react'
import {ChevronLeftIcon, ChevronRightIcon} from '@primer/octicons-react'
import {WorkExample} from './WorkExample'
import {publicPageUrl} from '../../../packages/public-navigation'

type Slide = 'orders'|'jobs'
function slideForHash(hash: string): Slide|null {
  if (hash === '#job-example') return 'jobs'
  if (hash === '#skills' || hash === '#order-example') return 'orders'
  return null
}

export function WorkExamples() {
  const effectiveHash = () => new URL(publicPageUrl(), window.location.origin).hash
  const [slide, setSlide] = useState<Slide>(() => slideForHash(effectiveHash()) || 'orders')
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const scrollToExamples = () => rootRef.current?.scrollIntoView?.({block:'start'})
    let previousHash = effectiveHash()
    if (slideForHash(previousHash)) scrollToExamples()
    const handleHash = () => {
      const hash = effectiveHash()
      // Modal history restores the same background hash; it must preserve both
      // the scroll position and a slide chosen independently with the controls.
      if (hash === previousHash) return
      previousHash = hash
      const next = slideForHash(hash)
      if (next) {setSlide(next); scrollToExamples()}
    }
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])
  const toggle = () => setSlide(current => current === 'orders' ? 'jobs' : 'orders')
  const orders = slide === 'orders'
  return <section id="skills" ref={rootRef} className="section container" aria-label="Примеры работы и подработки" aria-roledescription="карусель">
    <div id="work-example-slide" className="two-columns example-layout" role="group" aria-roledescription="слайд" aria-label={orders ? '1 из 2: Заказы и подработка' : '2 из 2: Работа в штате'}>
      <Stack gap="spacious">
        <Stack gap="normal">
          <Heading as="h2" variant="large">Найдите работу по своей специальности</Heading>
          <Text as="p" size="large" className="muted">Выбирайте заказы и вакансии с учётом ваших навыков и места работы.</Text>
        </Stack>
        <Stack gap="normal">
          <Heading as="h3" variant="medium">{orders ? 'Заказы и подработка' : 'Работа в штате'}</Heading>
          <Text as="p" size="large" className="muted">{orders ? 'Изучите задачу, объём работ, место и сроки. Предложите свою стоимость и откликнитесь на подходящий заказ.' : 'Сравните обязанности, зарплату, график и место работы. Откликнитесь на вакансию, которая вам подходит.'}</Text>
        </Stack>
        <Stack direction="horizontal" align="center" gap="normal">
          <IconButton size="large" icon={ChevronLeftIcon} aria-label="Предыдущий пример" aria-controls="work-example-slide" onClick={toggle} />
          <Text role="status" aria-live="polite" aria-atomic="true" className="muted">{orders ? '1' : '2'} из 2</Text>
          <IconButton size="large" icon={ChevronRightIcon} aria-label="Следующий пример" aria-controls="work-example-slide" onClick={toggle} />
        </Stack>
      </Stack>
      {orders ? <div id="order-example">
        <WorkExample image="work-order-interface-v1.png" title="Укладка плитки в помещении" items={['Объём: 40 м²','Район работ: Москва, САО','Срок выполнения: в течение двух недель после согласования','Стоимость: предложите свою цену','Материалы: предоставляет заказчик']} />
      </div> : <div id="job-example">
        <WorkExample image="work-vacancy-interface-v1.png" title="Монтажник в строительную компанию" items={['Зарплата: 100 000–120 000 ₽ в месяц до вычета налогов','График: 5/2','Место работы: Москва','Опыт: от одного года','Оформление: в штат по трудовому договору']} />
      </div>}
    </div>
  </section>
}
