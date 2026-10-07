# Profile Six-Block Grid Implementation Plan

Исторический технический план от 2026-08-13. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-profile-six-block-grid-implementation-plan-8ca459c6-B6hQWKjMYX).

Происхождение: `docs/superpowers/plans/2026-08-13-profile-six-block-grid.md`, SHA-256 `8ca459c6c7c7ea17c0f2f8749f7f492b025bfb002f0a534d0ce9ef614665a792`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить профиль физического лица в Figma в двухколоночную сетку из шести блоков Primer с порядком `Личные данные / Паспорт`, `Адреса / ИНН`, `Контакты / СНИЛС`.

**Architecture:** Существующие remote-инстансы Primer `DataTable` остаются источником визуального примитива. Текущий блок `Документы` превращается в `Паспорт`, а ИНН и СНИЛС переносятся в отдельные новые remote-инстансы того же компонента; прозрачные layout-фреймы задают три строки и не создают собственных визуальных поверхностей.

**Tech Stack:** Figma Plugin API через `use_figma`, Primer Web (Community), `Forum / Light`, SF Pro.

## Global Constraints

- Figma file: `WT2IPB0eHD9ULCPENEktwp`; page: `108:73`; profile frame: `309:232`.
- Использовать только remote-компоненты Primer; не создавать локальные компоненты и не detach существующие instances.
- Сохранять двухколоночную desktop-сетку шириной `1096` px с колонками по `536` px и промежутком `24` px.
- Layout-фреймы должны оставаться прозрачными, без fills и strokes.
- Порядок строк: `Личные данные / Паспорт`, `Адреса / ИНН`, `Контакты / СНИЛС`.
- Паспорт содержит только номер паспорта, кем выдан, дату выдачи и код подразделения.
- ИНН содержит значение `770123456789`; СНИЛС содержит значение `123-456-789 01`.
- Все значения доступны только для чтения и отображаются полностью.

---

### Task 1: Перестроить тематические блоки профиля

**Files:**
- Modify: Figma node `309:232` in file `WT2IPB0eHD9ULCPENEktwp`
- Reference: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-profil-fizicheskogo-lica-iz-sber-id-v-figma-269095c9-B67Z8UL0Zo)

**Interfaces:**
- Consumes: remote Primer `DataTable` component key `ce625484ac303f1b4a42a290835e61fe8b9c67ed`; remote Primer `Heading` instances; existing profile data.
- Produces: six visible remote Primer `DataTable` instances arranged in three transparent two-column rows.

- [ ] **Step 1: Inspect current profile nodes**

  Use one read-only `use_figma` call on page `108:73` to resolve the current IDs of the six semantic sections, their headings, DataTable instances, layout parents, visible text, dimensions, and main-component keys. Confirm that the existing four DataTables are remote and linked to component key `ce625484ac303f1b4a42a290835e61fe8b9c67ed`.

- [ ] **Step 2: Create the new row structure**

  In one atomic `use_figma` write call, preserve or create three transparent horizontal auto-layout rows inside grid `311:297`. Set each row to width `1096`, gap `24`, hug height, no fill, and no stroke. Reparent the semantic sections into the exact order `Личные данные / Паспорт`, `Адреса / ИНН`, `Контакты / СНИЛС`.

- [ ] **Step 3: Convert documents and create identifier sections**

  Rename the existing `Документы` heading and section to `Паспорт`; keep only rows `Паспорт РФ`, `Кем выдан`, `Дата выдачи`, `Код подразделения`. Create two instances directly from the remote Primer DataTable component for `ИНН` and `СНИЛС`, override unavailable library fonts to `SF Pro` before insertion, hide unused headers/footer/rows, and add remote Primer `Heading` instances by cloning an existing remote heading and changing only its text override.

- [ ] **Step 4: Reflow and preserve full values**

  Set each DataTable to width `536`; use a fixed `176` px label column and a fill value column. Collapse hidden rows from component height, set each section to hug content, then set every row and grid to hug the tallest child without adding a visual background.

- [ ] **Step 5: Run fresh structural verification**

  Use a read-only `use_figma` call to assert: six DataTables exist; all six main components are remote with key `ce625484ac303f1b4a42a290835e61fe8b9c67ed`; six headings remain remote; no visible text equals `Документы`; INN and SNILS occur exactly once in their respective sections; all three row frames have empty fills/strokes; no local component or detached instance was created.

- [ ] **Step 6: Run visual verification**

  Render node `309:232` at `1440 × 1100`, inspect the three-row order, full address/passport/identifier values, alignment, grid gaps, note position, and absence of clipping or unexpected white surfaces. If any text clips, adjust only column sizing or font override within the linked instance and repeat both structural and visual checks.

- [ ] **Step 7: Report the result**

  Return the updated Figma link to node `309:232`, list the six block names in row order, and report remote-component, branding, clipping, and layout verification results.
