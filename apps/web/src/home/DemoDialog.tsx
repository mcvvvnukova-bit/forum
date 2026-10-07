import {useEffect, useState} from 'react'
import type {RefObject} from 'react'
import {Banner, Button, Dialog, Link, Spinner, Stack, Text} from '@primer/react'
import {demo} from './content'

export function DemoDialog({onClose, returnFocusRef}: {onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const timeout = window.setTimeout(() => setStatus(current => current === 'loading' ? 'error' : current), 15_000)
    return () => window.clearTimeout(timeout)
  }, [attempt])

  return (
    <Dialog title="Выберите удобное время" subtitle="Демонстрация АСТ Форум · 60 минут · GMT+3" onClose={onClose} returnFocusRef={returnFocusRef}
      width="min(960px, calc(100vw - var(--base-size-32)))" position={{narrow: 'fullscreen', regular: 'center'}}>
      <Stack gap="normal">
        {status === 'loading' && <Stack direction="horizontal" gap="normal" align="center"><Spinner size="small" /><Text role="status">Загрузка календаря…</Text></Stack>}
        {status === 'error' && (
          <Banner title="Не удалось загрузить календарь. Попробуйте ещё раз или откройте страницу записи" variant="warning">
            <Stack direction="horizontal" gap="normal" wrap="wrap">
              <Button onClick={() => {setStatus('loading'); setAttempt(value => value + 1)}}>Повторить</Button>
              <Button as="a" href={demo.url} target="_blank" rel="noopener noreferrer">Открыть страницу записи</Button>
            </Stack>
          </Banner>
        )}
        <iframe key={attempt} src={`${demo.url}?embed=true&layout=month_view&theme=light`}
          title="Cal.diy — запись на демонстрацию АСТ Форум" className="booking-frame"
          onLoad={() => setStatus('loaded')} onErrorCapture={() => setStatus('error')} />
        <Text size="small" className="muted">
          Если календарь не открывается, <Link href={demo.url} target="_blank" rel="noopener noreferrer">откройте страницу записи</Link>.
        </Text>
      </Stack>
    </Dialog>
  )
}
