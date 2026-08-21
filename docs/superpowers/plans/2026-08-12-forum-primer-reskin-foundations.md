# FORUM Primer Reskin Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and document a Light-only Industrial Precision foundation layer that reskins Primer with the approved FORUM brand colors and typography while preserving existing variable IDs and all remote Primer assets.

**Architecture:** Update the existing local collection `FORUM / Dashboard Tokens` in place, retaining every existing ID that current designs may reference. Create missing variables as semantic aliases, update local text/effect styles idempotently, then extend the existing `Guidelines content` frame with variable-bound documentation sections. Work in strictly sequential `use_figma` calls, persist returned IDs in `/tmp/design-system-state-forum-primer-reskin-v1.json`, and validate structure after every mutation plus visuals at each major milestone.

**Tech Stack:** Figma Design file `WT2IPB0eHD9ULCPENEktwp`, Figma Plugin API via `use_figma`, `get_metadata`, `get_screenshot`, Variables, Text Styles, Effect Styles, Auto Layout, local fonts Unbounded and Golos Text.

## Global Constraints

- Follow `figma-use` and `figma-generate-library` for every `use_figma` call.
- File key is exactly `WT2IPB0eHD9ULCPENEktwp`.
- Target page is `Фирменный стиль`, page ID `33:137`.
- Target documentation frame is `Guidelines content`, node ID `33:146`.
- Theme is Light-only; do not create Dark mode.
- Figma page values are authoritative: `#040404`, `#282828`, `#4A4A4A`, `#FF551A`, `#FF7140`, `#FFD4B2`.
- Direction is Industrial Precision.
- Preserve existing variable IDs by updating or renaming variables in place; never delete and recreate the collection.
- Existing remote Primer variables, styles, components, and instances must remain untouched.
- Do not detach instances, fork components, rebuild components, or change component properties/APIs.
- Keep Primer spacing and component dimensions unchanged.
- Keep Octicons unchanged and at native 16 px or 24 px sizes.
- Primitive variables have `scopes = []`; semantic variables use explicit scopes; no variable may retain `ALL_SCOPES`.
- Every variable receives `WEB` code syntax in the form `var(--forum-...)`.
- Primary orange controls use `#040404` foreground, not white.
- Status roles remain semantically distinct from orange.
- Every text mutation loads the exact font before changing content or text properties.
- At most one `setCurrentPageAsync()` call per `use_figma` invocation.
- All mutation calls return every created or mutated node/style/variable ID.
- No `use_figma` calls may run in parallel.
- On a failed `use_figma` call, stop, inspect the error, verify atomic rollback if needed, then issue one corrected call.

---

## File and State Map

- Spec: `docs/superpowers/specs/2026-08-12-forum-primer-reskin-foundations-design.md` — approved source of truth.
- Plan: `docs/superpowers/plans/2026-08-12-forum-primer-reskin-foundations.md` — execution checklist.
- State ledger: `/tmp/design-system-state-forum-primer-reskin-v1.json` — exact IDs and validation status; create/update with `apply_patch`, never shell redirection.
- Figma input/output: file `WT2IPB0eHD9ULCPENEktwp`, node `33:146`.
- Existing collection: `FORUM / Dashboard Tokens`, collection ID `VariableCollectionId:107:73`, mode `Light`.

Runtime state contract:

```ts
type ReskinState = {
  runId: 'forum-primer-reskin-v1'
  phase: 'phase0' | 'phase1' | 'phase2' | 'phase4'
  step: string
  collectionId: string
  modeId: string
  variables: Record<string, string>
  textStyles: Record<string, string>
  effectStyles: Record<string, string>
  documentation: Record<string, string>
  pendingValidations: string[]
  completedSteps: string[]
}
```

Deterministic documentation node names:

```text
FORUM Foundations / Root
FORUM Foundations / 01 Brand Primitives
FORUM Foundations / 02 Semantic Colors
FORUM Foundations / 03 Typography
FORUM Foundations / 04 Spacing and Radius
FORUM Foundations / 05 Elevation and Focus
FORUM Foundations / 06 Octicons
FORUM Foundations / 07 Theme Example
```

## Task 1: Reconfirm preflight and initialize the state ledger

