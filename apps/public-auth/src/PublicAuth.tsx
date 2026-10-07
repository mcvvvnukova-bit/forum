import {useEffect, useRef, useState} from 'react'
import {Banner, Button, Dialog, Heading, IconButton, Link, Spinner, Stack, Text} from '@primer/react'
import type {DialogHeaderProps} from '@primer/react'
import {XIcon} from '@primer/octicons-react'
import {checkSession} from './session'
import type {SessionState} from './session'
import sberMark from './sber-mark.svg'
import {openPublicAuth, publicAuthBackground} from '../../../packages/public-navigation'

type Mode = 'login' | 'register'
type View = {mode: Mode; modal: boolean} | null
const errors: Record<string, string> = {
  access_denied: 'Вы отменили подтверждение. Можно попробовать ещё раз',
  invalid_state: 'Время ожидания входа истекло. Повторите вход ещё раз',
  account_deactivated: 'Доступ к аккаунту закрыт. Обратитесь в тех. поддержку',
  account_conflict: 'Не удалось связать данные с аккаунтом. Обратитесь в тех. поддержку',
  registration_required: 'Аккаунт не найден. Зарегистрируйтесь со Сбер ID',
  account_exists: 'Аккаунт уже существует. Войдите в аккаунт',
}
function modeFromPath(): Mode | null {
  const path = location.pathname.replace(/\/$/, '')
  return path === '/login' ? 'login' : path === '/register' ? 'register' : null
}
function linkMode(anchor: HTMLAnchorElement): Mode | null {
  const href = anchor.getAttribute('href')?.trim()
  if (!href || href.startsWith('#') || href.startsWith('?')) return null
  const url = new URL(href, location.origin+'/')
  if (url.origin !== location.origin || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return null
  const path = url.pathname.replace(/\/$/, '')
  if (path === '/login' || path === '/register') return path.slice(1) as Mode
  if (path === '/auth/sber-id/start') return url.searchParams.get('intent') === 'register' ? 'register' : 'login'
  if (path === '/authorization') return 'login'
  return null
}
function clearLegacyIntent() {
  try {sessionStorage.removeItem('forum.public.intent'); sessionStorage.removeItem('forum.customer.intent')} catch { /* Storage is optional; no navigation context is written. */ }
}
function ModalHeader({title, dialogLabelId, onClose}: DialogHeaderProps) {
  return <Dialog.Header className="public-auth-header">
    <Dialog.Title id={dialogLabelId}>{title}</Dialog.Title>
    <IconButton icon={XIcon} aria-label="Закрыть окно" variant="invisible" onClick={() => onClose('close-button')} />
  </Dialog.Header>
}
function ModalBody({children}: React.PropsWithChildren) {
  return <Dialog.Body className="public-auth-modal-body">{children}</Dialog.Body>
}
export function PublicAuth({navigate = url => location.assign(url)}: {navigate?: (url: string) => void}) {
  const [view, setView] = useState<View>(() => {const mode = modeFromPath(); return mode ? {mode, modal: publicAuthBackground() !== null} : null})
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get('auth_error'))
  const [session, setSession] = useState<SessionState>({kind:'checking'})
  const [retry, setRetry] = useState(0)
  const [redirecting, setRedirecting] = useState(false)
  const navigating = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const mode = view?.mode

  useEffect(() => {
    const currentMode = modeFromPath()
    const query = new URLSearchParams(location.search)
    const returnedError = query.get('auth_error')
    if (currentMode) history.replaceState(history.state, '', '/'+currentMode)
    else if (query.has('auth') || returnedError) {
      query.delete('auth'); query.delete('auth_error'); query.delete('error_description'); query.delete('flowId')
      history.replaceState(history.state, '', location.pathname + (query.size ? '?'+query.toString() : '') + location.hash)
      if (returnedError) {
        const returnedMode = returnedError === 'registration_required' ? 'register' : 'login'
        openPublicAuth(returnedMode)
        setView({mode:returnedMode, modal:true})
      }
    }
    // Same-origin legacy links and modern links share one modal. Modified clicks
    // still open the standalone URL, without a source/action query.
    const normalize = () => {
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
        const link = linkMode(anchor)
        if (link && anchor.getAttribute('href') !== '/'+link) anchor.setAttribute('href', '/'+link)
      })
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.closest('.public-auth-content')) return
      const next = linkMode(anchor)
      if (!next) return
      event.preventDefault(); event.stopPropagation()
      clearLegacyIntent()
      returnFocusRef.current = anchor
      setError(null); navigating.current=false; setRedirecting(false)
      openPublicAuth(next)
      setView({mode:next, modal:true})
    }
    const onPop = () => {
      const next = modeFromPath()
      setView(next ? {mode:next, modal:publicAuthBackground() !== null} : null)
      navigating.current=false; setRedirecting(false)
    }
    normalize()
    const observer = new MutationObserver(normalize)
    observer.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['href']})
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPop)
    return () => {observer.disconnect(); document.removeEventListener('click', onClick, true); window.removeEventListener('popstate', onPop)}
  }, [])
  useEffect(() => {
    if (!mode) return
    const controller = new AbortController()
    setSession({kind:'checking'})
    void checkSession(controller.signal).then(result => {if (!controller.signal.aborted) setSession(result)})
    return () => controller.abort()
  }, [mode, retry])
  if (!view) return null
  const blocked = error === 'account_deactivated' || error === 'account_conflict'
  const unavailable = error === 'sber_unavailable'
  const message = session.kind === 'unknown' ? 'Не удалось проверить вход. Повторите попытку' : unavailable
    ? mode === 'register' ? 'Регистрация через Сбер ID пока недоступна' : 'Вход через Сбер ID пока недоступен'
    : error ? errors[error] || 'Не удалось завершить вход. Попробуйте ещё раз' : null
  const title = mode === 'register' ? 'Создайте аккаунт' : 'Войти в аккаунт'
  const switchMode = (event: React.MouseEvent, next: Mode) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); event.stopPropagation()
    history.replaceState(history.state, '', '/'+next)
    setView({...view, mode:next}); setRedirecting(false); navigating.current=false
    if (!unavailable && error !== 'access_denied') setError(null)
  }
  const start = () => {
    if (navigating.current || session.kind !== 'guest' || blocked || unavailable) return
    navigating.current=true; setRedirecting(true); clearLegacyIntent()
    try {navigate('/auth/sber-id/start?intent='+mode+(mode === 'register' ? '&subject=individual' : ''))}
    catch {navigating.current=false; setRedirecting(false); setError('temporarily_unavailable')}
  }
  const body = <Stack gap="spacious" className="public-auth-content">
    {message && <Banner title="Вход не завершён" variant="warning"><span role="alert">{message}</span></Banner>}
    {session.kind === 'authenticated' ? <Text as="p" role="status">Вы уже вошли в аккаунт</Text> : <>
      <Button variant="primary" size="large" className="public-auth-sber"
        disabled={session.kind !== 'guest' || redirecting || blocked || unavailable} onClick={start}>
        <span className="public-auth-label-layout"><img src={sberMark} alt="" aria-hidden className="public-auth-mark" /><span className="public-auth-label">{mode === 'register' ? 'Зарегистрироваться по Сбер ID' : 'Войти по Сбер ID'}</span></span>
      </Button>
      {session.kind === 'checking' && <Stack direction="horizontal" align="center" gap="normal"><Spinner size="small" /><Text role="status">Проверяем вход…</Text></Stack>}
      {redirecting && <Text role="status">Переходим к Сбер ID…</Text>}
    </>}
    {blocked ? <Link href="mailto:info@astforum.ru">Тех. поддержка</Link> : session.kind !== 'authenticated' && <Text as="p" className="public-auth-switch">
      {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
      <Link href={mode === 'login' ? '/register' : '/login'} onClick={event => switchMode(event, mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
      </Link>
    </Text>}
    {unavailable && <Link href="/#demo">Записаться на демо</Link>}
    {message && !blocked && !unavailable && <Button disabled={redirecting || session.kind === 'checking'} onClick={() => {
      if (session.kind === 'unknown') {setRetry(value => value+1)}
      else start()
    }}>Повторить</Button>}
  </Stack>
  if (view.modal) return <Dialog title={title} renderHeader={ModalHeader} renderBody={ModalBody} returnFocusRef={returnFocusRef}
    onClose={() => {setView(null); history.back()}} width="min(560px, max(calc(100vw - var(--base-size-32)), min(320px, 100vw)))" style={{maxWidth:'100vw'}} position="center">{body}</Dialog>
  return <main className="public-auth-page"><Stack gap="spacious" padding={{narrow:"condensed", regular:"spacious"}} className="public-auth-panel">
    <Link href="/">АСТ Форум</Link><Heading as="h1" variant="large">{title}</Heading>{body}
  </Stack></main>
}
