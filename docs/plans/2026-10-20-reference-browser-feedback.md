# PROJ-179: Правки справочников по комментариям браузера

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Выполнить шесть комментариев пользователя к экрану субъектов РФ и применить тот же список и фильтры ко всем семи редактируемым справочникам.

**Spec:** Комментарии пользователя 20.10.2026: уменьшить шапку; удалить пояснение; отображать все 89 субъектов без пагинации; убрать кнопки «Найти» и «Сбросить фильтры»; фильтровать по коду и наименованию при вводе. Задача https://roadmap.astforum.ru/work_packages/PROJ-179; требования ADM.02 https://docs.astforum.ru/doc/adm02-upravlenie-spravochnikami-2oPkIZ6rH9.

**Architecture:** Существующий API по 50 строк сохраняется. Компонент загружает все страницы и показывает только полный проверенный набор; фильтрация выполняется синхронно в памяти, код — префикс с учётом регистра, наименование — подстрока без учёта регистра. После CRUD набор перечитывается с сохранением фильтров. Шапка account-brand использует существующие размеры Primer: 80px на desktop и 128px на mobile вместо 128/160px.

**Tech Stack:** React 19, TypeScript, Primer 38, Vitest, существующий издатель CI-артефактов.

## Global Constraints

- Семь маршрутов regions, offer-types, business-segments, commercial-roles, units, rejection-reasons, company-statuses; ОКВЭД2/ОКПД2 сохраняют свою загрузку и поиск.
- Нет изменений API, БД, прав, workers, расписаний и production.
- Сохраняются code-prefix и name-substring semantics, поля и подтверждение мягкого удаления, действующие роли, CSRF, версии и фокус диалогов.
- Не показывать частичный набор при ошибке любой страницы, изменившемся total, дублирующихся кодах или неполной странице. 401/403 очищают данные; unmount отменяет загрузку.
- Фильтры совместные; пробелы по краям игнорируются; пустые поля возвращают полный набор; ввод процентов/подчёркиваний рассматривается буквально.
- Ветка codex/PROJ-179-managed-references, исходный HEAD 9f0aec23ce1eccd80f8bf6c87dc015d1f9cb8386; обновить PR48 и связь OP#PROJ-179/22/87/88.

### Task 1: Полный список и компактная шапка

**Files:** modify `apps/web/src/home/ManagedReferenceDirectory.tsx`, `managed-references.test.tsx`, `cabinet.css`; refresh `artifacts/repository-audits/proj-179-managed-references-ownership.json` and its canonical pin in `scripts/verification/check-operational-sources.py`.

**Interfaces:** consumes unchanged `{items,total,page,pageSize:50}` on `/api/references/managed/:dictionary?page=N`; produces a complete `Value[]` for the same seven screens.

- [ ] First replace the submit/reset test with actual immediate filtering assertions; add a two-page fixture with 89 values and assert the last value renders without pagination. Add page2 failure and changed-total fixtures; assert no partial table survives. Run `npm test --workspace @astforum/web -- src/home/managed-references.test.tsx` and observe the intended failures.
```tsx
fireEvent.change(screen.getByLabelText(/^Код/),{target:{value:'89'}})
expect(screen.getByText('Значение 89')).toBeVisible()
expect(screen.queryByText('Значение 01')).not.toBeInTheDocument()
expect(screen.queryByRole('navigation',{name:'Страницы справочника'})).not.toBeInTheDocument()
```
- [ ] Replace query/page UI state with a complete list. Validate each page against a fixed total and expected length; reject duplicate codes. Keep one abort/timeout boundary for the entire load. Apply `startsWith(code.trim().normalize('NFC'))` and `includes(name.trim().normalize('NFC').toLocaleLowerCase('ru-RU'))` on each render. Remove description, SearchIcon, submit/reset actions and pagination; retain Add at the right of its row.
- [ ] Reduce only the account header override to Primer 80/128px and logo192/160px. Preserve two mobile rows, sidebar sticky offset and Dialog stacking. Refresh current ownership receipt; preserve historical receipts.
- [ ] Run the web suite, typecheck, lint, profile/composition suites, Primer policy/validator, layout and ownership checks. In IAB inspect desktop1497×799, tablet768×1024, mobile375×812; verify the header bounds, fields, all89 rows, clearing filters, keyboard and Add/Cancel focus.
- [ ] Run fresh GitNexus index/impact/detect_changes; stage only scoped paths and commit `fix(PROJ-179): simplify reference lists and filter while typing`.

### Task 2: CI, dev и сохранение требований

**Files:** private operational evidence; live Outline and OpenProject; PR48 description.

**Interfaces:** consumes Task1 committed SHA and green CI artifact; produces verified dev served files and saved links/results.

- [ ] Push and verify exact PR head. Perform fresh review of the delta, fix material findings with a failing regression before each fix. Run exact-head CI; use hosted Docker runners if the earlier local Docker stall persists, restoring the normal repository variable after assignment.
- [ ] Verify the CI manifest/source/digests and publish only the dev web artifact through the existing publisher, retaining rollback material. API remains at its previous verified revision because no server source changed.
- [ ] IAB: all89 region rows and no paging/actions/description; immediate positive/negative and combined filtering by code/name; clearing both restores89. Verify header, mobile menu and dialog keyboard/focus. Do not create or delete reference values for this UI-only release.
- [ ] Update root ADM.02 requirements and PROJ-179 under verified Kuzmina identity, save/reopen; PR body links four task codes, CI and dev. Verify OP GitHub associations, clean worktree, native PR attachment and leave the dev tab open.

## Review Focus

Loading page2 must not expose a partial table, loop forever or append duplicates. Fetch cancellation must prevent stale sets from replacing a new dictionary. Filters must be literal, combined, immediate and preserve the current draft after CRUD. Shared cabinet header must fit narrow widths and preserve sidebar offsets, account controls, Dialog stacking and keyboard focus.
