import {useState} from 'react'
import {Button, FormControl, Heading, Select, Text} from '@primer/react'
import {ProfilePage} from './ProfilePage'
import {approvedScopes, demoProfile, partialProfile} from './fixtures'

type PreviewState = 'ready' | 'partial' | 'limited' | 'loading' | 'error'
export function App() {
  const [previewState, setPreviewState] = useState<PreviewState>('ready')
  const [showControls, setShowControls] = useState(false)
  return <>
    <ProfilePage profile={previewState === 'partial' ? partialProfile : demoProfile} approvedScopes={previewState === 'limited' ? ['name', 'email', 'mobile'] : approvedScopes} state={previewState === 'loading' || previewState === 'error' ? previewState : 'ready'} onRetry={() => setPreviewState('ready')}/>
    <aside className="preview-panel" aria-label="Локальный макет">
      <div className="preview-summary"><div><Text weight="semibold">Демонстрационный профиль</Text><Text as="p" size="small" className="muted">Вымышленные данные. Подключение к Сбер ID не выполняется.</Text></div><Button size="small" onClick={() => setShowControls(v => !v)} aria-expanded={showControls} aria-controls="preview-controls">{showControls ? 'Скрыть настройки' : 'Состояния макета'}</Button></div>
      {showControls && <div id="preview-controls" className="preview-controls"><Heading as="h2" variant="small">Проверка состояний</Heading><FormControl><FormControl.Label>Состояние профиля</FormControl.Label><Select value={previewState} onChange={e => setPreviewState(e.target.value as PreviewState)}><Select.Option value="ready">Основной пример</Select.Option><Select.Option value="partial">Часть данных не передана</Select.Option><Select.Option value="limited">Разрешены только имя и контакты</Select.Option><Select.Option value="loading">Загрузка</Select.Option><Select.Option value="error">Ошибка загрузки</Select.Option></Select><FormControl.Caption>«Повторить» после ошибки возвращает демонстрационный пример.</FormControl.Caption></FormControl></div>}
    </aside>
  </>
}
