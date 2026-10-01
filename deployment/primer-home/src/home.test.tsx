import {fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {BaseStyles, ThemeProvider} from '@primer/react'
import {describe, expect, it} from 'vitest'
import {App} from './App'

function renderPage(url = '/') {
  window.history.replaceState(null, '', url)
  return render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><App /></BaseStyles></ThemeProvider>)
}

describe('PUB.01.01.01', () => {
  it('preserves required section order, headline, metrics and company contacts', () => {
    const {container} = renderPage()
    expect([...container.querySelectorAll('[data-section]')].map(element => element.getAttribute('data-section')))
      .toEqual(['hero', 'audiences', 'metrics', 'rules', 'demo', 'partners', 'faq'])
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Заказы, исполнители и работа в строительстве')
    for (const copy of ['28', '679 млн', '130', 'ИНН 9709128511', 'ОГРН 1257700433935']) expect(screen.getByText(copy)).toBeInTheDocument()
    expect(container.querySelectorAll('.partner-logo')).toHaveLength(13)
  })

  it('sends start and sign-in to the same auth screen, and maps the three audiences', () => {
    renderPage()
    expect(screen.getByRole('link', {name: 'Начать работу'})).toHaveAttribute('href', '/authorization/')
    expect(screen.getByRole('link', {name: 'Войти'})).toHaveAttribute('href', '/authorization/')
    expect(screen.getByRole('link', {name: 'Я заказчик'})).toHaveAttribute('href', '/customers/')
    expect(screen.getByRole('link', {name: 'Я поставщик или подрядчик'})).toHaveAttribute('href', '/suppliers/')
    expect(screen.getByRole('link', {name: 'Ищу работу'})).toHaveAttribute('href', '/work/')
    expect(screen.getByRole('link', {name: 'Как это работает'})).toHaveAttribute('href', '/#rules')
  })

  it.each(['Записаться на демо', 'Выбрать время'])('opens the same booking widget from %s and closes with Escape', async name => {
    renderPage()
    const trigger = screen.getByRole('button', {name})
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', {name: 'Выберите удобное время'})
    expect(within(dialog).getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')).toHaveAttribute('src', expect.stringContaining('https://cal.astforum.ru/demo/60min'))
    fireEvent.keyDown(dialog, {key: 'Escape', code: 'Escape'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows the calendar failure actions and retries with a fresh frame', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', {name: 'Записаться на демо'}))
    const frame = screen.getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')
    fireEvent.error(frame)
    expect(screen.getByText('Не удалось загрузить календарь. Попробуйте ещё раз или откройте страницу записи')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: 'Открыть страницу записи'})).toHaveAttribute('href', 'https://cal.astforum.ru/demo/60min')
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}))
    expect(screen.getByTitle('Cal.diy — запись на демонстрацию АСТ Форум')).not.toBe(frame)
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка календаря…')
  })

  it('uses the required logged-in label in the explicit preview state', () => {
    renderPage('/?previewSession=authorized')
    expect(screen.getByRole('link', {name: 'В кабинет'})).toHaveAttribute('href', '/cabinet/')
    expect(screen.queryByRole('link', {name: 'Войти'})).not.toBeInTheDocument()
  })

  it('opens a local destination without fabricating accounts or legal text', () => {
    renderPage('/authorization/')
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Вход и регистрация')
    expect(screen.getByText('В этой локальной версии вход и создание учётной записи не подключены.')).toBeInTheDocument()
  })
})
