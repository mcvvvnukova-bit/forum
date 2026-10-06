import {Button, Flash, FormControl, Heading, TextInput} from '@primer/react'
import {LockIcon} from '@primer/octicons-react'

function hasPasswordError() {
  return new URLSearchParams(window.location.search).get('error') === '1'
}

export function AuthScreen() {
  const showError = hasPasswordError()

  return (
    <main className="auth-page" aria-labelledby="auth-title">
      <section className="auth-card">
        <img className="auth-logo" src="/forum-logo-square.svg" alt="Логотип ФОРУМ" width="96" height="96" />
        <div className="auth-copy">
          <Heading id="auth-title" as="h1" className="auth-title">
            Закрытый просмотр
          </Heading>
        </div>

        {showError ? (
          <Flash variant="danger" role="alert">
            Неверный пароль
          </Flash>
        ) : null}

        <form data-testid="auth-form" className="auth-form" method="post" action="/auth/login">
          <FormControl required>
            <FormControl.Label>Пароль</FormControl.Label>
            <TextInput
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              block
              leadingVisual={LockIcon}
            />
          </FormControl>
          <Button type="submit" variant="primary" className="auth-submit" block>
            Войти
          </Button>
        </form>
      </section>
    </main>
  )
}