**Interfaces:**
- Consumes: approved spec, Figma file key, known collection/page/frame IDs.
- Produces: `ReskinState` with a complete pre-mutation snapshot and no pending ambiguity.

- [ ] **Step 1: Re-read approved requirements and confirm no new conflicting source**

Run:

```bash
sed -n '1,320p' docs/superpowers/specs/2026-08-12-forum-primer-reskin-foundations-design.md
git status --short
```

Expected: spec contains no unresolved markers; unrelated dirty-worktree changes remain untouched.

- [ ] **Step 2: Inspect the collection, styles, target frame, and fonts read-only**

Use one read-only `use_figma` call with `skillNames: "figma-use,figma-generate-library"`. Resolve `33:146`, switch once to its page, then return:

```js
const target = await figma.getNodeByIdAsync('33:146')
if (!target) throw new Error('Guidelines content 33:146 not found')
let page = target
while (page && page.type !== 'PAGE') page = page.parent
await figma.setCurrentPageAsync(page)

const collections = await figma.variables.getLocalVariableCollectionsAsync()
const collection = collections.find(c => c.name === 'FORUM / Dashboard Tokens')
if (!collection) throw new Error('FORUM / Dashboard Tokens not found')
const vars = (await figma.variables.getLocalVariablesAsync())
  .filter(v => v.variableCollectionId === collection.id)
const [textStyles, effectStyles, fonts] = await Promise.all([
  figma.getLocalTextStylesAsync(),
  figma.getLocalEffectStylesAsync(),
  figma.listAvailableFontsAsync(),
])

return {
  target: {id: target.id, name: target.name, width: target.width, height: target.height},
  page: {id: page.id, name: page.name},
  collection: {
    id: collection.id,
    modes: collection.modes,
    variableCount: collection.variableIds.length,
  },
  variables: vars.map(v => ({
    id: v.id, name: v.name, type: v.resolvedType,
    scopes: v.scopes, valuesByMode: v.valuesByMode, codeSyntax: v.codeSyntax,
  })),
  textStyles: textStyles.map(s => ({id: s.id, name: s.name})),
  effectStyles: effectStyles.map(s => ({id: s.id, name: s.name})),
  fonts: fonts
    .filter(f => ['Unbounded', 'Golos Text'].includes(f.fontName.family))
    .map(f => f.fontName),
  existingDocs: target.findAll(n => n.name.startsWith('FORUM Foundations /'))
    .map(n => ({id: n.id, name: n.name, type: n.type})),
}
```

Expected:

```text
page = Фирменный стиль (33:137)
collection = VariableCollectionId:107:73
modes = exactly one mode named Light
Unbounded styles include SemiBold and Bold
Golos Text styles include Regular and SemiBold
existingDocs is empty, or contains only exact deterministic names from an interrupted prior run
```

If any required font style is absent, stop before mutation and report the missing exact font name.

- [ ] **Step 3: Write the initial state ledger**

Use `apply_patch` to create `/tmp/design-system-state-forum-primer-reskin-v1.json` with the exact returned collection/mode/variable/style IDs. Set:

```json
{
  "runId": "forum-primer-reskin-v1",
  "phase": "phase0",
  "step": "preflight-complete",
  "collectionId": "VariableCollectionId:107:73",
  "modeId": "<actual Light mode ID>",
  "variables": {},
  "textStyles": {},
  "effectStyles": {},
  "documentation": {},
  "pendingValidations": [],
  "completedSteps": ["P0.a", "P0.b", "P0.c", "P0.d", "P0.e", "P0.f"]
}
```

Expected: valid JSON and exact IDs only; do not infer or reconstruct IDs.

## Task 2: Update and create primitive variables

**Interfaces:**
- Consumes: `collectionId`, `modeId`, preflight variable name→ID map.
- Produces: final primitive values with preserved IDs and explicit empty scopes.

Required primitive table:

```js
const primitiveDefs = [
  ['primitive/white', '#FFFFFF'],
  ['primitive/canvas', '#F6F8FA'],
  ['primitive/surface-muted', '#F1F1F1'],
  ['primitive/surface-subtle', '#F7F7F7'],
  ['primitive/border', '#D6D6D6'],
  ['primitive/black', '#040404'],
  ['primitive/text-primary', '#282828'],
  ['primitive/text-secondary', '#4A4A4A'],
  ['primitive/accent', '#FF551A'],
  ['primitive/accent-hover', '#FF7140'],
  ['primitive/accent-muted', '#FFD4B2'],
  ['primitive/accent-pressed', '#E64A12'],
  ['primitive/link', '#CC4415'],
]
```

