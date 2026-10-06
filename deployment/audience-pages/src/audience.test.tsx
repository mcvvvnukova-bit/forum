import {fireEvent, render, screen, within} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

function open(path: string) {window.history.replaceState({}, '', path); render(<ThemeProvider colorMode="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)}
function supplierAction(title: string) {return within(screen.getByRole('heading',{name:title}).closest<HTMLElement>('[data-component="Card"]')!).getByRole('button',{name:'Приступить к работе'})}
beforeEach(() => {sessionStorage.clear()})
describe('Audience landing behavior', () => {
  it.each([
    ['Выбрать заказы','find-orders','orders','Поиск подходящих заказов'],
    ['Выбрать вакансии','find-jobs','jobs','Поиск вакансий'],
  ])('starts the requested work auth path immediately: %s', (label,action,direction,dialogText) => {
    open('/work/')
    fireEvent.click(screen.getByRole('button',{name:label}))
    expect(screen.getByRole('dialog')).toHaveTextContent(dialogText)
    expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'individual',action,direction,returnTo:'/work/'})
    fireEvent.click(screen.getByRole('button',{name:'Вернуться к странице'}))
    const opposite=direction==='jobs'?'Выбрать заказы':'Выбрать вакансии'
    fireEvent.click(screen.getByRole('button',{name:opposite}))
    expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject(direction==='jobs'?{action:'find-orders',direction:'orders'}:{action:'find-jobs',direction:'jobs'})
  })
  it('cycles one visible work example forward and backward', () => {
    open('/work/')
    const carousel=screen.getByRole('region',{name:'Примеры работы и подработки'})
    expect(within(carousel).getAllByRole('group')).toHaveLength(1)
    expect(within(carousel).getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
    fireEvent.click(within(carousel).getByRole('button',{name:'Следующий пример'}))
    expect(within(carousel).getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
    expect(within(carousel).getAllByRole('group')).toHaveLength(1)
    fireEvent.click(within(carousel).getByRole('button',{name:'Следующий пример'}))
    expect(within(carousel).getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
    fireEvent.click(within(carousel).getByRole('button',{name:'Предыдущий пример'}))
    expect(within(carousel).getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
  })
  it('keeps slide browsing independent from a saved work auth choice', () => {
    sessionStorage.setItem('forum.work.format','jobs')
    open('/work/')
    fireEvent.click(screen.getByRole('button',{name:'Следующий пример'}))
    fireEvent.click(screen.getByRole('button',{name:'Следующий пример'}))
    fireEvent.click(screen.getAllByRole('button',{name:'Найти работу'})[1])
    expect(screen.getByRole('dialog')).toHaveTextContent('Поиск вакансий')
    expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'individual',action:'find-jobs',direction:'jobs',returnTo:'/work/'})
  })
  it('opens the legacy vacancy hash and responds to order hash navigation', () => {
    open('/work/#job-example')
    expect(screen.getByRole('group',{name:/Работа в штате/})).toBeInTheDocument()
    window.history.replaceState({}, '', '/work/#order-example')
    fireEvent(window,new Event('hashchange'))
    expect(screen.getByRole('group',{name:/Заказы и подработка/})).toBeInTheDocument()
  })
  it('keeps a selected vacancy action distinct through reload and final CTA', () => {
    sessionStorage.setItem('forum.work.format','jobs')
    open('/work/')
    fireEvent.click(screen.getAllByRole('button',{name:'Найти работу'})[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('Поиск вакансий')
    fireEvent.click(screen.getByRole('button',{name:'Вернуться к странице'}))
    fireEvent.click(screen.getAllByRole('button',{name:'Найти работу'})[1])
    expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'individual',action:'find-jobs',direction:'jobs',returnTo:'/work/'})
  })
  it('preserves supplier goods intent through the registration handoff', () => {open('/suppliers/');fireEvent.click(supplierAction('Поставка товаров'));expect(screen.getByRole('dialog')).toHaveTextContent('Регистрация компании-исполнителя');expect(screen.getByRole('dialog')).toHaveTextContent('Поставка товаров');expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'supplier',direction:'goods',action:'find-orders'})})
  it.each([
    ['Выполнение проектных работ','design'],
    ['Строительные и монтажные работы','construction'],
    ['Лизинг спецтехники','leasing'],
  ])('keeps the chosen supplier direction for the final CTA: %s', (label,direction) => {open('/suppliers/');fireEvent.click(supplierAction(label));expect(screen.getByRole('dialog')).toHaveTextContent(label);expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'supplier',direction,action:'find-orders'});fireEvent.click(screen.getByRole('button',{name:'Вернуться к странице'}));fireEvent.click(screen.getAllByRole('button',{name:'Найти заказы'})[1]);expect(screen.getByRole('dialog')).toHaveTextContent(label)})
  it('keeps ordinary login available after closing a company action', () => {sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'customer',action:'create-order',returnTo:'/customers/'}));open('/participate/');expect(screen.getByRole('link',{name:'Войти через Сбер ID'})).toHaveAttribute('href','/auth/sber-id/start?intent=login');expect(screen.getByRole('link',{name:'Я ищу работу'})).toBeInTheDocument()})
  it('routes handoff navigation to an existing explanation', () => {open('/participate/');expect(screen.getByRole('link',{name:'О платформе'})).toHaveAttribute('href','/#rules')})
  it('starts the customer path with the order intent', () => {open('/customers/');fireEvent.click(screen.getAllByRole('button',{name:'Разместить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('Регистрация компании-заказчика');expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'customer',action:'create-order'})})
})
