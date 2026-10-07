import {act, fireEvent, screen} from '@testing-library/react'
import * as client from 'react-dom/client'
import type {Root} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'

vi.mock('react-dom/client',{spy:true})
let authRoot: Root | undefined
afterEach(async () => {
  await act(async () => authRoot?.unmount())
  document.getElementById('root')?.remove()
  document.getElementById('legacy-fixture')?.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('keeps unified root dialog labels accessible beside retained legacy DOM', async () => {
  history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', async () => new Response('', {status:401}))
  const legacy=document.createElement('div'); legacy.id='legacy-fixture'
  // Independent React bundles allocate the same unprefixed useId sequence.
  for (let n=0;n<64;n++) {
    const heading=document.createElement('h2'); heading.id=`_r_${n.toString(32)}_`
    heading.textContent='Регистрация компаний — скоро'; legacy.append(heading)
  }
  const login=document.createElement('a'); login.href='/login'; login.textContent='Войти'; legacy.append(login)
  document.body.append(legacy)
  const container=document.createElement('div'); container.id='root'; document.body.append(container)
  const roots=vi.mocked(client.createRoot)
  await act(async () => {await import('../main')})
  authRoot=roots.mock.results[0].value as Root
  fireEvent.click(login)
  expect(await screen.findByRole('dialog',{name:'Войти в аккаунт'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Закрыть окно'})).toBeInTheDocument()
})