- [ ] **Step 1: Update existing primitives without changing IDs**

Use one `use_figma` mutation call. Look up variables by exact current names and update these in place:

```text
primitive/white
primitive/canvas
primitive/surface-muted
primitive/surface-subtle
primitive/border
primitive/text-primary
primitive/text-secondary
primitive/accent
```

For each variable: set the exact value for the Light mode, set `scopes = []`, and set WEB code syntax using `var(--forum-<slash-path-as-kebab>)`. Return every mutated variable ID.

Expected: all eight IDs match the preflight snapshot.

- [ ] **Step 2: Migrate the two legacy accent primitive IDs**

In one focused `use_figma` call:

```text
primitive/accent-strong → rename to primitive/link → #CC4415
primitive/accent-soft   → rename to primitive/accent-muted → #FFD4B2
```

Set `scopes = []`, set WEB code syntax to `var(--forum-primitive-link)` and `var(--forum-primitive-accent-muted)`, and return both original IDs under their new names.

Expected: no variables remain named `primitive/accent-strong` or `primitive/accent-soft`.

- [ ] **Step 3: Create only the missing primitives**

In one focused `use_figma` call, idempotently create:

```text
primitive/black = #040404
primitive/accent-hover = #FF7140
primitive/accent-pressed = #E64A12
```

Before each create, query exact name in collection `VariableCollectionId:107:73`; if it already exists, validate its type is `COLOR`, then update instead of duplicating. Use `scopes = []` and exact WEB syntax.

Expected: exactly 13 primitive names from `primitiveDefs`, no duplicate names.

- [ ] **Step 4: Validate primitives read-only and update ledger**

Read all variables in the collection and return only `primitive/*` entries with IDs, values, scopes, and code syntax.

Expected:

```text
13 primitives
all type COLOR
all scopes []
all exact values
all WEB syntax values start var(--forum- and end )
```

Update ledger `phase = phase1`, `step = primitives-validated`, `variables` with all exact primitive IDs, and add `P1.b`, `P1.d`, `P1.e` to `completedSteps`.

## Task 3: Update and create semantic variables

**Interfaces:**
- Consumes: validated primitive ID map.
- Produces: semantic aliases, exact scopes, preserved legacy semantic IDs where applicable.

Semantic definition table:

```js
const semanticDefs = [
  ['color/bg/canvas', 'primitive/canvas', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/default', 'primitive/white', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/muted', 'primitive/surface-muted', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/subtle', 'primitive/surface-subtle', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/accent', 'primitive/accent', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/accent-hover', 'primitive/accent-hover', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/accent-pressed', 'primitive/accent-pressed', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/bg/accent-muted', 'primitive/accent-muted', ['FRAME_FILL', 'SHAPE_FILL']],
  ['color/text/heading', 'primitive/black', ['TEXT_FILL']],
  ['color/text/primary', 'primitive/text-primary', ['TEXT_FILL']],
  ['color/text/secondary', 'primitive/text-secondary', ['TEXT_FILL']],
  ['color/text/link', 'primitive/link', ['TEXT_FILL']],
  ['color/text/on-accent', 'primitive/black', ['TEXT_FILL']],
  ['color/border/default', 'primitive/border', ['STROKE_COLOR']],
  ['color/border/focus', 'primitive/accent', ['STROKE_COLOR']],
]
```

- [ ] **Step 1: Update existing semantic aliases in place**

Use one `use_figma` call to update exact existing names:

```text
color/bg/canvas
color/bg/default
color/bg/muted
color/bg/subtle
color/bg/accent
color/text/primary
color/text/secondary
color/text/on-accent
color/border/default
```

Use `figma.variables.createVariableAlias(primitiveVar)` for every value. Apply exact scopes and exact WEB syntax.

Expected: existing IDs unchanged; `color/text/on-accent` now aliases `primitive/black`.

- [ ] **Step 2: Migrate legacy semantic IDs**

In one focused call:

```text
color/text/accent → rename to color/text/link → alias primitive/link
color/bg/accent-soft → rename to color/bg/accent-muted → alias primitive/accent-muted
```

