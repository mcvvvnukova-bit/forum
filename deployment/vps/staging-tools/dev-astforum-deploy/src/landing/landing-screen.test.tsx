import {render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import {LandingApp} from './LandingApp'

describe('landing screen assets', () => {
  it('uses exported Figma imagery for the hero and audience map', () => {
    render(<LandingApp />)

    expect(screen.getByRole('img', {name: 'Интерфейс строительной площадки Форум'})).toHaveAttribute(
      'src',
      expect.stringContaining('hero-illustration-process-interface-v1'),
    )
    expect(screen.getByRole('img', {name: 'Заказчик со строительной сметой'})).toHaveAttribute(
      'src',
      expect.stringContaining('audience-customer'),
    )
    expect(screen.getByRole('img', {name: 'Логотип Rentaero'})).toBeInTheDocument()
  })
})
