import {fireEvent, render, screen} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

function open(path: string) {window.history.replaceState({}, '', path); render(<ThemeProvider colorMode="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)}
beforeEach(() => {sessionStorage.clear()})
describe('Audience landing behavior', () => {
  it('shows both work examples before choosing a format', () => {open('/work/'); expect(screen.getByText('Укладка плитки в помещении')).toBeInTheDocument(); expect(screen.getByText('Монтажник в строительную компанию')).toBeInTheDocument(); expect(screen.getByRole('button', {name:'Выбрать заказы'})).toHaveAttribute('aria-pressed','false')})
  it('filters examples and steps while keeping the format choices', () => {open('/work/');fireEvent.click(screen.getByRole('button',{name:'Выбрать заказы'}));expect(screen.queryByText('Монтажник в строительную компанию')).not.toBeInTheDocument(); expect(screen.getByRole('button',{name:'Выбрать вакансии'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Выбрать вакансии'}));expect(screen.queryByText('Укладка плитки в помещении')).not.toBeInTheDocument();expect(screen.getByText('Монтажник в строительную компанию')).toBeInTheDocument()})
  it('does not send an unavailable vacancy action to procurement', () => {open('/work/');expect(screen.getAllByText('Работа в штате — скоро').length).toBeGreaterThan(0);expect(screen.queryByRole('link',{name:'Найти вакансию'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Найти вакансию'})).not.toBeInTheDocument()})
  it('preserves supplier goods intent through the registration handoff', () => {open('/suppliers/');fireEvent.click(screen.getByRole('button',{name:'Хочу поставлять товары'}));expect(screen.getByRole('dialog')).toHaveTextContent('Регистрация компании-исполнителя');expect(screen.getByRole('dialog')).toHaveTextContent('Поставка товаров');expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'supplier',direction:'goods',action:'find-orders'})})
  it.each([
    ['Хочу проектировать','design','Выполнение проектных работ'],
    ['Хочу строить и монтировать','construction','Строительные и монтажные работы'],
    ['Хочу предлагать лизинг','leasing','Лизинг спецтехники'],
  ])('keeps the chosen supplier direction for the final CTA: %s', (button,direction,label) => {open('/suppliers/');fireEvent.click(screen.getByRole('button',{name:button}));expect(screen.getByRole('dialog')).toHaveTextContent(label);expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'supplier',direction,action:'find-orders'});fireEvent.click(screen.getByRole('button',{name:'Вернуться к странице'}));fireEvent.click(screen.getAllByRole('button',{name:'Найти заказы'})[1]);expect(screen.getByRole('dialog')).toHaveTextContent(label)})
  it('keeps ordinary login available after closing a company action', () => {sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'customer',action:'create-order',returnTo:'/customers/'}));open('/participate/');expect(screen.getByRole('link',{name:'Войти через Сбер ID'})).toHaveAttribute('href','/auth/sber-id/start?intent=login');expect(screen.getByRole('link',{name:'Я ищу работу'})).toBeInTheDocument()})
  it('routes handoff navigation to an existing explanation', () => {open('/participate/');expect(screen.getByRole('link',{name:'Как это работает'})).toHaveAttribute('href','/#rules')})
  it('starts the customer path with the order intent', () => {open('/customers/');fireEvent.click(screen.getAllByRole('button',{name:'Разместить заказ'})[0]);expect(screen.getByRole('dialog')).toHaveTextContent('Регистрация компании-заказчика');expect(JSON.parse(sessionStorage.getItem('forum.public.intent')!)).toMatchObject({audience:'customer',action:'create-order'})})
})