Expected: both IDs are preserved; old names no longer exist.

- [ ] **Step 3: Create missing semantic roles idempotently**

Create or update exact names:

```text
color/bg/accent-hover
color/bg/accent-pressed
color/text/heading
color/border/focus
```

Apply aliases, scopes, and WEB syntax from `semanticDefs`.

Expected: 15 semantic roles from the definition table and zero hardcoded semantic colors.

- [ ] **Step 4: Normalize existing spacing and radius variables**

Use one focused call to assert and set:

```js
const dimensionDefs = [
  ['spacing/2xs', 4, ['GAP']],
  ['spacing/xs', 8, ['GAP']],
  ['spacing/sm', 12, ['GAP']],
  ['spacing/md', 16, ['GAP']],
  ['spacing/lg', 24, ['GAP']],
  ['spacing/xl', 32, ['GAP']],
  ['radius/sm', 6, ['CORNER_RADIUS']],
  ['radius/md', 8, ['CORNER_RADIUS']],
  ['radius/lg', 12, ['CORNER_RADIUS']],
  ['radius/full', 999, ['CORNER_RADIUS']],
]
```

Set WEB syntax for every dimension variable. Preserve every existing ID.

Expected: `radius/lg = 12` and all dimensions have explicit scopes.

- [ ] **Step 5: Audit the full collection and update ledger**

Read all collection variables. Verify:

```text
collection has one Light mode
no duplicate names
no variable has ALL_SCOPES
all 13 primitives, 15 semantic colors, 6 spacing, and 4 radii exist
all semantic COLOR values are VARIABLE_ALIAS objects
all variables have WEB syntax in var(--forum-...) form
```

Do not require the collection to contain only these 38 variables: retain any pre-existing unrelated variable that was not in scope, but audit it for explicit scopes and WEB syntax.

Update ledger with exact IDs and add `P1.a`, `P1.c`, `P1.d`, `P1.e`, `P1.g`.

## Task 4: Create or update typography styles

**Interfaces:**
- Consumes: verified fonts and approved type ramp.
- Produces: ten exact local Text Styles with stable IDs on rerun.

Exact definitions:

```js
const typeDefs = [
  ['FORUM / Display', 'Unbounded', 'Bold', 40, 48, 'Covers and key messages'],
  ['FORUM / Heading / Page', 'Unbounded', 'SemiBold', 28, 36, 'Page titles'],
  ['FORUM / Heading / Section', 'Unbounded', 'SemiBold', 20, 28, 'Major sections'],
  ['FORUM / Heading / Card', 'Unbounded', 'SemiBold', 16, 24, 'Large card titles'],
  ['FORUM / Body / Large', 'Golos Text', 'Regular', 16, 24, 'Introductory copy'],
  ['FORUM / Body / Medium', 'Golos Text', 'Regular', 14, 20, 'Default interface text'],
  ['FORUM / Body / Small', 'Golos Text', 'Regular', 12, 16, 'Help text and metadata'],
  ['FORUM / Label / Medium', 'Golos Text', 'SemiBold', 14, 20, 'Buttons and controls'],
  ['FORUM / Label / Small', 'Golos Text', 'SemiBold', 12, 16, 'Badges and compact labels'],
  ['FORUM / Metric', 'Golos Text', 'SemiBold', 24, 32, 'Numeric metrics'],
]
```

- [ ] **Step 1: Load exact fonts and upsert the text styles**

Use one `use_figma` call. First confirm exact styles with `listAvailableFontsAsync()`, then `await Promise.all()` for the four exact font/style pairs. For each definition, find existing style by exact name or create it, then assign:

```js
style.fontName = {family, style: fontStyle}
style.fontSize = fontSize
style.lineHeight = {unit: 'PIXELS', value: lineHeight}
style.letterSpacing = {unit: 'PERCENT', value: 0}
style.description = `${usage}. CSS: var(--forum-${name
  .replace(/^FORUM \/ /, '')
  .toLowerCase()
  .replace(/ \/ /g, '-')
  .replace(/ /g, '-')})`
```

