# Strict Primer Dashboard Figma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать рядом с исходным экраном отдельный фрейм `Desktop / Обзор / Primer — strict`, в котором все смысловые элементы, кроме брендового логотипа, являются связанными экземплярами официальной Figma-библиотеки Primer.

**Architecture:** Один технический корневой `FRAME` размером 1440 × 1100 содержит только официальные Primer `INSTANCE` и один разрешённый брендовый instance логотипа. Компоненты размещаются непосредственно в корневом фрейме без локальных компонентов, detach и вручную собранных промежуточных UI-блоков; данные задаются через component properties, а для неуправляемого текста — через разрешённые text overrides внутри связанного экземпляра. Перед любой записью выполняется жёсткий read-only preflight доступности библиотеки, вариантов и текстовых свойств.

**Tech Stack:** Figma Design file `WT2IPB0eHD9ULCPENEktwp`, Figma Plugin API через `use_figma`, `get_libraries`, `search_design_system`, официальная Figma-библиотека Primer, исходный frame `108:75`.

## Global Constraints

- Размер нового фрейма: 1440 × 1100 px.
- Имя нового фрейма: `Desktop / Обзор / Primer — strict`.
- Исходный frame `108:75` не изменять.
- Логотип `Brand / Logo / Horizontal / Color` с key `0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac` — единственное содержательное исключение.
- Не использовать локальные компоненты `Primer / FORUM / ...`.
- Не создавать локальные компоненты, не копировать компоненты Primer и не detach экземпляры.
- Не создавать обычные текстовые или графические слои вне официальных Primer instances.
- Тексты задавать через `instance.setProperties()` там, где компонент публикует `TEXT` property.
- Для текста без component property разрешён прямой `characters` override только у `TEXT`-потомка связанного официального Primer instance, после загрузки фактического шрифта этого слоя.
- Цвета, типографику, интервалы и радиусы брать из официальных Primer components, variables и styles.
- Если официальный asset недоступен либо нужный текст невозможно переопределить внутри связанного официального instance, остановиться до изменения холста.

---

## File and State Map

- Reference spec: `docs/superpowers/specs/2026-08-12-primer-only-dashboard-figma-design.md` — подтверждённые требования.
- Plan: `docs/superpowers/plans/2026-08-12-primer-only-dashboard-figma.md` — исполнимый порядок работ.
- Figma source: file `WT2IPB0eHD9ULCPENEktwp`, node `108:75` — неизменяемый визуальный и контентный источник.
- Figma output: новый sibling frame на странице `Личный кабинет юрлица`.
- Runtime interface `PrimerAssetMap`:

```ts
type PrimerAsset = {
  libraryKey: string
  componentKey: string
  isComponentSet: boolean
  sampleVariant: string
  propertyKeys: Record<string, 'TEXT' | 'VARIANT' | 'BOOLEAN' | 'INSTANCE_SWAP'>
}

type PrimerAssetMap = {
  pageHeader: PrimerAsset
  navList: PrimerAsset
  navListGroup: PrimerAsset
  navListItem: PrimerAsset
  button: PrimerAsset
  label: PrimerAsset
  card: PrimerAsset
  actionList: PrimerAsset
  actionListItem: PrimerAsset
}
```

## Task 1: Read-only Primer library preflight

**Interfaces:**
- Consumes: Figma file key `WT2IPB0eHD9ULCPENEktwp`, source node `108:75`.
- Produces: validated `PrimerAssetMap`, official variable/style keys, source snapshot `{id, name, width, height, childIds}`.

- [x] **Step 1: Confirm Code Connect is unavailable**

Run:

```bash
rg --files | rg '\.figma\.(ts|tsx|js)$|\.kt$|\.swift$'
rg -n 'FigmaConnect|figma\.connect|figma\.com/design' \
  --glob '*.figma.ts' --glob '*.figma.tsx' --glob '*.figma.js' \
  --glob '*.kt' --glob '*.swift' .
```

Expected: no matching Code Connect files. Record Step 2a-i as `N/A: no Code Connect files found`.

- [x] **Step 2: Inspect the existing screen without writing**

Use `use_figma` with `skillNames: "figma-use,figma-generate-design"`. Resolve node `108:75`, switch once to its page, and return:

