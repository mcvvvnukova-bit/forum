import {render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import {LandingApp} from './LandingApp'

describe('LandingApp', () => {
  it('renders the Figma landing sections and primary actions', () => {
    render(<LandingApp />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 1, name: 'Форум'})).toBeInTheDocument()
    expect(screen.getByText('электронная строительная площадка')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Начать работу'})).toHaveAttribute('href', '/register')
    expect(screen.getAllByRole('link', {name: 'Записаться на демо'})[0]).toHaveAttribute('href', '#demo')

    expect(screen.getByRole('heading', {level: 2, name: /Одна площадка для всех/})).toBeInTheDocument()
    expect(screen.getByText('Заказчик')).toBeInTheDocument()
    expect(screen.getByText('Поставщик')).toBeInTheDocument()
    expect(screen.getByText('Исполнитель')).toBeInTheDocument()
    expect(screen.getByText('Частный специалист')).toBeInTheDocument()

    expect(screen.getByText('679 млн')).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Посмотрите «Форум» в работе'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Нам доверяют'})).toBeInTheDocument()
    expect(screen.getByRole('heading', {level: 2, name: 'Частые вопросы'})).toBeInTheDocument()
    expect(screen.getByText(/Зарегистрироваться могут юридические лица/)).toBeInTheDocument()
  })
})
