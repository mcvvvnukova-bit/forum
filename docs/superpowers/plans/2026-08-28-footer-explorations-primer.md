# Primer Footer Explorations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create five visually distinct, token-bound Primer footer explorations in the existing Figma file without changing the live landing footer.

**Architecture:** Add one top-level Figma section to the right of all existing content. Inside it, use a vertical Auto Layout board containing five independently reviewable 1248 px footer frames; each frame composes an attached official Primer Footer instance with official Primer Link or Button instances and the existing local Forum brand components. Bind all manual layout surfaces and text overrides to the existing `Forum / Light` semantic variables and validate every variant before completing the board.

**Tech Stack:** Figma Design, Figma Plugin API through `use_figma`, Primer Web (Community), local `Forum` Figma Variables, existing FORUM text styles, `Unbounded`, `Golos Text`.

## Global Constraints

- Target Figma file: `WT2IPB0eHD9ULCPENEktwp`.
- Target page: `Landing page`, node `0:1`.
- Existing landing: `7:3940`; existing footer wrapper: `133:5020`; existing attached Primer Footer instance: `133:4995`.
- Do not mutate, move, resize, hide, clone-over, or replace `133:5020` or any descendant of the live landing.
- Official Primer Footer component-set key: `ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9`.
- Official Primer Link component-set key: `b348e6898e7f402a17991d4f51e69a73a2d5b36a`.
- Official Primer Button component-set key: `43240199eae3433e730ef95618163ba56e593b54`.
- Local typography component set: `21:12`; local logo component: `27:175`.
- Use collection `Forum`, mode `Light`, and no other color mode.
- Use only existing semantic variables and styles; create no variable collection, variable, text style, effect style, component, or component set.
- Each footer exploration is 1248 px wide and uses Auto Layout for every structural relationship.
- Every `use_figma` write returns all created, mutated, and removed node IDs.
- Every failed `use_figma` call is inspected before a corrected retry; failed scripts are atomic.
- Validate section structure and screenshots after every footer and again after the complete board.

## File and artifact map

- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, page `0:1` — add the exploration section and its descendants only.
- Reference: `docs/superpowers/specs/2026-08-28-footer-explorations-primer-design.md` — approved scope, content, component, token, and acceptance requirements.
- Create: no production code or token files.
- Preserve: `133:5020`, `133:4995`, `7:3940`, and all unrelated local working-tree changes.

---

### Task 1: Resolve and validate all Primer and Forum dependencies

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp` (remote component imports only; no canvas artifact remains)
- Reference: `docs/superpowers/specs/2026-08-28-footer-explorations-primer-design.md`

**Interfaces:**
- Consumes: exact component keys and local node IDs from Global Constraints.
- Produces: `AssetMap` with `footerSetId`, `footerOffVariantId`, `footerOnVariantId`, `linkSetId`, `buttonSetId`, `linkTextPropertyKey`, `buttonTextPropertyKey`, `typographySetId`, `logoComponentId`, `forumCollectionId`, `forumLightModeId`, `variableIds`, `styleIds`, and `fontNames`.

- [ ] **Step 1: Run the dependency preflight and inspect component properties**

Run one read-mostly `use_figma` script. The temporary Link and Button instances are removed in the same atomic call.

```js
const [footerSet, linkSet, buttonSet, typographySet, logo, collections, variables, styles, fonts, liveFooter] = await Promise.all([
  figma.importComponentSetByKeyAsync("ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9"),
  figma.importComponentSetByKeyAsync("b348e6898e7f402a17991d4f51e69a73a2d5b36a"),
  figma.importComponentSetByKeyAsync("43240199eae3433e730ef95618163ba56e593b54"),
  figma.getNodeByIdAsync("21:12"),
  figma.getNodeByIdAsync("27:175"),
  figma.variables.getLocalVariableCollectionsAsync(),
  figma.variables.getLocalVariablesAsync(),
  figma.getLocalTextStylesAsync(),
  figma.listAvailableFontsAsync(),
  figma.getNodeByIdAsync("133:5020")
]);

if (!typographySet || typographySet.type !== "COMPONENT_SET") throw new Error("Typography set 21:12 is unavailable");
if (!logo || logo.type !== "COMPONENT") throw new Error("Logo component 27:175 is unavailable");
if (!liveFooter || liveFooter.type !== "FRAME") throw new Error("Live footer 133:5020 is unavailable");

const forum = collections.find(c => c.name === "Forum");
if (!forum) throw new Error("Forum collection is unavailable");
const light = forum.modes.find(m => m.name === "Light");
if (!light || forum.modes.length !== 1) throw new Error("Forum must expose exactly the Light mode for this task");