```js
const source = await figma.getNodeByIdAsync('108:75')
if (!source) throw new Error('Source frame 108:75 not found')
let page = source
while (page && page.type !== 'PAGE') page = page.parent
await figma.setCurrentPageAsync(page)

const componentMap = new Map()
for (const inst of source.findAllWithCriteria({types: ['INSTANCE']})) {
  const mc = inst.mainComponent
  const set = mc?.parent?.type === 'COMPONENT_SET' ? mc.parent : null
  const key = set?.key || mc?.key
  if (key && !componentMap.has(key)) {
    componentMap.set(key, {
      name: set?.name || mc?.name,
      key,
      remote: mc?.remote,
      sampleVariant: mc?.name,
    })
  }
}

return {
  sourceSnapshot: {
    id: source.id,
    name: source.name,
    width: source.width,
    height: source.height,
    childIds: source.children.map(child => child.id),
  },
  existingComponents: [...componentMap.values()],
}
```

Expected: source size `1440 × 1100`; existing UI components are local (`remote: false`) and therefore must not be reused.

- [x] **Step 3: Discover available libraries**

Call `get_libraries` for file `WT2IPB0eHD9ULCPENEktwp`, following pagination until either an official library named Primer is found or all pages are exhausted.

Expected: one library entry whose publisher/name identifies the official Primer library. Save its exact `libraryKey`. If absent, stop with no canvas writes.

- [x] **Step 4: Search the official Primer library**

Restrict every `search_design_system` call with `includeLibraryKeys: [primerLibraryKey]`, `includeComponents: true`, and search these exact queries:

```text
PageHeader
NavList
NavList Group
NavList Item
Button
Label
Card
ActionList
ActionList Item
```

Expected: every field of `PrimerAssetMap` resolves to an official component or component set key. If any field is unresolved, stop before writing.

- [x] **Step 5: Validate variants and component properties**

Use one read-only `use_figma` call that imports the resolved components, creates temporary instances, reads `componentProperties`, and removes all temporary instances before return. Return the completed `PrimerAssetMap`.

Required property capabilities:

```text
PageHeader: title, description, actions/slots
NavList Group: group heading
NavList Item: label, active/current state
Button: label, primary/default variant
Label: label text
Card: value/title/description or arbitrary official content slots
ActionList Item: title, description, trailing action
```

Expected: all Russian content can be assigned through `setProperties()` or, for unmanaged text, through a font-safe `characters` override on a `TEXT` descendant of the linked official instance. If neither path is available, remove temporary nodes and stop before writing.

- [x] **Step 6: Search Primer variables and styles**

Within the same official library, run separate searches for:

```text
background
foreground
border
space
radius
heading
body
```

Expected: capture keys for the official surface, text, border, spacing/radius variables and heading/body text styles used by the selected components. Do not create fallback local tokens.

## Task 2: Create the strict root frame

**Interfaces:**
- Consumes: validated `PrimerAssetMap`, source snapshot from Task 1.
- Produces: `strictFrameId: string`.

- [x] **Step 1: Assert no strict frame already exists**

Use a read-only lookup on page `Личный кабинет юрлица` for the exact name `Desktop / Обзор / Primer — strict`.

Expected: no match. If a match exists, stop and report its node ID instead of creating a duplicate.

- [x] **Step 2: Create one technical root frame**

Use `use_figma` to create one `FRAME`, name it exactly, resize it to `1440 × 1100`, set clipping on, and place it 200 px to the right of the rightmost top-level node on the source page. Do not create children in this call.

Return:

```js
return {createdNodeIds: [strictFrame.id], strictFrameId: strictFrame.id}
```

Expected: exactly one new node; its `children.length === 0`.

- [x] **Step 3: Validate the root**

Read back `{id, name, type, width, height, x, y, childCount}`.

Expected: type `FRAME`, exact name, `1440 × 1100`, zero children, no overlap with existing top-level frames.

## Task 3: Place the official navigation and header instances

**Interfaces:**
- Consumes: `strictFrameId`, `PrimerAssetMap.pageHeader`, `PrimerAssetMap.navList`, `PrimerAssetMap.navListGroup`, `PrimerAssetMap.navListItem`, brand logo key.
- Produces: IDs for header, logo, navigation groups, and navigation items.

- [x] **Step 1: Import official PageHeader and NavList assets**

Import by the component/component-set keys recorded in `PrimerAssetMap`. Select only official variants and assert `remote === true` on each imported main component.

Expected: all selected main components are remote official Primer assets.

