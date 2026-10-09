# PROJ-163 — Настройки личного кабинета: Implementation Plan

> Выполнить в текущем чате по gitnexus-work, с проверками влияния и ревью до коммита.

**Goal:** Один сохраняемый checkbox для включения и выключения личного участия исполнителем.

**Architecture:** Общая оболочка ProfilePage получает отдельное представление settings. SettingsSection читает и изменяет состояние через защищённый API; SettingsStore управляет личным правом provider в PostgreSQL-транзакции. Аккаунт и корпоративные права независимы.

**Tech Stack:** Node.js 24, TypeScript, Nest/Fastify, PostgreSQL, React 19, Primer React 38.37.

## Constraints

Задача PROJ-163, автор OpenProject Кузьмина, отдельный worktree и ветка. Только Primer Light и существующие семантические токены. Не менять production, сторонние worktrees и демонстрационные данные. Окончательно сверить модель ролей PROJ-161 перед интеграционными проверками.

## 1. Защищённая настройка

Files: создать `apps/api/src/iam/settings-store.ts`, `apps/api/test/settings.test.ts`; изменить регистрацию нового контроллера в `apps/api/src/app.ts`; отдельный `apps/api/src/iam/settings.controller.ts`.

Interfaces: `SettingsStore.read(token): Promise<{userId:string,workAsIndividual:boolean}>`; `SettingsStore.update(token,enabled)` с тем же результатом. Владельца определяет хеш сессионного токена; запрос не принимает userId.

- [x] Тест до реализации: GET `/api/settings` владельца получает 200 и false, PUT true возвращает true, право provider фактически работает, PUT false отзывает его, GET profile/session остаётся доступен. На исходном коде маршрут отвечает 404.
- [x] Проверить 401/Origin/лишние поля, двух владельцев, идемпотентность/конкуренцию, ограничения и откат при отказе аудита на выделенной локальной БД `_test`.
- [x] Реализовать минимальную транзакцию с блокировкой пользователя и текущей сессии. Включать только собственное личное право, сохранять историю и аудит, не снимать ограничения администратора.
- [x] `npm run test --workspace @astforum/api`, `npm run typecheck --workspace @astforum/api`.

## 2. Страница

Files: создать `apps/web/src/home/SettingsSection.tsx`, `apps/web/src/home/settings.test.tsx`; изменить `apps/web/src/home/Cabinet.tsx`, `apps/web/src/home/App.tsx`, `apps/profile-preview/src/ProfilePage.tsx`.

Interfaces: `SettingsSection({userId,onExpired})`; общая оболочка поддерживает settings content только рабочего аккаунта.

- [x] Тест до реализации: `/cabinet/settings/` показывает heading и ровно один checkbox; до завершения PUT состояние не считается сохранённым, после reload сохраняется.
- [x] Проверить неопределённый ответ PUT через повторное GET, ошибку и retry, истёкшую сессию, отказ чужого userId; реальные Primer-компоненты с подменой только сетевых ответов.
- [x] Добавить settings view и ссылку обоих меню, не загружать профиль для настройки. Использовать Checkbox/FormControl/Spinner/Banner.
- [x] `npm run test --workspace @astforum/web`, `npm run test --workspace @astforum/profile-preview`, typecheck/lint/build обоих пакетов; Primer validator.

## 3. Доставка и проверка

Files: `scripts/deployment/build-web-release.mjs`, схема/владение маршрутом в `deployment/release-manifest.schema.json`, `apps/dev-gateway/forum_dev_auth.py` и gateway tests; необходимый следующий слой operational provenance и его негативные проверки.

- [x] Разрешить исключительно новый HTML-маршрут и `/api/settings` GET/PUT в существующей границе шлюза. Добавить tests с исходным отказом и разрешением после реализации.
- [x] Проверить built site с клавиатурой, reload/history/error на 320/390/768/1440 и визуально в Codex IAB.
- [ ] Пройти layout/provenance, relevant API/web/preview/gateway tests, typecheck/lint/build и Primer. Сверить финальную зависимость PROJ-161 и ревью прав.
- [x] Stage только файлы этой задачи → detect_changes → commit PROJ-163 → push → PR с OP#PROJ-163 и OP#PROJ-5 → проверить вкладку GitHub и attach_artifact. Первые коммиты опубликованы в PR #33, связь с PROJ-163 и PROJ-5 проверена. После проверки слоя provenance обновить PR финальным коммитом.

## Проверенные результаты

- API настройки: 11 интеграционных сценариев с реальным PostgreSQL, включая повторный вход, конкурентные запросы, корпоративные права, административные ограничения и откат транзакции.
- Web: 103 теста; profile-preview: 16; dev gateway: 12. Typecheck/build и проектная проверка Primer прошли.
- Локальная проверка в Codex IAB: один checkbox, сохранение и перечитывание, клавиатура, история, отсутствие горизонтального переполнения на 320/390/768/1440 px.
- Сборка точного коммита и девять проверок переключения/отката веб-релиза прошли локально. Публикация на dev/production не выполнялась.
- Финальные общие проверки и CI выполняются после включения исправлений зависимости PROJ-161 и собственного слоя provenance.
