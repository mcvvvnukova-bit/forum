import {fireEvent, render, screen, within} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {ProfilePage, type ProfilePageProps} from './ProfilePage'

function page(props: Partial<ProfilePageProps> = {}) {
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><ProfilePage profile={{given_name: 'Анна', family_name: 'Тестова', email: 'anna@example.test'}} approvedScopes={['name', 'email', 'inn']} {...props}/></BaseStyles></ThemeProvider>)
}

describe('profile page behavior', () => {
  it('renders only read-only data and distinguishes missing fields', () => {
    page()
    expect(screen.getByText('anna@example.test')).toBeVisible()
    expect(screen.getAllByText('Не передано').length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', {name: /Анна/})).not.toBeInTheDocument()
  })
  it('shows document and address cards immediately and links to the work page', () => {
    page()
    expect(screen.getByRole('region', {name: 'Дополнительные документы'})).toBeVisible()
    expect(screen.getByRole('region', {name: 'Другие адреса'})).toBeVisible()
    expect(screen.queryByRole('button', {name: /Дополнительные сведения/})).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', {name: 'Работа и образование'})).not.toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Работа и образование'})).toHaveAttribute('href', '/profile/work#main')
  })
  it('keeps previous name and marital status inside the personal card', () => {
    page({profile: {previous_family_name: 'Прежняя', previous_given_name: 'Анна', marital_status: {description: 'Замужем'}}, approvedScopes: ['previous_name', 'marital_status']})
    const personal = within(screen.getByRole('region', {name: 'Личные данные'}))
    expect(personal.getByText('Предыдущие ФИО')).toBeVisible()
    expect(personal.getByText('Прежняя Анна')).toBeVisible()
    expect(personal.getByText('Семейное положение')).toBeVisible()
    expect(personal.getByText('Замужем')).toBeVisible()
    expect(screen.queryByRole('region', {name: 'Другие сведения'})).not.toBeInTheDocument()
  })
  it('provides an explanation for changes in the source profile', () => {
    page()
    fireEvent.click(screen.getByRole('button', {name: 'Как изменить данные'}))
    expect(screen.getByRole('dialog', {name: 'Изменение данных профиля'})).toBeVisible()
    expect(screen.getByRole('link', {name: /Открыть СберБанк Онлайн/})).toHaveAttribute('href', 'https://online.sberbank.ru/')
  })
  it('hides stale personal data during loading', () => {
    page({state: 'loading'})
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем профиль')
    expect(screen.queryByText('anna@example.test')).not.toBeInTheDocument()
    expect(screen.queryByText(/Тестова/)).not.toBeInTheDocument()
  })
  it('offers retry and hides stale data after an error', () => {
    const retry = vi.fn()
    page({state: 'error', onRetry: retry})
    fireEvent.click(screen.getAllByRole('button', {name: 'Повторить'})[0])
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.queryByText('anna@example.test')).not.toBeInTheDocument()
  })
})