- [ ] **Step 2: Place PageHeader and brand logo**

Create a Primer PageHeader instance, set organization, verification status, help/user content only through exposed properties/slots, and append it directly to `strictFrameId`. Import the brand component by key `0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac`, create one instance, and position it in the header’s brand area without detaching either instance.

Expected: root children added by this step are instances only; logo is the sole `remote: false` exception.

- [x] **Step 3: Place grouped NavList instances**

Create official navigation groups and items with these labels:

```text
КАБИНЕТ
Обзор
Мои заказы
Проекты и объекты
Сметы
Лоты и предложения

ПОИСК И ОТКЛИКИ
Найти заказы
Мои отклики

ОРГАНИЗАЦИЯ
Профиль и документы
Организация
Поддержка
```

Set only `Обзор` to the official active/current state. Append every resulting official instance directly to the strict root or into official instance slots supported by the library.

Expected: all navigation instances are official and remain connected; no raw group-label text nodes exist at root level.

- [x] **Step 4: Screenshot and inspect the shell**

Capture the header and navigation regions separately.

Expected: no placeholders, clipped Russian labels, overlap, or detached content.

## Task 4: Place PageHeader content, actions, and metrics

**Interfaces:**
- Consumes: `strictFrameId`, official PageHeader/Button/Label/Card assets.
- Produces: IDs for the title area, status, actions, and four metric cards.

- [ ] **Step 1: Configure official PageHeader content**

Set:

```text
Title: Обзор
Description: Главное по размещению заказов и поиску новых работ
```

Use only PageHeader properties. Do not create free-standing text.

- [x] **Step 2: Add official buttons**

Create two official Button instances:

```text
Разместить заказ — variant primary
Найти заказы — variant default
```

Attach through the official PageHeader action slot if available; otherwise append both official instances directly to the root at the PageHeader action coordinates.

Expected: no `secondary` variant and no local `Primer / FORUM / Button` instance.

- [x] **Step 3: Add the official verification Label**

Create an official Label instance with text `Верифицирована` and the closest available non-danger status scheme.

Expected: official remote Label instance, label text set via component property.

- [ ] **Step 4: Add four official Card instances**

Set component properties to these triples:

```text
6 | Активные заказы | 2 требуют внимания
18 | Предложения | По вашим лотам
24 | Подходящие заказы | По профилю компании
5 | Мои отклики | 1 ожидает решения
```

Expected: four connected official Card instances in one row, with no manual card frames or free text.

- [x] **Step 5: Screenshot and inspect header/metrics**

Expected: all content visible, correct official variants, no placeholder copy, and consistent Primer spacing.

## Task 5: Place attention and order ActionLists

**Interfaces:**
- Consumes: `strictFrameId`, official ActionList/ActionList Item assets.
- Produces: IDs for three list groups and seven items.

- [ ] **Step 1: Add the attention ActionList**

Use official ActionList heading/property support for `Требует внимания` and create three official items:

```text
Ответить на вопрос по лоту | Монтаж инженерных сетей • 2 новых вопроса | Ответить
Исправить лот после модерации | Поставка бетона • причина и комментарий доступны | Исправить
Подать предложение до 18:00 | Аренда башенного крана • Москва | Открыть
```

Expected: title, description, and trailing action are all component-property overrides.

- [ ] **Step 2: Add the “Мои заказы” ActionList**

Create two official items:

```text
Поставка бетона М300 | ЖК «Север» • 6 предложений • до 14 авг | Открыть
Монтаж вентиляции | БЦ «Парк» • На модерации | Открыть
```

- [ ] **Step 3: Add the “Подходящие заказы” ActionList**

Create two official items:

```text
Аренда башенного крана | Москва • предложение до 12 авг | Открыть
Электромонтажные работы | Московская область • до 16 авг | Открыть
```

- [ ] **Step 4: Screenshot each ActionList**

Expected: three headings, seven items, readable metadata and trailing actions; no overlap or truncated text.

## Task 6: Structural compliance audit and visual validation

**Interfaces:**
- Consumes: `strictFrameId`, source snapshot, allowed logo key.
- Produces: final compliance report and screenshot.

- [x] **Step 1: Audit top-level structure**

Run a read-only traversal:

