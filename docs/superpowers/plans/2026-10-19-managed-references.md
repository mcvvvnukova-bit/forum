# PROJ-179: Управление семью справочниками

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Администратор может просматривать, добавлять, изменять и мягко удалять значения семи справочников; модератор управляет причинами отклонения.

**Spec:** https://docs.astforum.ru/doc/adm02-upravlenie-spravochnikami-2oPkIZ6rH9, раздел «Управление семью справочниками — 19.10.2026»; https://roadmap.astforum.ru/work_packages/PROJ-179.

**Architecture:** Закрытый реестр семи типов задаёт таблицы и поля. Отдельная аддитивная миграция сохраняет существующие коды/FK; транзакционный store проверяет текущие роли, CSRF, версию и идемпотентность. Общий компонент Primer обслуживает семь отдельных маршрутов и форм.

**Tech Stack:** Node 24, PostgreSQL, Nest/Fastify, React 19, Primer 38, TypeScript, Vitest, node:test, Python unittest.

## Global Constraints

- Семь типов: regions, offer-types, business-segments, commercial-roles, units, rejection-reasons, company-statuses. ОКВЭД2/ОКПД2 не меняются.
- Только deleted_at/deleted_by; физического удаления, восстановления и повторного использования кода нет.
- Код неизменяем, название обязательно; текущие значения не перенумеровываются. Пустые справочники заполняются через формы.
- Роль администратора разрешает все семь, роль модератора только причины отклонения. Проверка роли на каждом запросе.
- Мутации: Origin, CSRF, Idempotency-Key; PATCH/DELETE: If-Match, конфликт версии 412. Аудит атомарен.
- Primer Light, отдельный экран на справочник, раскрывающийся пункт левого меню, мобильная и клавиатурная доступность.
- Базовый commit ab3e812d6fb37d54850f7e3098d2ce397c6d125b; ветка codex/PROJ-179-managed-references. PR связан с OP#PROJ-179, OP#PROJ-22, OP#PROJ-87, OP#PROJ-88.
- Dev входит в выпуск, production не входит. Существующие workers и расписания не меняются.

### Task 1: Миграция, API и права

**Files:** Create `apps/api/src/references/managed-{model,store,migrate}.ts`, `managed.controller.ts`, `managed-cli.ts`, `apps/api/migrations/references/002_managed_references.sql`, обратную миграцию, `apps/api/test/managed-references.test.ts`, `deployment/forum-api/grant-managed-references.sql`; modify `apps/api/src/app.ts`, gateway и его тесты.

**Interfaces:** API `/api/references/managed/:dictionary[/:code]`, GET/POST/PATCH/DELETE. DTO:
```ts
type ReferenceValue={code:string;name:string;description:string|null;symbol:string|null;version:number};
type ReferencePage={items:ReferenceValue[];total:number;page:number;pageSize:50};
```
- [ ] Write real database tests first: all seven create→read→update→delete→404, underlying row retained; duplicate code including deleted→409; stale If-Match→412; idempotent retry gives one audit; moderator only reasons; invalid Origin/CSRF, revoked/expired session; literal filters and paging.
```ts
assert.equal((await create('regions',{code:'99',name:'Проверка'})).statusCode,201);
assert.equal((await remove('regions','99',1)).statusCode,200);
assert.equal((await read('regions','99')).statusCode,404);
assert.equal((await pool.query('SELECT deleted_at IS NOT NULL AS deleted FROM regions WHERE code=99')).rows[0].deleted,true);
```
- [ ] Compile and run new test; expect missing migration/controller failure. Implement closed registry, parameter validation, transaction/store, fresh authorization with shared IAM lock, no-store and sanitized errors.
- [ ] Migration creates only reference tables when absent, adds version/timestamps/deletion fields, separate ledger, reversible additions; no legacy bootstrap. Runtime grants SELECT/INSERT and column UPDATE, no DELETE/code UPDATE/DDL. Test restricted role and existing FK retention.
- [ ] Gateway permits exact managed paths/methods and forwards CSRF/idempotency/If-Match; reject unknown dictionaries, malformed code paths and extra segments. Run API and gateway tests, GitNexus detect_changes, commit `feat(PROJ-179): add managed reference API with soft deletion`.

