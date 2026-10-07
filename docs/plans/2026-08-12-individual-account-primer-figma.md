# Individual Account Primer Figma Implementation Plan

Исторический технический план от 2026-08-12. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Происхождение: `docs/superpowers/plans/2026-08-12-individual-account-primer-figma.md`, SHA-256 `5c51c444d45b823bc6771d2d0200a29db8b4f09984e8be0b252555ef1dd4df2c`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать на странице Figma `ЛК физ лица` рабочий desktop-экран кабинета полностью верифицированного физического лица, вошедшего через Сбер ID и работающего как исполнитель услуг.

**Architecture:** Один корневой Auto Layout frame `Desktop / ЛК физлица / Обзор` размером `1440 × 1100` создаётся на пустой странице `108:73`. Оболочка, секционные контейнеры и сетки компонуются вручную, а UI-примитивы импортируются из официальных библиотек Primer Web, Primer Primitives и Octicons; брендовые значения привязываются только к семантическим переменным коллекции `Forum` в режиме `Light`, с Primer Light fallback для отсутствующих или небезопасных сопоставлений.

**Tech Stack:** Figma Design file `WT2IPB0eHD9ULCPENEktwp`, Figma Plugin API через `use_figma`, `get_design_context`, `get_libraries`, `search_design_system`, официальные Figma-библиотеки Primer, переменные `Forum / Light`.

## Global Constraints

- Target file: `WT2IPB0eHD9ULCPENEktwp`.
- Target page: `ЛК физ лица`, node `108:73`.
- Output frame: `Desktop / ЛК физлица / Обзор`, `1440 × 1100` px.
- Пользователь: `Алексей Смирнов`, вход через Сбер ID, статус `Личность подтверждена`.
- Роль: физическое лицо — исполнитель только заказов на услуги.
- Не показывать функции заказчика, материалы, аренду техники, финансовую аналитику и внутренний рейтинг.
- Primer — единственная UI-система; системные иконки — только Octicons.
- Light mode only. Любой dark, night, auto/system или другой не-Light режим отклоняется.
- Брендовые значения — только из коллекции `Forum`, режим `Light`; не выводить значения по визуальному сходству.
- Не detach библиотечные instances и не создавать параллельную библиотеку UI-примитивов.
- Контейнеры связанных элементов используют Auto Layout.
- Каждая запись в Figma выполняется небольшими атомарными вызовами и возвращает все созданные или изменённые node IDs.
- После каждой крупной секции выполняется визуальная проверка; ошибки исправляются до продолжения.

---

## File and State Map

- Reference spec: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-lichnyj-kabinet-fizicheskogo-lica-v-primer-d6823101-eN7OT0ygcA) — утверждённые требования.
- Implementation plan: `docs/plans/2026-08-12-individual-account-primer-figma.md` — порядок реализации.
- Figma source: file `WT2IPB0eHD9ULCPENEktwp`, page `108:73` — пустая целевая страница.
- Figma output: frame `Desktop / ЛК физлица / Обзор` на page `108:73`.
- Existing brand component candidate: key `0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac`; использовать только после проверки имени и назначения.

Runtime interface:

```ts
type LibraryAsset = {
  libraryKey: string
  componentKey: string
  isComponentSet: boolean
  sampleVariant: string
  propertyKeys: Record<string, 'TEXT' | 'VARIANT' | 'BOOLEAN' | 'INSTANCE_SWAP'>
}

type IndividualAccountAssetMap = {
  pageHeader: LibraryAsset
  navList: LibraryAsset
  navListGroup: LibraryAsset
  navListItem: LibraryAsset
  button: LibraryAsset
  label: LibraryAsset
  avatar: LibraryAsset
  actionList: LibraryAsset
  actionListItem: LibraryAsset
  link: LibraryAsset
}

type ForumMapping = {
  primerRole: string
  forumVariableName: string
  variableId: string
  modeName: 'Light'
  status: 'accepted' | 'rejected' | 'missing' | 'ambiguous'
  fallback: string | null
  evidence: string
}
```

## Task 1: Complete the read-only Figma and library preflight

