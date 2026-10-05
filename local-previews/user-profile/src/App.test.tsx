import {render, screen, within} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllEnvs()
})

it('opens the work page directly with its own content and a link back to personal data', () => {
  window.history.replaceState({}, '', '/profile/work#main')
  render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><App/></BaseStyles></ThemeProvider>)
  const selfEmployment = within(screen.getByRole('region', {name: 'Самозанятость'}))
  expect(selfEmployment.getByText('Нет')).toBeVisible()
  expect(screen.getByRole('heading', {level: 1, name: 'Работа'})).toBeVisible()
  const work = within(screen.getByRole('region', {name: 'Текущее место работы'}))
  expect(work.getByText('ООО «Пример»')).toBeVisible()
  expect(work.getByText('Специалист по закупкам')).toBeVisible()
  expect(work.getByText('г. Москва, ул. Садовая, д. 8')).toBeVisible()
  expect(screen.queryByRole('region', {name: 'Образование'})).not.toBeInTheDocument()
  expect(screen.queryByRole('region', {name: 'Личные данные'})).not.toBeInTheDocument()
  expect(screen.queryByRole('region', {name: 'Дополнительные документы'})).not.toBeInTheDocument()
  expect(screen.getByRole('link', {name: 'Личные данные'})).toHaveAttribute('href', '/#personal')
  expect(screen.getByRole('link', {name: 'Работа'})).toHaveAttribute('aria-current', 'page')
})

it('returns from work to personal data inside the deployed profile base', () => {
  vi.stubEnv('BASE_URL', '/profile/')
  window.history.replaceState({}, '', '/profile/work#main')
  render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><App/></BaseStyles></ThemeProvider>)
  expect(screen.getByRole('link', {name: 'Личные данные'})).toHaveAttribute('href', '/profile/#personal')
  expect(screen.getByRole('img', {name: 'АСТ Форум'})).toHaveAttribute('src', '/profile/assets/forum-logo.png')
  expect(screen.getByRole('link', {name: 'АСТ Форум: личный кабинет'})).toHaveAttribute('href', '/profile/#main')
})
