# Просмотр ОКВЭД2 в кабинете администратора — Implementation Plan

> **For agentic workers:** Execute inline with TDD and GitNexus impact/detect_changes gates.

**Goal:** Администратор открывает «Администрирование → Справочники» и просматривает ОКВЭД2 с поиском по коду и наименованию.

**Architecture:** Отдельная страница `/cabinet/references/okved/` использует общий кабинет и Primer Light. Read-only endpoint `/api/references/okved` читает опубликованные активные коды `public.okveds` в read-only транзакции, проверяя действующие серверные полномочия через существующий IAM. Импорт ФНС остается в PROJ-172.

**Tech Stack:** React 19, Primer 38.37, NestJS/Fastify, PostgreSQL, Vitest, node:test.

## Global Constraints

- Задача [PROJ-177](https://roadmap.astforum.ru/work_packages/PROJ-177), родитель PROJ-22.
- Основа: `7ecdb1c7`, PR #42 (не слит в main); отдельная ветка `codex/PROJ-177-okved-admin-page`. PR #43 — зависимость данных, без копирования его кода.
- Страница только для администратора платформы. Обычный пользователь, модератор, администратор компании, отозванный/истекший сеанс не получают данные.
- Фильтр «Код» ищет префикс, сохраняя нули и точки; «Наименование» — буквальное вхождение без учета регистра. Совместно AND. Пробелы по краям удаляются. Пустые поля показывают все активные коды.
- Поиск по Enter/кнопке «Найти»; сброс очищает оба поля; новое условие начинает с первой страницы. По 50 строк, стабильная сортировка по коду; счетчик результатов и предыдущая/следующая страница.
- Никаких редакторов, запуска импорта, принятия спорных версий, экспорта, ОКПД2 или публикации на сервер.
- Loading, empty, no matches, 401, 403, 503, некорректный ответ, отмена и поздний ответ не оставляют ошибочно показанные строки.
- Только существующие Primer компоненты, Octicons и семантические токены. Проверить 320/768/1440 px и клавиатуру во встроенном браузере Codex.
- Исторические receipts исходников неизменны; узкий successor фиксирует только файлы этой задачи.

### Task 1: Страница, защищенное чтение и проверяемый локальный результат

**Files:**
- Create `apps/api/src/references/okved-directory.controller.ts`, `apps/api/test/okved-directory.test.ts`.
- Create `apps/web/src/home/OkvedDirectory.tsx`, `apps/web/src/home/okved-directory.test.tsx`, `apps/web/src/home/okved-directory.css`.
- Modify `apps/api/src/app.ts`, `apps/profile-preview/src/ProfilePage.tsx`, `apps/web/src/home/Cabinet.tsx`, `apps/web/src/home/App.tsx`.
- Modify route contracts in `scripts/deployment/build-web-release.mjs`, `scripts/deployment/web_release.py`, `deployment/release-manifest.schema.json`; keep previous route variants compatible.
- Create bounded ownership receipt and regression test; extend `scripts/verification/check-operational-sources.py`.

**Interfaces:**
- Consumes `RoleStore.read(token, (client, actor) => Promise<T>)`, `effectiveRoles(client, actor.id)` and `AuthRuntime`.
- Produces `GET /api/references/okved?code=01&name=растение&page=1` → `{items:[{code:"01.11",name:"Выращивание зерновых культур"}],total:1,page:1,pageSize:50}`.
- Allowed keys are exactly `code`, `name`, `page`, once each. Code length ≤8 with digits/dots, name ≤250 without control characters, page integer 1..10000; invalid query →400. Auth 401/403; missing DB/schema/read error →503 with safe code. All responses no-store.

- [ ] Step 1: Install locked dependencies; run existing Cabinet tests as baseline. Expected: PASS.
- [ ] Step 2: Write endpoint tests using real PostgreSQL and UI tests through Cabinet before implementation. Expected: failures because endpoint/route do not exist.
- [ ] Step 3: Add controller, shared-cabinet route/nav and Primer form/table. SQL uses bound parameters and escaped LIKE literals, no writes. Expected: focused tests PASS.
- [ ] Step 4: Extend build route output, schema and publisher verification; add bounded receipt. Expected: artifact contains `/cabinet/references/okved/`, historical receipts still pass and tampering fails.
- [ ] Step 5: Run API/UI full suites, typecheck/build, Primer validator, repository checks; verify real imported data and responsive/keyboard behavior in IAB. Expected: all required checks PASS, no document-level overflow.
- [ ] Step 6: GitNexus staged detect_changes, commit with PROJ-177, push and PR targeting administration branch. Include OP#PROJ-177 and OP#PROJ-22 and dependency links; verify both OpenProject GitHub links and attach PR.

## Review focus

Server auth must use fresh DB state; UI visibility is not authorization. LIKE `%`, `_`, backslash and SQL punctuation are literal input. Abort or superseded request must not overwrite later results. Never label test session as real Sber login. Do not silently report base schema without FNS active flags as an empty current classifier. Preserve all unrelated worktrees and current dirty user plan.
