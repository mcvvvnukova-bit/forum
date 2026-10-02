import {fireEvent, render, screen, within} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

function open(path: string) {window.history.replaceState({}, '', path); render(<ThemeProvider colorMode="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)}
function supplierAction(title: string) {return within(screen.getByRole('heading',{name:title}).closest<HTMLElement>('[data-component="Card"]')!).getByRole('button',{name:'Приступить к работе'})}
beforeEach(() => {sessionStorage.clear()})
describe('Audience landing behavior', () => {
  it('shows both work examples before choosing a format', () => {open('/work/'); expect(screen.getByText('Укладка плитки в помещении')).toBeInTheDocument(); expect(screen.getByText('Монтажник в строительную компанию')).toBeInTheDocument(); expect(screen.getByRole('button', {name:'Выбрать заказы'})).toHaveAttribute('aria-pressed','false')})
  it('filters examples and steps while keeping the format choices', () => {open('/work/');fireEvent.click(screen.getByRole('button',{name:'Выбрать заказы'}));expect(screen.queryByText('Монтажник в строительную компанию')).not.toBeInTheDocument(); expect(screen.getByRole('button',{name:'Выбрать вакансии'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Выбрать вакансии'}));expect(screen.queryByText('Укладка плитки в помещении')).not.toBeInTheDocument();expect(screen.getByText('Монтажник в строительную компанию')).toBeInTheDocument()})
  it('keeps a selected vacancy action distinct from procurement through reload', () => {sessionStorage.setItem('forum.work.format','jobs');open('/work/');fireEvent.click(screen.getAllByRole('button',{name:'Найти работу'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('Поиск вакансий');expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'individual',action:'find-jobs',direction:'jobs',returnTo:'/work/'});fireEvent.click(screen.getByRole('button',{name:'Вернуться к странице'}));expect(screen.getByRole('button',{name:'Выбрать вакансии'})).toHaveAttribute('aria-pressed','true')})
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
