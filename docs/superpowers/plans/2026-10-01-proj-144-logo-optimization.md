# PROJ-144: оптимизация логотипа на стенде

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сократить размер загружаемого логотипа, сохранить надпись «АВТОМАТИЗИРОВАННАЯ СИСТЕМА ТОРГОВ» и опубликовать оптимизированную версию на dev.astforum.ru.

**Architecture:** Общая страница и страница заказчика используют один импорт. PNG 2048×768 заменяется WebP 640×240 с кодированием без потерь относительно уменьшенной копии. Максимальная ширина в интерфейсе 160 px, поэтому веб-копия сохраняет четырёхкратный запас разрешения. Импорты и статическая копия переводятся на WebP; CSS и размеры элементов сохраняются.

**Tech Stack:** Sharp 0.35.4 из bundled runtime, WebP, React, Vite, GitHub, OpenProject, Caddy.

## Global Constraints

- Продолжить изолированную ветку `codex/PROJ-144-sync-landings` и PR №4; сохранить OP#PROJ-144 в описании.
- Изменить только логотип, два его импорта и этот план.
- Проверять страницы во встроенном браузере Codex (iab).
- Перед публикацией проверить сборку, типы, существующие тесты интерфейса и независимое ревью изменения.
- Сохранить резервную копию заменяемых статических файлов; публиковать ресурсы до HTML-входов, сохранять прежние сборочные ресурсы для открытых страниц.
- Проверить публичный HTTPS, Content-Type `image/webp`, SHA-256, обе страницы и присутствие PR в задаче OpenProject.

---

### Task 1: оптимизировать и опубликовать логотип

**Files:**
- Replace: `deployment/dev-landing/src/landing/assets/brand-logo-horizontal-color.png` → `.webp`
- Replace: `deployment/dev-landing/static/landing-assets/brand-logo-horizontal-color.png` → `.webp`
- Modify: `deployment/dev-landing/src/landing/LandingApp.tsx`
- Modify: `deployment/dev-landing/src/customers/CustomerLanding.tsx`

**Interfaces:**
- Consumes: утверждённый PNG с новой подписью; исходная масса 1 373 023 байта.
- Produces: общий WebP 640×240, используемый в шапке и подвале обеих страниц.

- [x] **Step 1: измерить и подготовить веб-копию**

```js
const sharp = require('/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
await sharp('deployment/dev-landing/src/landing/assets/brand-logo-horizontal-color.png')
  .resize({width: 640})
  .webp({lossless: true, effort: 6})
  .toFile('deployment/dev-landing/src/landing/assets/brand-logo-horizontal-color.webp')
```

Expected: формат WebP, размер 640×240, масса существенно меньше PNG; декодированные пиксели совпадают с уменьшенным эталоном до кодирования, надпись проверена визуально.

- [x] **Step 2: подключить WebP**

Заменить расширение в двух существующих импортах, создать одинаковую статическую копию и удалить обе старые PNG-копии из текущих исходников. Утверждённый PNG остаётся доступным в истории Git.

```ts
// LandingApp.tsx
import brandLogo from './assets/brand-logo-horizontal-color.webp'
// CustomerLanding.tsx
import brandLogo from '../landing/assets/brand-logo-horizontal-color.webp'
```

- [x] **Step 3: проверить и оформить изменения**

Run: `npm run typecheck && npm run test:frontend && npm run build` в `deployment/dev-landing`.
Expected: код 0; оба лендинга загружают новый логотип, сохраняют пропорцию 8:3 и прежние размеры элементов; независимое ревью не содержит блокирующих замечаний.

```sh
git add deployment/dev-landing/src/landing/LandingApp.tsx deployment/dev-landing/src/customers/CustomerLanding.tsx deployment/dev-landing/src/landing/assets/brand-logo-horizontal-color.webp deployment/dev-landing/static/landing-assets/brand-logo-horizontal-color.webp docs/superpowers/plans/2026-10-01-proj-144-logo-optimization.md
git commit -m 'perf(PROJ-144): optimize trading system logo'
git push origin codex/PROJ-144-sync-landings
```

- [x] **Step 4: опубликовать и проверить стенд**

Сравнить действующие HTML-входы с исходной сборкой, сохранить резервные копии, загрузить изменённые ресурсы и заменить HTML-входы последними. Проверить обе страницы, публичный файл с авторизацией, `image/webp` и SHA-256. Обновить описание PR №4, проверить его в GitHub-вкладке PROJ-144 и прикрепить PR к текущему чату.

Expected: оптимизированный логотип опубликован, измеренное снижение массы записано, новый коммит присутствует в GitHub, связь с задачей подтверждена.

## Проверка подготовленного изменения

- Исходный PNG: 1 373 023 байта, 2048×768; WebP: 69 606 байт, 640×240. Снижение массы 94,93%, в 19,73 раза.
- SHA-256 WebP: `2a908e49dfcb6df3d7a1ad85691ba310eb96ac2fdde86bdc27a78b0e9322ed6e`; исходная, статическая и сборочная копии одинаковы.
- Декодированные пиксели WebP полностью совпадают с эталоном, уменьшенным до 640×240 до кодирования.
- Проверка типов, 23 теста интерфейса в 6 файлах и сборка прошли с кодом 0; `git diff --check` не содержит ошибок.
- Обе страницы проверены в iab при ширине 1280 px и 390 px (DPR 3): оба логотипа загружаются, горизонтального переполнения нет, пропорции и CSS-размеры сохранены.
- Независимое ревью: 0 критических, 0 важных и 0 малых замечаний; публикация разрешена результатом ревью.

## Результат публикации

- Коммит изменения: `73e611f418cfcf428b6ee064bea5fd4f9475dfba`, отправлен в GitHub, включён в [PR №4](https://github.com/mcvvvnukova-bit/forum/pull/4).
- Стенд: [общая страница](https://dev.astforum.ru/) и [страница заказчика](https://dev.astforum.ru/customers/). Обе страницы проверены после публикации: по два логотипа с разрешением 640×240 и новым URL, горизонтального переполнения нет.
- Публикация затронула только 7 сборочных файлов: два HTML-входа и пять ресурсов. 172 других файла стенда сохранили свои хеши. Ресурсы опубликованы до HTML; прежние сборочные ресурсы сохранены.
- Резервная копия: `/opt/outline/backups/proj-144-logo-opt-20261001-73e611f`, манифест `result.json`; для отката восстановить два HTML-входа из подкаталога `files`.
- Проверка публичного HTTPS с авторизацией: обе страницы вернули статус 200 и новые JS-входы; WebP вернулся со статусом 200, `Content-Type: image/webp`, 69 606 байт и ожидаемым SHA-256.
- Описание PR обновлено с результатами оптимизации, существующие ссылки на задачи и архивный PR №10 сохранены. Во вкладке GitHub [PROJ-144](https://roadmap.astforum.ru/projects/PROJ/work_packages/PROJ-144/github) присутствует PR №4 с обновлением от 01.10.2026 14:27.
- Скриншоты опубликованных страниц и JSON-проверки сохранены в `artifacts/frontend/2026-10-01-logo-optimized` локального рабочего пространства.
