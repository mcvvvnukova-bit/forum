import {render, screen, within} from '@testing-library/react'
import {afterEach, expect, it} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {App} from './App'

afterEach(() => window.history.replaceState({}, '', '/'))

it('opens the work page directly with its own content and a link back to personal data', () => {
  window.history.replaceState({}, '', '/profile/work#main')
  render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><App/></BaseStyles></ThemeProvider>)
  expect(screen.getByRole('heading', {level: 1, name: 'Работа и образование'})).toBeVisible()
  const work = within(screen.getByRole('region', {name: 'Работа и образование'}))
  expect(work.getByText('ООО «Пример»')).toBeVisible()
  expect(work.getByText('Специалист по закупкам')).toBeVisible()
  expect(work.getByText('Высшее')).toBeVisible()
  expect(work.getByText('Нет')).toBeVisible()
  expect(screen.queryByRole('region', {name: 'Личные данные'})).not.toBeInTheDocument()
  expect(screen.queryByRole('region', {name: 'Дополнительные документы'})).not.toBeInTheDocument()
  expect(screen.getByRole('link', {name: 'Личные данные'})).toHaveAttribute('href', '/#personal')
  expect(screen.getByRole('link', {name: 'Работа и образование'})).toHaveAttribute('aria-current', 'page')
})