This updates the existing names `FORUM / Heading / Page`, `FORUM / Body / Small`, and `FORUM / Label / Small` in place. Rename existing `FORUM / Body / Regular` to `FORUM / Body / Medium`, `FORUM / Label / Semibold` to `FORUM / Label / Medium`, and `FORUM / Metric / Number` to `FORUM / Metric` before creating missing styles, preserving their IDs.

Expected: exactly ten exact target style names; no legacy names remain.

- [ ] **Step 2: Validate typography and update ledger**

Return each target style's ID, name, `fontName`, `fontSize`, `lineHeight`, `letterSpacing`, and description.

Expected: all values exactly match `typeDefs`; no missing font; no duplicate names. Update ledger and add `P1.f`, `P1.h` for text styles.

## Task 5: Create or update effect styles

**Interfaces:**
- Consumes: approved elevation/focus values.
- Produces: four exact local Effect Styles.

Exact definitions:

```js
const effectDefs = [
  ['FORUM / Elevation / Low',     {r:4/255,g:4/255,b:4/255,a:.06}, {x:0,y:1}, 2, 0],
  ['FORUM / Elevation / Medium',  {r:4/255,g:4/255,b:4/255,a:.08}, {x:0,y:4}, 12, 0],
  ['FORUM / Elevation / Overlay', {r:4/255,g:4/255,b:4/255,a:.14}, {x:0,y:12}, 32, 0],
  ['FORUM / Focus / Brand',       {r:1,g:85/255,b:26/255,a:.28},   {x:0,y:0}, 0, 3],
]
```

- [ ] **Step 1: Upsert exact effect styles**

Use one `use_figma` call. Find each style by exact name or create it. Assign one `DROP_SHADOW` effect:

```js
style.effects = [{
  type: 'DROP_SHADOW', color, offset,
  radius, spread, visible: true, blendMode: 'NORMAL',
}]
```

Expected: exactly four target styles, each with exactly one effect.

- [ ] **Step 2: Validate effects and update ledger**

Return exact IDs and effect arrays. Verify values against `effectDefs`. Update ledger and complete the remaining `P1.f` and `P1.h` items.

## Task 6: Expand the documentation frame skeleton

**Interfaces:**
- Consumes: target frame `33:146`, semantic variable ID map, deterministic section names.
- Produces: one documentation root and seven empty section frames with exact IDs.

- [ ] **Step 1: Capture the immutable baseline screenshot and metadata**

Call `get_metadata` and `get_screenshot` for `33:146` before layout mutation. Save the screenshot URL metadata in the ledger under `documentation.baselineScreenshot` and record original size `1440 × 760`.

- [ ] **Step 2: Create or recover the documentation root**

Use one `use_figma` call on page `33:137`. If `FORUM Foundations / Root` exists, return its ID after verifying it is inside `33:146`; otherwise create an auto-layout frame with:

```text
name = FORUM Foundations / Root
direction = VERTICAL
width = 1200
x = 120
y = 760
itemSpacing = 64
padding top/right/bottom/left = 64/0/80/0
fills = []
```

Resize `Guidelines content` to `1440 × 6200` initially. Append the root to `33:146`. Return both mutated IDs.

Expected: original children remain unchanged; root is a new fourth child below existing content.

- [ ] **Step 3: Create seven deterministic placeholder section frames**

Create the seven section frames in two or more sequential `use_figma` calls, keeping each call below ten logical operations. Every section is vertical auto layout, 1200 px wide, `itemSpacing = 24`, transparent fill, and `placeholder = true`. Append in exact numeric order.

Expected: exactly seven section children, no duplicates, all placeholder shimmers enabled. Save exact IDs to ledger.

- [ ] **Step 4: Validate the skeleton**

Use `get_metadata` on the root. Expected exact seven-child order, positive widths/heights, root below y=760, original content intact.

## Task 7: Build color documentation

**Interfaces:**
- Consumes: IDs for sections 01 and 02, variable/style maps.
- Produces: variable-bound brand and semantic specimens; placeholders removed for both sections.

- [ ] **Step 1: Build Section 01 heading and primitive swatches**

Use sequential focused `use_figma` calls. Load `Unbounded SemiBold`, `Golos Text Regular`, and `Golos Text SemiBold`. Create a heading block with:

```text
label: 04 — BRAND PRIMITIVES
title: Брендовые основы
description: Исходные цвета FORUM. В макетах используйте semantic-токены, а не primitives напрямую.
```