const requiredVariables = [
  "color/bg/canvas", "color/bg/default", "color/bg/muted", "color/bg/subtle",
  "color/bg/accent", "color/text/primary", "color/text/secondary",
  "color/text/link", "color/text/on-accent", "color/text/heading",
  "color/border/default", "spacing/sm", "spacing/md", "spacing/lg", "spacing/xl"
];
const variableMap = Object.fromEntries(variables.filter(v => requiredVariables.includes(v.name)).map(v => [v.name, v.id]));
const missingVariables = requiredVariables.filter(name => !variableMap[name]);
if (missingVariables.length) throw new Error(`Missing Forum variables: ${missingVariables.join(", ")}`);

const requiredStyles = ["FORUM / Heading / Section", "FORUM / Body / Medium", "FORUM / Body / Small", "FORUM / Label / Medium"];
const styleMap = Object.fromEntries(styles.filter(s => requiredStyles.includes(s.name)).map(s => [s.name, s.id]));
const missingStyles = requiredStyles.filter(name => !styleMap[name]);
if (missingStyles.length) throw new Error(`Missing FORUM styles: ${missingStyles.join(", ")}`);

const fontNames = fonts.map(f => f.fontName).filter(f => ["Golos Text", "Unbounded"].includes(f.family));
if (!fontNames.some(f => f.family === "Golos Text") || !fontNames.some(f => f.family === "Unbounded")) {
  throw new Error("Required Golos Text and Unbounded fonts are unavailable");
}

const footerOff = footerSet.children.find(n => n.type === "COMPONENT" && n.name === "isCompact?=off");
const footerOn = footerSet.children.find(n => n.type === "COMPONENT" && n.name === "isCompact?=on");
if (!footerOff || !footerOn) throw new Error("Both official Primer Footer variants are required");

const linkProbe = linkSet.defaultVariant.createInstance();
const buttonProbe = buttonSet.defaultVariant.createInstance();
const linkTextEntry = Object.entries(linkProbe.componentProperties).find(([, p]) => p.type === "TEXT");
const buttonTextEntry = Object.entries(buttonProbe.componentProperties).find(([, p]) => p.type === "TEXT");
if (!linkTextEntry || !buttonTextEntry) throw new Error("Primer Link and Button must expose a TEXT component property");
const removedTemporaryNodeIds = [linkProbe.id, buttonProbe.id];
linkProbe.remove();
buttonProbe.remove();

return {
  createdNodeIds: [],
  mutatedNodeIds: [],
  removedNodeIds: removedTemporaryNodeIds,
  assetMap: {
    footerSetId: footerSet.id,
    footerOffVariantId: footerOff.id,
    footerOnVariantId: footerOn.id,
    linkSetId: linkSet.id,
    buttonSetId: buttonSet.id,
    linkTextPropertyKey: linkTextEntry[0],
    buttonTextPropertyKey: buttonTextEntry[0],
    typographySetId: typographySet.id,
    logoComponentId: logo.id,
    forumCollectionId: forum.id,
    forumLightModeId: light.modeId,
    variableIds: variableMap,
    styleIds: styleMap,
    fontNames,
    liveFooterSnapshot: { id: liveFooter.id, name: liveFooter.name, width: liveFooter.width, height: liveFooter.height }
  }
};
```

Expected: all IDs and property keys are non-empty; the live footer snapshot is `{id:"133:5020", name:"Footer / Primer + FORUM", width:1248, height:240}`.

- [ ] **Step 2: Record component schemas and stop on an unsafe primitive gap**

Inspect the returned Link and Button property maps. If either component lacks a writable text property or an attached default variant, stop and report the exact Primer library gap. Do not draw a local link or button substitute.

- [ ] **Step 3: Save a Figma undo checkpoint**

Run `figma.commitUndo()` in a short `use_figma` call and return empty ID arrays. This groups dependency imports separately from canvas work.

---

### Task 2: Create the exploration section and five placeholders

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, page `0:1`

**Interfaces:**
- Consumes: `AssetMap.variableIds`, `AssetMap.forumCollectionId`, and `AssetMap.forumLightModeId` from Task 1.
- Produces: `ExplorationMap` with `sectionId`, `boardId`, and `variantIds` keyed by `minimal`, `navigation`, `cta`, `audiences`, and `compact`.

- [ ] **Step 1: Assert idempotency before creating the board**

Run a read-only `use_figma` check:

```js
const existing = figma.currentPage.findOne(n => n.name === "Footer explorations / Primer");
return { exists: Boolean(existing), existingId: existing ? existing.id : null };
```

Expected: `exists: false`. If it is true, inspect the existing section and resume only when it is an incomplete artifact from this plan; never create a duplicate section.

- [ ] **Step 2: Create the section, Auto Layout board, and five placeholder frames**

Use one atomic `use_figma` call. Resolve local variables by ID from Task 1, find clear canvas space to the right, create the wrapper first, then append every variant directly inside it.

```js
const [canvasVar, spacingSm, spacingXl] = await Promise.all([
  figma.variables.getVariableByIdAsync("VariableID:107:84"),
  figma.variables.getVariableByIdAsync("VariableID:107:96"),
  figma.variables.getVariableByIdAsync("VariableID:107:99")
]);
if (!canvasVar || !spacingSm || !spacingXl) throw new Error("Required Forum layout variables are unavailable");