**Files:**
- Read: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-lichnyj-kabinet-fizicheskogo-lica-v-primer-d6823101-eN7OT0ygcA)
- Read: `docs/plans/2026-08-12-individual-account-primer-figma.md`
- Inspect: Figma file `WT2IPB0eHD9ULCPENEktwp`

**Interfaces:**
- Consumes: target page ID, Global Constraints.
- Produces: page snapshot, `IndividualAccountAssetMap`, official library keys, text/effect style keys, `ForumMapping[]`, verified product font family.

- [x] **Step 1: Confirm Code Connect sources are unavailable locally**

Run:

```bash
rg --files | rg '\.figma\.(ts|tsx|js)$|\.kt$|\.swift$'
rg -n 'FigmaConnect|figma\.connect|figma\.com/design' \
  --glob '*.figma.ts' --glob '*.figma.tsx' --glob '*.figma.js' \
  --glob '*.kt' --glob '*.swift' .
```

Expected: no Code Connect files or mappings for the required components. Record Step 2a-i from `figma-generate-design` as `N/A: no matching Code Connect sources in the workspace`.

- [x] **Step 2: Load mandatory execution guidance**

Load `figma-use`, `figma-generate-design`, `primer-design-system`, `figma-design-to-code`, and the references required by those skills before the corresponding Figma calls. Read the `gotchas`, component, variable, text-style, effect-style, product-font, and validation references needed by this plan.

Expected: every `use_figma` call will include `skillNames: "figma-use,figma-generate-design"`; `get_design_context` is called only after loading its mandatory prerequisite skill.

- [x] **Step 3: Inspect the target page and capture design context without writing**

Call `get_design_context` for file `WT2IPB0eHD9ULCPENEktwp`, node `108:73`. Then run a read-only `use_figma` call:

```js
const targetPage = await figma.getNodeByIdAsync('108:73')
if (!targetPage || targetPage.type !== 'PAGE') {
  throw new Error('Target page 108:73 was not found or is not a PAGE')
}
await figma.setCurrentPageAsync(targetPage)

return {
  page: {
    id: targetPage.id,
    name: targetPage.name,
    childCount: targetPage.children.length,
    children: targetPage.children.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
  },
}
```

Expected: page name `ЛК физ лица`; no existing output frame with the exact name `Desktop / ЛК физлица / Обзор`. Existing-screen component discovery is recorded as `N/A` when `childCount === 0`.

- [x] **Step 4: Discover official libraries**

Call `get_libraries` with the target file key and follow `libraries_available_to_add_next_offset` until all organization-library pages are inspected. Resolve exact library keys for official Primer Web, Primer Primitives, and Octicons by name, publisher, and description.

Expected: all three official libraries are identifiable. If Primer Web is unavailable, stop without canvas writes and report the missing library.

- [x] **Step 5: Resolve required Primer assets**

Only after Steps 1, 3, and 4, call `search_design_system` scoped to the official Primer library keys for these queries:

```text
PageHeader
NavList
NavList Group
NavList Item
Button
Label
StateLabel
Avatar
ActionList
ActionList Item
Link
```

Build `IndividualAccountAssetMap` from official results. When both `Label` and `StateLabel` exist, choose the component whose semantics support success, warning, neutral, and selected states without detachment.

Expected: every asset required for interactive controls and status labels resolves to an official key. If an optional high-level composition such as `PageHeader` or `ActionList` is unavailable, record the nearest composition from lower-level official Primer components; do not recreate a Primer primitive.

- [x] **Step 6: Inspect component variants and properties without leaving artifacts**

In one atomic `use_figma` call, import resolved components, create temporary instances, read `componentProperties`, nested instance properties, variant names, remote status, and exposed text fields, then remove every temporary instance before return.

Return:

```js
return {
  assetMap,
  temporaryNodeIdsRemoved,
  unresolvedTextCapabilities,
}
```

Expected: imported Primer main components have `remote === true`; all Russian labels can be set through `setProperties()` or font-safe text overrides within linked instances. If a required label cannot be assigned without detachment, stop before writing.

- [x] **Step 7: Inspect `Forum / Light`, Primer variables, styles, and fonts**