Create 13 swatch cards in rows of at most four. Every swatch fill must bind to the corresponding primitive variable; text colors bind to semantic text variables. Each card shows exact token name and HEX value. Use white cards, radius 12, and 16 px internal padding.

Expected: no hardcoded swatch color, no missing token, all labels legible.

- [ ] **Step 2: Build Section 02 semantic roles and states**

Create groups for `Foreground`, `Background`, `Border`, and `Interactive states`. Include a Primary action specimen with:

```text
Rest    #FF551A / #040404
Hover   #FF7140 / #040404
Pressed #E64A12 / #040404
Muted   #FFD4B2 / #282828
Link    #CC4415 on white
```

All fills and text colors bind to semantic variables. Add the note: `Белый текст на Primary Orange не используется: контраст 3.2:1.`

- [ ] **Step 3: Remove placeholders and validate color sections**

Set `placeholder = false` on sections 01 and 02. Call `get_metadata` for structure, then `get_screenshot` for each section.

Expected: no clipped token names, no overlap, all specimen colors visually distinct, no placeholder copy.

## Task 8: Build typography, spacing, radius, and effect documentation

**Interfaces:**
- Consumes: section IDs 03–05 and all local style/token IDs.
- Produces: three completed documentation sections.

- [ ] **Step 1: Build Section 03 typography specimens**

Create headings:

```text
label: 05 — TYPOGRAPHY
title: Типографическая шкала
description: Unbounded задаёт характер, Golos Text обслуживает рабочий интерфейс.
```

Create one specimen row per exact Text Style. Apply styles through `setTextStyleIdAsync(styleId)`. Include the exact style name, size/line-height, and usage note. Use representative Russian copy and verify Unbounded is absent from table/form/button examples.

- [ ] **Step 2: Build Section 04 spacing and radius specimens**

Create spacing bars for 4, 8, 12, 16, 24, and 32, binding width or gap-capable properties to the corresponding variables where supported. Create radius tiles for 6, 8, 12, and 999, binding corner radius to the corresponding variables.

Label the preservation rule: `Spacing и размеры компонентов Primer не изменяются.`

- [ ] **Step 3: Build Section 05 elevation and focus specimens**

Create four white specimen cards and assign the corresponding effect style IDs. Explain:

```text
Low — raised controls
Medium — dropdown and popover
Overlay — dialog
Focus / Brand — interactive focus treatment
```

Default card specimen must use border only and no effect.

- [ ] **Step 4: Remove placeholders and validate Sections 03–05**

Set all three placeholders false. Validate metadata and capture one screenshot per section.

Expected: no missing fonts, correct type scale, visible but restrained effects, no cropped descenders or line boxes.

## Task 9: Build Octicons guidance and compact theme example

**Interfaces:**
- Consumes: section IDs 06–07, connected Primer library, local semantic tokens/styles.
- Produces: two completed sections without detached assets.

- [ ] **Step 1: Build Section 06 Octicons usage guidance**

Search or import connected Primer `Icon` plus representative Octicons. Use only connected instances. Show native 16 px and 24 px examples for default, muted, active, and status contexts. Add exact rules:

```text
Не масштабировать 16 px иконку до 24 px.
Оранжевый — только active, selected или actionable.
Success, attention и danger сохраняют собственные цвета.
Логотип FORUM не является системной иконкой.
```

Do not detach, edit vector geometry, or create a local icon library.

- [ ] **Step 2: Build Section 07 compact FORUM theme example**

Create a documentation-only sample panel using auto-layout and local variables/styles. Include:

```text
Page title: Обзор проектов
Body copy: Ключевые показатели и задачи вашей организации
Primary action: Создать заказ
Secondary action: Найти заказы
Metric: 24 / Подходящие заказы
Muted card: Требует внимания
Text link: Перейти к заказам
```

This is a visual specimen, not a component library: create frames/text only inside the documentation section, bind every supported visual property to local variables/styles, and do not publish components.

- [ ] **Step 3: Remove placeholders and resize the target frame to content**

Set section 06 and 07 placeholders false. Measure root bottom and resize `33:146` height to `ceil(root.y + root.height + 80)`. Do not modify its width or existing top content.

- [ ] **Step 4: Validate Sections 06–07**