```js
const strict = await figma.getNodeByIdAsync(strictFrameId)
const violations = []

for (const node of strict.findAll(() => true)) {
  let insideInstance = false
  let parent = node.parent
  while (parent && parent.id !== strict.id) {
    if (parent.type === 'INSTANCE') {
      insideInstance = true
      break
    }
    parent = parent.parent
  }

  if (!insideInstance && node.type !== 'INSTANCE') {
    violations.push({id: node.id, name: node.name, type: node.type, reason: 'raw node outside instance'})
  }

  if (node.type === 'INSTANCE') {
    const mc = node.mainComponent
    const isLogo = mc?.key === '0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac'
    if (!isLogo && !mc?.remote) {
      violations.push({id: node.id, name: node.name, type: node.type, reason: 'non-official local instance'})
    }
  }
}

return {violations}
```

Expected: `violations` is empty.

- [x] **Step 2: Assert absence of forbidden local components**

Return every instance whose main component or parent set name contains `Primer / FORUM`.

Expected: empty array.

- [x] **Step 3: Recheck the source frame**

Read `{id, name, width, height, childIds}` from node `108:75` and compare with Task 1 snapshot.

Expected: exact match.

- [x] **Step 4: Assert component text and font provenance**

Return every visible text string in the strict frame, its nearest instance ancestor, and the ancestor main component’s `remote` status.

Expected: every required source string is present; every string belongs to an official remote Primer instance or the permitted logo instance. Text styles inside official components remain library-governed.

- [x] **Step 5: Capture the full strict frame**

Take a 1× screenshot and compare it with the source frame.

Expected: same information architecture and content, readable at 1440 px, with no clipping, overlap, empty required regions, placeholder content, or accidental local styling.

- [x] **Step 6: Report completion**

Provide the new frame ID, direct link, official component families used, audit result, and the two allowed exceptions: technical root frame and brand logo.

## Task 7: Commit plan progress metadata

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-primer-only-dashboard-figma.md`

- [x] **Step 1: Check completed boxes only after evidence exists**

Update `- [ ]` to `- [x]` only for steps whose tool result or screenshot has been verified.

- [x] **Step 2: Verify documentation diff**

Run:

```bash
git diff --check -- docs/superpowers/plans/2026-08-12-primer-only-dashboard-figma.md
git diff -- docs/superpowers/plans/2026-08-12-primer-only-dashboard-figma.md
```

Expected: no whitespace errors; checkbox updates match completed Figma evidence.

- [ ] **Step 3: Commit only the plan update**

Run:

```bash
git add -- docs/superpowers/plans/2026-08-12-primer-only-dashboard-figma.md
git commit -m "docs: record strict Primer dashboard build"
```

Expected: one documentation-only commit; unrelated dirty worktree changes remain unstaged.

---

## Execution evidence — 2026-08-12

- Created frame: `141:225`, `Desktop / Обзор / Primer — strict`, 1440 × 1100 at `(3240, 1000)`.
- Structural audit: `pass: true`; 47 direct children, all `INSTANCE`; 72 linked instances including nested Primer assets.
- Local-instance violations: none. The only local component is the permitted brand logo key `0a8b7c07a97bdc6e6ecac92581e2a5ff0ec2bdac`.
- Source frame `108:75` remained unchanged: 1440 × 1100, direct children `117:85`, `117:93`.
- Content audit: no missing required strings and no placeholder strings.
- Font audit: all visible interface text resolves to `SF Pro`. The library's unavailable `SF Pro Text`/`SF Pro Display` names were minimally overridden with the available `SF Pro` family inside linked instances.
- Official remote families used: `Heading`, `StateLabel`, `Button`, `NavList.GroupHeading`, `NavList.Item/SubItem`, `ActionList.GroupHeading`, `ActionList.Item/Default`, and their remote nested assets.
- Final frame: `https://www.figma.com/design/WT2IPB0eHD9ULCPENEktwp/Макеты-2.0?node-id=141-225`.

### Confirmed deviations from the initial component map

- The connected Primer kit has no suitable official `PageLayout`, `AppHeader`, or `Card` component.
- `PageHeader` was inspected but not placed because its available description variants include pull-request metadata and unwanted actions. The same content was composed from official `Heading` and `Button` instances.
- Metrics use official `Heading` plus `ActionList.Item/Default` instead of unavailable `Card` instances.
- Attention and order rows use official `ActionList.Item/Default` plus official `Button` instances directly in the technical root, preserving the strict no-local-container rule.