Use read-only inspection for local collection `Forum` and exact mode `Light`. Search official libraries for variables using separate queries `background`, `foreground`, `border`, `accent`, `success`, `warning`, `space`, `radius`; search styles using `heading`, `body`, `caption`, `shadow`.

Build explicit `ForumMapping[]` for:

```text
canvas.background
surface.default
surface.subtle
border.default
foreground.default
foreground.muted
action.primary
navigation.selected
status.success
status.warning
focus.indicator
```

Inspect available fonts and the fonts used by official Primer instances. Use the official component font as the product font unless `Forum / Light` explicitly maps typography to another available family.

Expected: collection name and mode are exact. Missing, ambiguous, or unsafe mappings use Primer Light and are recorded rather than inferred.

Execution result:

- Code Connect: `N/A`; matching sources are absent from the workspace.
- Target page: `108:73`, `ЛК физ лица`, zero children before implementation.
- `get_design_context`: unavailable for the empty page because Figma requires a selected layer; no design context was inferred from the blank canvas.
- Library: `Primer Web (Community)` is linked. Separate Primer Primitives and Octicons libraries are not listed, but Primer semantic variables and the official `Icon` Octicon component are available inside the linked Primer library.
- Product font: Primer instances use `SF Pro Display` and `SF Pro Text`; `SF Mono` occurs only in code-oriented description content that is not used by this screen.
- Brand source: exact collection `Forum` is absent. Local collection `FORUM / Dashboard Tokens` is not accepted as the authorized source, so all branded mappings are marked missing and the canvas uses explicit Primer `light` mode.
- Logo: local component `Brand / Logo / Horizontal / Color` at node `27:175`; cross-page instances are created from this component ID, not imported by key.

## Task 2: Create the responsive desktop shell

**Files:**
- Modify: Figma page `108:73`

**Interfaces:**
- Consumes: target-page snapshot, accepted `ForumMapping[]`, Primer variables/styles.
- Produces: `rootFrameId`, `headerRegionId`, `bodyRegionId`, `sidebarRegionId`, `contentRegionId`.

- [x] **Step 1: Re-check idempotency immediately before writing**

Run a read-only lookup for a top-level frame named `Desktop / ЛК физлица / Обзор`.

Expected: no match. If a match exists, stop and report its node ID instead of creating a duplicate.

- [x] **Step 2: Create the root frame only**

Create one vertical Auto Layout frame, name it `Desktop / ЛК физлица / Обзор`, resize to `1440 × 1100`, set `clipsContent = true`, apply the accepted canvas-background variable, and place it in clear space on page `108:73`. Set `placeholder = true` until all sections are complete.

Return:

```js
return { createdNodeIds: [root.id], rootFrameId: root.id }
```

Expected: exactly one top-level frame, correct size and name, no overlap with existing page children.

- [x] **Step 3: Add shell regions inside the root**

Create `Header`, `Body`, `Sidebar`, and `Main content` as Auto Layout frames directly in their final parents. Use accepted spacing, surface, and border variables. The body is horizontal; the sidebar and main content are vertical. Append before setting child `FILL` sizing.

Return all four created IDs.

Expected: header spans the root width; body fills remaining height; sidebar remains fixed-width; main content fills remaining width; no absolute child positioning.

- [x] **Step 4: Validate the shell**

Read back the hierarchy and capture screenshots of the root and body.

Expected: `1440 × 1100`, no overlap, no clipping, correct Light surfaces, and four regions in the intended hierarchy.

## Task 3: Build the authenticated header and capability navigation

**Files:**
- Modify: Figma regions from Task 2

**Interfaces:**
- Consumes: `headerRegionId`, `sidebarRegionId`, `IndividualAccountAssetMap`, verified brand component key.
- Produces: header instance IDs, nav group/item IDs, `activeNavItemId`.

- [x] **Step 1: Verify and place the Forum logo**

Import component key `0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac`. Assert that its name identifies the Forum horizontal logo before creating an instance. If the key is unavailable or names a different asset, search the target file for an existing Forum logo component and report the fallback source.

Expected: one linked logo instance; no rasterized or redrawn logo.

- [x] **Step 2: Place authenticated-user controls**

