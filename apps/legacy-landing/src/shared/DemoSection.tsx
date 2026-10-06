import type {MouseEvent, MouseEventHandler} from 'react'
import {Button, Heading, Text} from '@primer/react'
import {BOOKING_URL, onDemoBookingClick} from '../landing/cal-diy-embed'
import './demo-section.css'

type DemoSectionProps = {
  bookingUrl?: string
  onBookingClick?: MouseEventHandler<HTMLAnchorElement>
}

export function DemoSection({bookingUrl = BOOKING_URL, onBookingClick = onDemoBookingClick}: DemoSectionProps) {
  return (
    <section id="demo" className="landing-demo" aria-labelledby="demo-title">
      <div className="landing-demo__card">
        <div className="landing-demo__copy">
          <Text as="p" className="landing-eyebrow">демо по вашим задачам</Text>
          <Heading id="demo-title" as="h2" className="landing-demo__title">Посмотрите «Форум» в работе</Heading>
          <Text as="p" className="landing-demo__text">
            За час покажем сценарии, ответим на вопросы и подскажем,{' '}
            <br />
            как запустить работу на площадке в вашей команде.
          </Text>
        </div>
        <Button as="a" href={bookingUrl} onClick={event => onBookingClick(event as unknown as MouseEvent<HTMLAnchorElement>)} variant="primary" className="landing-button landing-demo__button">
          Выбрать время
        </Button>
      </div>
    </section>
  )
}