### Task 2: Семь экранов и формы Primer

**Files:** Create `apps/web/src/home/ManagedReferenceDirectory.tsx`, its test; modify `navigation.ts`, `App.tsx`, `Cabinet.tsx`, `apps/profile-preview/src/ProfilePage.tsx`, relevant existing tests.

**Interfaces:** consumes Task 1 DTO/API; `ManagedReferenceDirectory({dictionary,csrfToken})`. Registry maps same seven slugs to Russian titles and field visibility. Sidebar accepts active dictionary and moderator capability without expanding user administration access.
- [ ] Write failing tests for separate route/title, filters, required inputs, immutable code, add/view/edit/delete dialogs, 409/412 errors, pending states, disappearance after deletion and moderator-only menu.
```tsx
expect(screen.getByRole('heading',{name:'Единицы измерения'})).toBeVisible();
fireEvent.click(screen.getByRole('button',{name:'Добавить значение'}));
expect(screen.getByRole('dialog',{name:'Добавление значения'})).toBeVisible();
```
- [ ] Run new test RED; implement shared Primer forms/list with request cancellation, idempotency key per payload, server version and explicit deletion confirmation. Deleted detail must never remain visible after successful deletion.
- [ ] Test all configured field sets, keyboard focus, mobile menu closing on child link only. Run web/profile/composition tests, typecheck and Primer policy, GitNexus detect_changes; commit `feat(PROJ-179): add seven reference management screens`.

### Task 3: Release contract and ownership

**Files:** Modify `scripts/deployment/build-web-release.mjs`, `web_release.py`, manifest schema, operational-source verifier and relevant integration tests; create successor `artifacts/repository-audits/proj-179-managed-references-ownership.json`.

**Interfaces:** consumes seven route slugs; manifest inventory 20 routes, backward-compatible rollback for old 11/12/13. Ownership successor binds changed old files and new files to base ab3e812; historic PROJ-178 receipt remains byte-identical.
- [ ] Write failing route inventory/rollback and ownership tamper tests. Test changed file bytes, paired digest modification, scope extension and modified historical receipt are rejected.
- [ ] Implement route copies/schema/publisher rollback and ownership delegation with independent canonical pin. Stage new files before fixture checks.
- [ ] Run full API/web/profile/composition, gateway, publisher, ownership and Primer checks; whole-branch fresh review, fixes RED→GREEN; GitNexus detect_changes and commit `build(PROJ-179): bind managed reference release provenance`.

### Task 4: GitHub, CI и dev

**Files:** operational scripts/evidence outside repo; live Outline and OpenProject descriptions.

**Interfaces:** consumes committed SHA, green CI artifact, API image with same OCI revision, migration and runtime grant.
- [ ] Push all commits; create PR based on PROJ-178 branch with explicit four OP codes; attach PR, verify GitHub head and OP GitHub associations.
- [ ] Wait exact-head CI, verify every required job and artifact digest/source/20-route manifest. Retain old release/ACL/config/database backups and compare target before applying.
- [ ] Migrate reference schema using owner one-shot, apply narrow runtime grants, recreate API and gateway preserving existing configuration; publish verified CI artifact via current publisher. Do not restart workers.
- [ ] In IAB prove seven screens, create/edit/view/soft-delete test values, code/name filters, desktop/mobile and keyboard. Verify database rows retained, audit recorded, classifiers/schedules/production unchanged.
- [ ] Save and reopen live requirements with PR, CI and dev evidence; set task to developed/tested according to observed verification. Final response links task/PR/dev and states any concrete remaining limitation.

## Review Focus

Check role revocation races and idempotency replay after revocation; closed SQL identifiers; stale concurrent edit/delete; scope of runtime grants; existing FK/data preservation; soft deleted records excluded from every read; aborted requests and dialog stale state; exact route allowlist and publication rollback; independent provenance pin and preserved historical receipts.