let maxRight = 0;
for (const child of figma.currentPage.children) maxRight = Math.max(maxRight, child.x + child.width);

const section = figma.createSection();
section.name = "Footer explorations / Primer";
section.x = maxRight + 240;
section.y = 0;
section.resizeWithoutConstraints(1312, 2200);

const board = figma.createAutoLayout("VERTICAL", { name: "Footer explorations / Board" });
section.appendChild(board);
board.x = 0;
board.y = 0;
board.resize(1312, 200);
board.layoutSizingHorizontal = "FIXED";
board.layoutSizingVertical = "HUG";
board.setBoundVariable("paddingTop", spacingXl);
board.setBoundVariable("paddingBottom", spacingXl);
board.setBoundVariable("paddingLeft", spacingXl);
board.setBoundVariable("paddingRight", spacingXl);
board.setBoundVariable("itemSpacing", spacingXl);
board.fills = [figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", canvasVar)];

const defs = [
  ["minimal", "01 — Минимальный"],
  ["navigation", "02 — Навигационный"],
  ["cta", "03 — CTA"],
  ["audiences", "04 — По аудиториям"],
  ["compact", "05 — Компактный центрированный"]
];
const variantIds = {};
const createdNodeIds = [section.id, board.id];
for (const [key, name] of defs) {
  const frame = figma.createAutoLayout("VERTICAL", { name });
  board.appendChild(frame);
  frame.resize(1248, 160);
  frame.layoutSizingHorizontal = "FILL";
  frame.layoutSizingVertical = "HUG";
  frame.setBoundVariable("itemSpacing", spacingSm);
  frame.fills = [];
  frame.placeholder = true;
  variantIds[key] = frame.id;
  createdNodeIds.push(frame.id);
}
board.setExplicitVariableModeForCollection("VariableCollectionId:107:73", "107:0");

return {
  createdNodeIds,
  mutatedNodeIds: [],
  explorationMap: { sectionId: section.id, boardId: board.id, variantIds }
};
```

Expected: one section, one board, and exactly five placeholder frames; the first variant starts 32 px inside the board through `spacing/xl` bindings.

- [ ] **Step 3: Validate the skeleton**

Call `get_metadata` on `sectionId`. Confirm five direct variant descendants under the board, unique names, width 1248, and no overlap. Capture a board screenshot; all five placeholders should appear in one vertical sequence.

---

### Task 3: Build variant 01 — Minimal

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, node `ExplorationMap.variantIds.minimal`

**Interfaces:**
- Consumes: Task 1 `AssetMap`, Task 2 `minimal` frame ID.
- Produces: `MinimalResult` with `surfaceId`, `footerInstanceId`, `linkInstanceIds`, and all created or mutated node IDs.

- [ ] **Step 1: Populate the minimal footer in one atomic call**

Create a caption instance from local Typography (`Role=Label`, text `01 — Минимальный`), a white horizontal main row, a brand group, four official Primer Link instances, and a clone of the attached official footer instance `133:4995`. Load all fonts from the cloned legal text before appending it. Bind the surface to `color/bg/default`, link text to `color/text/link`, and apply `Forum / Light` explicitly.

The row uses `SPACE_BETWEEN`; the brand group uses `АСТ «Форум»` and `Платформа для участников строительства`; Link copy is `О платформе`, `Для заказчиков`, `Для исполнителей`, `Контакты`. The cloned footer keeps `isCompact?=off`.

- [ ] **Step 2: Verify structure and screenshot**

Assert that the variant contains one attached Primer Footer instance, four attached Primer Link instances, and no Button. Screenshot the variant at scale 1 and confirm one-line navigation, readable legal copy, no GitHub copy, and no clipping.

- [ ] **Step 3: Remove the placeholder and save an undo checkpoint**

Set the variant frame's `placeholder` to `false`, return it in `mutatedNodeIds`, call `figma.commitUndo()`, and re-screenshot the variant.

---

### Task 4: Build variant 02 — Navigation columns

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, node `ExplorationMap.variantIds.navigation`

**Interfaces:**
- Consumes: Task 1 `AssetMap`, Task 2 `navigation` frame ID.
- Produces: `NavigationResult` with `surfaceId`, `logoInstanceId`, `footerInstanceId`, and four Link instance IDs.

- [ ] **Step 1: Populate the navigation footer**

Create the caption `02 — Навигационный`. In the main row, place an instance of `Brand / Logo / Horizontal / Color` on the left. On the right, create two vertical Auto Layout groups headed by local Typography Label instances: `Платформа` with links `О платформе` and `Контакты`, and `Участникам` with links `Для заказчиков` and `Для исполнителей`. Use official Primer Link instances for all four links. Append an `isCompact?=off` clone of `133:4995` for the legal row.

Bind the surface to `color/bg/subtle`, heading text to `color/text/heading`, link text to `color/text/link`, and spacing to `spacing/sm`, `spacing/lg`, and `spacing/xl` by semantic role.

- [ ] **Step 2: Validate the navigation hierarchy**

Read back the variant and require headings before links in layer order. Assert one logo instance, four Link instances, one Footer instance, and exact copy without duplicates.

- [ ] **Step 3: Screenshot and complete the variant**

Capture the whole variant and the main row separately. Confirm both columns align, the logo is not distorted, legal links wrap safely, and the variant differs materially from variant 01. Clear the placeholder and call `figma.commitUndo()`.

---

### Task 5: Build variant 03 — CTA

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, node `ExplorationMap.variantIds.cta`

**Interfaces:**
- Consumes: Task 1 `AssetMap`, Task 2 `cta` frame ID.
- Produces: `CtaResult` with `surfaceId`, `buttonInstanceId`, `footerInstanceId`, and four Link instance IDs.

- [ ] **Step 1: Populate the CTA footer**

Create caption `03 — CTA`. Build a horizontal CTA row with the local brand title and tagline on the left and one official Primer Button instance on the right. Set the discovered Button TEXT property to `Зарегистрироваться`. Bind the Button's solid background override to `color/bg/accent` and its text to `color/text/on-accent` without detaching it.

Create a second horizontal row of official Primer Link instances with the four standard navigation labels. Append an `isCompact?=off` clone of the existing attached footer for the legal row. Bind the surface to `color/bg/muted`; use only `spacing/md`, `spacing/lg`, and `spacing/xl` for layout.

- [ ] **Step 2: Validate Primer attachment and token overrides**

Assert exactly one Button instance whose main component belongs to component set key `43240199eae3433e730ef95618163ba56e593b54`. Assert the Button remains an instance, exposes `Зарегистрироваться`, and carries Forum variable overrides for its background and text.

- [ ] **Step 3: Screenshot and complete the variant**

Screenshot the CTA row and whole variant. Confirm the accent is used only for the Button, not as a decorative footer background; verify label contrast, button text fit, link spacing, and legal copy. Clear the placeholder and call `figma.commitUndo()`.

---

### Task 6: Build variant 04 — Audience groups

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, node `ExplorationMap.variantIds.audiences`

**Interfaces:**
- Consumes: Task 1 `AssetMap`, Task 2 `audiences` frame ID.
- Produces: `AudienceResult` with `surfaceId`, `logoInstanceId`, `footerInstanceId`, and four Link instance IDs.

- [ ] **Step 1: Populate the audience footer**

Create caption `04 — По аудиториям`. Place the logo and tagline on the left. On the right create three groups in reading order: `Заказчикам` → Link `Для заказчиков`; `Исполнителям` → Link `Для исполнителей`; `Платформа` → Links `О платформе` and `Контакты`. Headings use local Typography Label; navigation uses official Primer Link instances. Append an `isCompact?=off` Footer clone for legal copy.

Bind the surface to `color/bg/default`, group headings to `color/text/heading`, links to `color/text/link`, and layout to the existing spacing variables.

- [ ] **Step 2: Validate semantic reading order**

Read descendants in layer order and require: brand, `Заказчикам`, `Для заказчиков`, `Исполнителям`, `Для исполнителей`, `Платформа`, `О платформе`, `Контакты`, then legal copy. Assert four Link instances and one Footer instance.

- [ ] **Step 3: Screenshot and complete the variant**

Confirm all three groups align, the labels are visually distinct from links, and the layout remains legible when mentally collapsed into a vertical stack. Clear the placeholder and call `figma.commitUndo()`.

---

### Task 7: Build variant 05 — Compact centered

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, node `ExplorationMap.variantIds.compact`

**Interfaces:**
- Consumes: Task 1 `AssetMap`, Task 2 `compact` frame ID.
- Produces: `CompactResult` with `surfaceId`, `logoInstanceId`, `footerInstanceId`, and four Link instance IDs.

- [ ] **Step 1: Populate the centered compact footer**

Create caption `05 — Компактный центрированный`. Build a centered vertical brand group with the logo and tagline, followed by a centered horizontal row of the four official Primer Link instances. Clone `133:4995`, set `isCompact?` to `on`, then re-find its legal text descendants and restore the exact three approved legal strings, FORUM Small style, and `color/text/secondary` binding.

Bind the surface to `color/bg/subtle`, keep all alignment centered, and use only existing spacing variables. Do not shrink or distort the logo.

- [ ] **Step 2: Validate the compact source and copy**

Assert the Footer instance main component has key `0f106237674a9828dbe3538ca79338bcef970415` or belongs to Footer set key `ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9` with component property `isCompact?=on`. Require all nine approved strings exactly once in the full variant.

- [ ] **Step 3: Screenshot and complete the variant**

Confirm centered optical balance, no text thread, legal links remain readable, and the result is shorter than the navigation and audience variants. Clear the placeholder and call `figma.commitUndo()`.

---

### Task 8: Run full structural, token, font, and visual acceptance

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, exploration section bounds only
- Preserve: live footer `133:5020`

**Interfaces:**
- Consumes: all IDs from Tasks 1–7.
- Produces: `AcceptanceReport` with `variantCount`, `primerFooterSources`, `componentCounts`, `tokenGaps`, `fontOffenders`, `designSystemFontGaps`, `copyGaps`, `placeholderIds`, `liveFooterUnchanged`, and final section bounds.

- [ ] **Step 1: Resize the section to the finished board**

Fetch `sectionId` and `boardId`. Call `section.resizeWithoutConstraints(board.width, board.height)` and return the section ID as mutated. Do not resize any variant or the live landing.

- [ ] **Step 2: Run the structural acceptance script**

Use one read-only `use_figma` call scoped to the exploration section. Require exactly five named variant frames, one attached Primer Footer per variant, four Link instances per variant, and one Button only in variant 03. Resolve every Footer instance's main component and owner set; require owner key `ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9`.

Compare the live footer snapshot to `{id:"133:5020", name:"Footer / Primer + FORUM", width:1248, height:240}` and require no changes.

- [ ] **Step 3: Audit variables, copy, placeholders, and fonts**

For every manual frame, verify fill and layout bindings refer to variables in collection `Forum`. For every free-standing text node, verify the font family is `Unbounded` or `Golos Text`; list text inside Primer instances separately as design-system-governed fallback. Require no `placeholder=true` nodes.

For each variant, require all standard brand, navigation, and legal strings exactly once, with `Зарегистрироваться` additionally present only in variant 03. Report any missing or duplicate copy as a failed acceptance result.

- [ ] **Step 4: Capture detailed screenshots**

Capture one screenshot for each of the five variant frame IDs at max dimension 1800, then one screenshot of the complete board at max dimension 3000. Inspect for cropped text, overlaps, wrong font, unresolved GitHub copy, distorted logo, incorrect Button/Link variants, blank layers, and uneven spacing.

- [ ] **Step 5: Apply targeted fixes and re-run only failed checks**

Each fix script mutates only the failing node IDs returned by acceptance. After a fix, repeat its structural assertion and individual screenshot before proceeding. Do not rebuild complete variants.

- [ ] **Step 6: Save the final undo checkpoint and final evidence**

Call `figma.commitUndo()`. Return the exploration section ID, board ID, five variant IDs, five Footer instance IDs, all Link and Button instance IDs, and an empty `tokenGaps`, `fontOffenders`, `copyGaps`, and `placeholderIds` result. Record Primer-governed font fallbacks and the unavailable separate Primer Primitives/Octicons libraries as limitations rather than silently marking them verified.

---

## Completion evidence

- Metadata for the exploration section shows exactly five named variants.
- Individual screenshots show five materially different compositions with no clipping or overlap.
- Each variant contains an attached official Primer Footer instance.
- Link and Button semantics use official Primer components and remain attached.
- Manual fills, text colors, and spacing use `Forum / Light` variables.
- Free-standing typography uses `Unbounded` or `Golos Text`; library-governed differences are reported.
- The live footer `133:5020` remains unchanged at 1248 × 240.
- No new design-system primitive, token collection, non-Light mode, or invented organization data exists.