Place official Primer instances for:

```text
Сбер ID
Алексей Смирнов
Помощь
Ссылка профиля / меню аккаунта
```

Use a success-capable Primer label for `Сбер ID`, an official Avatar, and official Primer links for help and the profile/menu entry. Set text through discovered component-property keys or font-safe overrides when the remote component font is unavailable.

Expected: all controls remain linked; text is fully visible; status does not compete visually with the primary page action.

- [x] **Step 3: Place navigation groups and items**

Create official Primer navigation instances with this exact copy:

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Set `Обзор` to the official current/selected state. Use Octicons exposed by the component or official INSTANCE_SWAP properties; do not draw icons manually.

Expected: only `Обзор` is selected; group headings and all seven items are readable and keyboard-order compatible.

- [x] **Step 4: Validate header and navigation**

Capture separate high-resolution screenshots of `Header` and `Sidebar`; read back instance `mainComponent` keys and text.

Expected: no detached instances, placeholders, clipped Russian text, duplicated active states, or non-Octicon system icons.

## Task 4: Build the overview header and metrics

**Files:**
- Modify: `contentRegionId`

**Interfaces:**
- Consumes: `contentRegionId`, Primer header/button/label assets, accepted semantic mappings.
- Produces: `overviewHeaderId`, `metricsSectionId`, three metric-item IDs.

- [x] **Step 1: Create the overview heading section**

Compose an official Primer heading/header pattern with exact copy:

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Place an official primary Button labeled `Найти заказ` in the action slot or aligned action area. Use a success label for verification.

Expected: heading, description, status, and action form one clear section; no raw interactive primitives.

- [x] **Step 2: Create three metric items**

Use the nearest official Primer card/action-list composition for:

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Use a three-column desktop arrangement with semantic heading/body styles and accepted surface/border/spacing variables.

Expected: values dominate labels, all items share the same structure, and no hard-coded visual literals remain where tokens are available.

- [x] **Step 3: Validate overview and metrics**

Capture screenshots of the overview heading and metrics section; inspect font families and bindings.

Expected: exact Russian copy, correct product font, no clipped lines, primary action uses accepted `action.primary` mapping or documented Primer Light fallback.

## Task 5: Build attention, matching orders, and recent responses

**Files:**
- Modify: `contentRegionId`

**Interfaces:**
- Consumes: official ActionList, Label, Link, Button, and Octicon assets.
- Produces: `attentionSectionId`, `matchingOrdersSectionId`, `recentResponsesSectionId` and row instance IDs.

- [x] **Step 1: Create the attention section**

Use a Primer warning-capable composition with exact content:

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Represent the recommendation with an attention label, text, and a secondary action rather than color alone.

Expected: one actionable item; no unsupported ability to edit or withdraw a submitted response.

- [x] **Step 2: Create the matching-orders list**

Use official ActionList items or the nearest Primer list composition for:

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-individual-account-primer-figma-implementation-plan-5c51c444-RMfXNmFeQ4).

Add a Primer Link labeled `Все заказы`. Use service-related Octicons only when the official instance exposes an icon property.

Expected: rows are scannable, region and deadline are visible, and there are no materials or equipment-rental items.

- [x] **Step 3: Create the recent-responses list**

Use official Primer list items and status labels for:

```text
Монтаж светильников в офисе | сегодня, 10:24 | На рассмотрении
Сборка кухни | 11 августа | Приглашение
```

Add a Primer Link labeled `Все отклики`. Do not add edit, duplicate, or withdraw actions.

Expected: status uses text plus semantic treatment; dates and titles remain visible without truncating essential information.

- [x] **Step 4: Validate each content section separately**

Capture high-resolution screenshots of attention, matching orders, and recent responses. Read back every text node and instance key.

Expected: no placeholder text, overlap, clipped descenders, unsupported controls, or detached components.

## Task 6: Add adaptive-state annotations and complete validation

**Files:**
- Modify: Figma page `108:73`
- Update: `docs/plans/2026-08-12-individual-account-primer-figma.md` checkboxes during execution

**Interfaces:**
- Consumes: completed root and section IDs, `ForumMapping[]`.
- Produces: final validated frame, annotation node IDs, audit report.

