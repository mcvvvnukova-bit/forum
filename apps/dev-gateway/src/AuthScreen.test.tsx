import {render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import {AuthScreen} from './AuthScreen'

describe('AuthScreen', () => {
  it('renders the square Forum logo and a password form that posts to the gateway login endpoint', () => {
    render(<AuthScreen />)

    const logo = screen.getByRole('img', {name: 'Логотип ФОРУМ'})
    expect(logo).toHaveAttribute('src', '/auth-assets/forum-logo-square.svg')
    expect(screen.queryByText('Введите пароль, чтобы открыть dev-версию лендинга.')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Пароль/)).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', {name: 'Войти'})).toHaveAttribute('class', expect.stringContaining('auth-submit'))
    expect(screen.getByRole('button', {name: 'Войти'})).toHaveAttribute('type', 'submit')
    expect(screen.getByTestId('auth-form')).toHaveAttribute('method', 'post')
    expect(screen.getByTestId('auth-form')).toHaveAttribute('action', '/auth/login')
  })

  it('shows a wrong-password state when the gateway redirects back with an error marker', () => {
    window.history.replaceState(null, '', '/?error=1')

    render(<AuthScreen />)

    expect(screen.getByRole('alert')).toHaveTextContent('Неверный пароль')
    expect(screen.getByLabelText(/Пароль/)).toHaveFocus()
  })
})