Use metadata and screenshots. Expected: connected icon instances, native sizes, no detached vectors, clear primary-action contrast, readable Russian text.

## Task 10: Final integration and QA

**Interfaces:**
- Consumes: completed ledger, collection/style/docs IDs.
- Produces: final QA report, screenshots, completed state ledger.

- [ ] **Step 1: Run the final variable audit**

Use read-only `use_figma` to return:

```text
collection name and mode list
variable count by type
every variable name, ID, scope, WEB syntax
alias targets for every semantic variable
duplicate-name list
missing required-name list
ALL_SCOPES list
hardcoded-semantic list
```

Expected: one Light mode; no duplicates; no missing required names; empty ALL_SCOPES and hardcoded-semantic lists.

- [ ] **Step 2: Run the final styles audit**

Return all target Text Styles and Effect Styles with exact properties. Expected: ten text styles and four effect styles, exact values, no duplicate target names.

- [ ] **Step 3: Run the documentation structure audit**

Use `get_metadata` on `33:146`. Expected:

```text
original three top-level children still exist
one FORUM Foundations / Root exists
exact seven ordered sections exist
no section has placeholder = true
all nodes fit inside 1440 px target width
no section overlaps another
```

- [ ] **Step 4: Run the remote Primer safety audit**

Read all instances under `33:146`. For each, resolve `mainComponent` and return `{instanceId, name, mainKey, remote}`. Expected: every Primer-derived icon instance remains connected and remote; no detached icon vectors were introduced.

- [ ] **Step 5: Capture final screenshots**

Capture:

```text
33:146 entire Guidelines content
FORUM Foundations / 01 Brand Primitives
FORUM Foundations / 02 Semantic Colors
FORUM Foundations / 03 Typography
FORUM Foundations / 07 Theme Example
```

Inspect at sufficient resolution for clipping, overlap, missing fonts, placeholder text, variable resolution, and effect rendering.

- [ ] **Step 6: Mark the state ledger complete**

Update:

```json
{
  "phase": "phase4",
  "step": "qa-complete",
  "pendingValidations": [],
  "completedSteps": [
    "P0.a", "P0.b", "P0.c", "P0.d", "P0.e", "P0.f",
    "P1.a", "P1.b", "P1.c", "P1.d", "P1.e", "P1.f", "P1.g", "P1.h",
    "P2.a", "P2.b", "P2.c",
    "P4.b", "P4.c", "P4.d", "P4.e"
  ]
}
```

Record `P4.a` as `N/A: this foundations-only phase has no code components or Code Connect mappings`.

- [ ] **Step 7: Report the final artifact**

Report exact collection/style counts, created/updated objects, validation results, remaining boundary (component forks are a later phase), and link the Figma frame:

```text
https://www.figma.com/design/WT2IPB0eHD9ULCPENEktwp/Макеты-2.0?node-id=33-146
```

## Task 11: Commit the implementation record

**Interfaces:**
- Consumes: completed Figma QA and checked plan.
- Produces: one repository commit containing only the updated spec and checked implementation plan.

- [ ] **Step 1: Mark completed plan checkboxes**

Update only this plan file after each successful task. Do not stage unrelated workspace changes.

- [ ] **Step 2: Validate repository documentation**

Run:

```bash
rg -n 'T[B]D|T[O]DO|PLACEH[O]LDER|\?\?\?' \
  docs/superpowers/specs/2026-08-12-forum-primer-reskin-foundations-design.md \
  docs/superpowers/plans/2026-08-12-forum-primer-reskin-foundations.md
git diff --check -- \
  docs/superpowers/specs/2026-08-12-forum-primer-reskin-foundations-design.md \
  docs/superpowers/plans/2026-08-12-forum-primer-reskin-foundations.md
```

Expected: no placeholder hits and no whitespace errors.

- [ ] **Step 3: Commit only the implementation record**

```bash
git add -- \
  docs/superpowers/specs/2026-08-12-forum-primer-reskin-foundations-design.md \
  docs/superpowers/plans/2026-08-12-forum-primer-reskin-foundations.md
git diff --cached --name-only
git commit -m "docs: plan FORUM Primer reskin foundations"
```

Expected staged names: exactly the spec and plan above; no `.secrets`, deleted Brandbook files, or unrelated docs.