- [x] **Step 1: Add a concise responsive annotation beside the desktop frame**

Create an annotation section outside the root frame with exact behavior notes:

```text
Tablet: боковая навигация сворачивается; контент остаётся в одной основной колонке.
Mobile: навигация открывается как drawer; показатели и списки складываются в одну колонку.
Focus order: header → navigation → page action → metrics → attention → orders → responses.
```

Use an available Figma annotation mechanism or a non-interactive note frame styled through accepted Primer/Forum tokens. The annotation is documentation, not a product UI primitive.

Expected: annotation does not overlap the product frame and is clearly excluded from the runtime screen.

- [x] **Step 2: Remove progress shimmers and validate hierarchy**

Set `placeholder = false` on every completed section. Read back the root hierarchy, dimensions, text contents, component keys, remote/local status, and bound variables.

Expected: no remaining placeholder/shimmer state; root is `1440 × 1100`; all UI instances resolve to official Primer except the verified Forum logo.

- [x] **Step 3: Assert font and semantic-token compliance**

Read every text node under the root, collect font family/style, and separate free-standing text from design-system-governed text. Read all variable bindings and produce the final `ForumMapping[]` table with accepted, rejected, missing, and ambiguous rows.

Expected: no accidental Inter fallback when another product font is explicitly mapped; no color, typography, spacing, or radius is visually inferred from screenshots; non-Light modes are absent.

- [x] **Step 4: Perform visual validation at full view and section level**

Capture the complete root at high resolution and individual screenshots for header, sidebar, overview, metrics, attention, orders, and responses.

Expected: no overlap, clipping, placeholders, inconsistent alignment, wrong variants, blank icons, detached content, or unexplained empty regions.

- [x] **Step 5: Record manual and unverified checks**

Report:

```text
Figma library linkage: passed or exact limitation
Forum / Light branding: verified, partial, or unavailable
Primer fallbacks: exact roles and reasons
Rejected mappings: exact roles and reasons
Desktop visual layout: passed or exact defect
Tablet/mobile behavior: annotated, not interactively tested
Keyboard/focus behavior: specified, not executable in a static mockup
Screen-reader semantics: intended through Primer components, not executable in a static mockup
Contrast: checked where token values are inspectable; otherwise unverified
```

Expected: no unavailable check is reported as passed.

- [x] **Step 6: Save and commit the completed plan state**

Run:

```bash
git add docs/superpowers/plans/2026-08-12-individual-account-primer-figma.md
git diff --cached --check
git commit -m "docs: complete individual account Figma plan"
```

Expected: only the plan checkbox/status updates are included in this commit; unrelated workspace changes remain untouched.

Execution audit:

- Figma output: frame `240:86`, `Desktop / ЛК физлица / Обзор`, `1440 × 1100`.
- Responsive/handoff annotation: frame `250:257`, positioned outside the product frame.
- Figma library linkage: official `Primer Web (Community)` components and semantic variables are linked; the verified Forum logo remains a linked local instance from node `27:175`.
- Forum / Light branding: unavailable. The similarly named local collection `FORUM / Dashboard Tokens` was rejected as an unauthorized substitute.
- Primer fallback: explicit Primer `light` mode, official Primer semantic variables, and official component typography metrics.
- Font fallback: unavailable `SF Pro Text` / `SF Pro Display` instance fonts were replaced by available `SF Pro` styles without detaching instances.
- Desktop visual layout: passed at `1440 × 1100`; automated bounds audit reported `outsideCount: 0`.
- Instance integrity: `65` linked instances, `0` detached; the only local instance is the verified Forum logo.
- Typography integrity: `45` product-frame text nodes, `0` missing fonts.
- Token audit: no unbound solid fills were found on manually created product-frame containers.
- Tablet/mobile behavior: annotated, not interactively tested.
- Keyboard/focus behavior: specified in the annotation, not executable in a static mockup.
- Screen-reader semantics: intended through Primer components, not executable in a static mockup.
- Contrast: inherited from inspectable Primer Light semantic tokens; custom Forum mapping remains unverified because the exact collection is missing.
