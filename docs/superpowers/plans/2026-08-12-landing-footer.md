# Landing Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local landing footer in Figma with an official Primer library Footer instance styled with the АСТ «Форум» brand typography, color tokens, and confirmed footer content.

**Architecture:** Import the official `Primer Web (Community) / Footer` component set, keep its instance attached to the remote component, and use supported overrides for content and presentation. Compose it inside a small FORUM auto-layout wrapper only when required for the legal row, then replace the current local instance and resize its parent frames to fit.

**Tech Stack:** Figma Design, Figma Plugin API through `use_figma`, Primer Web (Community) component library, local FORUM variables and Figma Text Styles.

## Global Constraints

- Target Figma file: `WT2IPB0eHD9ULCPENEktwp`.
- Landing node: `7:3940`; conversion section: `13:2`; current footer: `101:80`.
- Official Primer Footer component-set key: `ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9`.
- Keep the official Primer instance attached; do not call `detachInstance()`.
- Use `FORUM / Heading / Section`, `FORUM / Body / Regular`, and `FORUM / Body / Small` text styles.
- Use existing FORUM variables `color/bg/default`, `color/text/primary`, `color/text/secondary`, `color/border/default`, and `color/text/accent`; do not create duplicate tokens.
- Confirmed footer copy is limited to brand, tagline, navigation, `Контакты`, copyright, consent, and privacy policy. Do not invent a phone, email, INN, or organization name.
- Do not modify any landing section outside the footer and the two parent-frame heights required to prevent clipping.
- Every `use_figma` write returns all created and mutated node IDs and is followed by structural or visual validation.

---

### Task 1: Import and identify the official Primer Footer variant

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp` (remote component import only)
- Reference: `docs/superpowers/specs/2026-08-12-landing-footer-design.md`

**Interfaces:**
- Consumes: Primer component-set key `ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9`.
- Produces: `primerSetId: string`, `primerSetKey: string`, `primerVariantId: string`, and a variant inventory containing `id`, `name`, `width`, and `height`.

- [ ] **Step 1: Run the structural preflight and verify the current implementation fails the source requirement**

Use a read-only `use_figma` script:

```js
const footer = await figma.getNodeByIdAsync("101:80")
if (!footer || footer.type !== "INSTANCE") throw new Error("Current footer is missing")
const main = await footer.getMainComponentAsync()
return {
  footerId: footer.id,
  sourceId: main ? main.id : null,
  sourceKey: main ? main.key : null,
  sourceRemote: main ? main.remote : null,
  passes: Boolean(main && main.remote && main.parent && main.parent.type === "COMPONENT_SET" && main.parent.key === "ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9")
}
```

Expected: `passes: false`, with the current source reported as local.

- [ ] **Step 2: Import the official component set and select the desktop variant deterministically**

Run one write-capable `use_figma` script:

```js
const primerSet = await figma.importComponentSetByKeyAsync("ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9")
const variants = primerSet.children
  .filter(node => node.type === "COMPONENT")
  .map(node => ({ id: node.id, name: node.name, width: node.width, height: node.height }))
const preferred = primerSet.children.find(node =>
  node.type === "COMPONENT" && /desktop|large|wide/i.test(node.name)
)
const selected = preferred && preferred.type === "COMPONENT" ? preferred : primerSet.defaultVariant
return {
  createdNodeIds: [],
  mutatedNodeIds: [],
  primerSetId: primerSet.id,
  primerSetKey: primerSet.key,
  primerVariantId: selected.id,
  variants
}
```

Expected: `primerSetKey` equals the required official asset key and `primerVariantId` is non-empty.

- [ ] **Step 3: Validate the imported source before creating an instance**

Use `get_metadata` on `primerSetId` and confirm that the response contains a `COMPONENT_SET` with at least one `COMPONENT` child. Do not proceed if the set key or source library differs.

---

### Task 2: Create the branded Primer footer composition

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, within staging space on the footer page

**Interfaces:**
- Consumes: `primerVariantId` from Task 1; local style names and variable names listed in Global Constraints.
- Produces: `footerWrapperId: string`, `primerInstanceId: string`, `createdNodeIds: string[]`, and `mutatedNodeIds: string[]`.

- [ ] **Step 1: Resolve exact styles, variables, and available fonts**

Run a read-only `use_figma` script that resolves by exact names and fails on missing assets:

```js
const [styles, variables, fonts] = await Promise.all([
  figma.getLocalTextStylesAsync(),
  figma.variables.getLocalVariablesAsync(),
  figma.listAvailableFontsAsync()
])
const requiredStyles = ["FORUM / Heading / Section", "FORUM / Body / Regular", "FORUM / Body / Small"]
const requiredVariables = ["color/bg/default", "color/text/primary", "color/text/secondary", "color/border/default", "color/text/accent"]
const styleMap = Object.fromEntries(styles.filter(s => requiredStyles.includes(s.name)).map(s => [s.name, s.id]))
const variableMap = Object.fromEntries(variables.filter(v => requiredVariables.includes(v.name)).map(v => [v.name, v.id]))
const missingStyles = requiredStyles.filter(name => !styleMap[name])
const missingVariables = requiredVariables.filter(name => !variableMap[name])
const requiredFonts = ["Unbounded", "Golos Text"]
const missingFonts = requiredFonts.filter(family => !fonts.some(font => font.fontName.family === family))
if (missingStyles.length || missingVariables.length || missingFonts.length) {
  throw new Error(JSON.stringify({ missingStyles, missingVariables, missingFonts }))
}
return { styleMap, variableMap, fonts: fonts.filter(f => requiredFonts.includes(f.fontName.family)).map(f => f.fontName) }
```

Expected: all missing arrays are empty.

- [ ] **Step 2: Create the official instance and a responsive wrapper**

Create a vertical auto-layout wrapper named `Footer / Primer + FORUM`, append an instance of the selected Primer variant, and place the wrapper to the right of existing top-level content for safe staging. Use a fixed width of `1248`, white `color/bg/default`, and no card radius or shadow. Return the IDs of the wrapper and instance.

The write script must follow this structure:

```js
const variant = await figma.getNodeByIdAsync(primerVariantId)
if (!variant || variant.type !== "COMPONENT") throw new Error("Primer footer variant is unavailable")
const wrapper = figma.createAutoLayout("VERTICAL", { name: "Footer / Primer + FORUM", itemSpacing: 0 })
wrapper.resize(1248, 240)
wrapper.layoutSizingHorizontal = "FIXED"
wrapper.layoutSizingVertical = "HUG"
const instance = variant.createInstance()
wrapper.appendChild(instance)
instance.layoutSizingHorizontal = "FILL"
wrapper.x = Math.max(...figma.currentPage.children.map(n => n.x + n.width)) + 100
wrapper.y = 0
return { createdNodeIds: [wrapper.id, instance.id], mutatedNodeIds: [], footerWrapperId: wrapper.id, primerInstanceId: instance.id }
```

Expected: the official instance remains `INSTANCE`, fills the 1248 px wrapper width, and its main component belongs to the imported Primer set.

- [ ] **Step 3: Apply confirmed copy through supported instance overrides**

Use this ordered copy model:

```js
const copy = [
  { text: "АСТ «Форум»", style: "FORUM / Heading / Section", color: "color/text/primary" },
  { text: "Платформа для участников строительства", style: "FORUM / Body / Regular", color: "color/text/secondary" },
  { text: "О платформе", style: "FORUM / Body / Regular", color: "color/text/secondary" },
  { text: "Для заказчиков", style: "FORUM / Body / Regular", color: "color/text/secondary" },
  { text: "Для исполнителей", style: "FORUM / Body / Regular", color: "color/text/secondary" },
  { text: "Контакты", style: "FORUM / Body / Regular", color: "color/text/secondary" },
  { text: "© 2026 АСТ «Форум»", style: "FORUM / Body / Small", color: "color/text/secondary" },
  { text: "Согласие на обработку персональных данных", style: "FORUM / Body / Small", color: "color/text/secondary" },
  { text: "Политика конфиденциальности", style: "FORUM / Body / Small", color: "color/text/secondary" }
]
```

Sort the instance text layers by absolute `y`, then absolute `x`. Load every current font with `Promise.all`, apply copy items to the available layers in order, apply the exact local Text Style IDs, and bind each solid text fill to the named color variable. Hide unused original Primer text layers.

If the official instance exposes fewer than nine writable text layers, create only the missing items as sibling `TEXT` nodes in a `FORUM / Required footer content` auto-layout frame below the instance. Apply the same exact styles and variable bindings. This is the allowed wrapper fallback; do not detach the Primer instance.

Return every text ID whose content, style, fill, or visibility changed.

- [ ] **Step 4: Add or bind the divider and background**

Bind the wrapper fill to `color/bg/default`. Reuse a divider already present in the official component when available; bind its solid stroke or solid fill to `color/border/default`. If no divider exists, create one `RECTANGLE` named `Footer divider`, size it to `1248 × 1`, insert it before the legal row, and bind its fill to `color/border/default`.

Expected: no raw new color values, radius, or shadow are introduced.

- [ ] **Step 5: Visually validate the staging composition**

Call `await wrapper.screenshot({ scale: 1 })` and inspect:

- brand name uses Unbounded and is not clipped;
- body and legal copy use Golos Text;
- all nine confirmed strings are visible exactly once;
- no GitHub-specific text or logo remains visible;
- no overlaps, text threads, or clipped legal links exist.

Fix any failed item before moving the footer into the landing.

---

### Task 3: Replace the local footer and validate the landing

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, nodes `13:2` and `7:3940`
- Remove after validation: local footer instance `101:80`

**Interfaces:**
- Consumes: `footerWrapperId` and `primerInstanceId` from Task 2.
- Produces: final footer node ID, updated parent-frame heights, and final structural audit.

- [ ] **Step 1: Move the validated wrapper into the conversion section**

Capture the old footer index, position, width, height, and layout placement. Insert the wrapper at the same child index under `13:2`; then set `layoutPositioning = "ABSOLUTE"`, `layoutSizingHorizontal = "FIXED"`, `layoutSizingVertical = "HUG"`, width `1248`, `x = 96`, and `y = 1937`. Keep `101:80` visible until the new footer is in place and validated.

Return the wrapper, Primer instance, conversion section, and landing node IDs as mutated IDs.

- [ ] **Step 2: Resize only the two required parent frames**

Compute the height delta from the new footer bottom:

```js
const requiredSectionHeight = footer.y + footer.height
const sectionDelta = Math.max(0, requiredSectionHeight - section.height)
section.resize(section.width, section.height + sectionDelta)
landing.resize(landing.width, landing.height + sectionDelta)
```

After `resize()`, restore the existing `layoutSizingHorizontal`, `layoutSizingVertical`, `primaryAxisSizingMode`, and `counterAxisSizingMode` values captured before the resize. Do not move or resize any sibling section.

- [ ] **Step 3: Run the structural acceptance audit**

Use a read-only `use_figma` script and require all assertions to pass:

```js
const footer = await figma.getNodeByIdAsync(footerWrapperId)
const primer = await figma.getNodeByIdAsync(primerInstanceId)
if (!footer || footer.type !== "FRAME" || !primer || primer.type !== "INSTANCE") throw new Error("Final footer structure is missing")
const main = await primer.getMainComponentAsync()
const set = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null
const texts = footer.findAllWithCriteria({ types: ["TEXT"] })
const renderedCopy = texts.filter(n => n.visible).map(n => n.characters)
const requiredCopy = [
  "АСТ «Форум»",
  "Платформа для участников строительства",
  "О платформе",
  "Для заказчиков",
  "Для исполнителей",
  "Контакты",
  "© 2026 АСТ «Форум»",
  "Согласие на обработку персональных данных",
  "Политика конфиденциальности"
]
return {
  isAttachedPrimerInstance: Boolean(main && main.remote && set && set.key === "ecbd4c9b2adb690db9fc4baab925ba5c7915b4a9"),
  missingCopy: requiredCopy.filter(value => !renderedCopy.includes(value)),
  duplicateCopy: requiredCopy.filter(value => renderedCopy.filter(actual => actual === value).length !== 1),
  textAudit: texts.map(n => ({ id: n.id, text: n.characters, styleId: n.textStyleId, boundVariables: n.boundVariables || {} })),
  footerBounds: { x: footer.x, y: footer.y, width: footer.width, height: footer.height },
  parentBounds: footer.parent && "width" in footer.parent ? { width: footer.parent.width, height: footer.parent.height } : null
}
```

Expected: `isAttachedPrimerInstance: true`, `missingCopy: []`, and `duplicateCopy: []`. Every visible text node must reference one of the three required local Text Style IDs and expose a fill-color variable binding.

- [ ] **Step 4: Run the visual acceptance check**

Capture screenshots of the final footer and the full landing node `7:3940`. Confirm:

- the footer aligns to the 96 px left and right landing margins;
- the conversion section does not clip the footer;
- the footer does not look like a floating card;
- Primer structure remains visible while FORUM typography and colors dominate;
- all legal copy remains legible at the full-landing scale.

- [ ] **Step 5: Remove the obsolete local footer and save an undo checkpoint**

Only after Steps 3 and 4 pass, remove node `101:80`, return it as `removedNodeIds: ["101:80"]`, and call `figma.commitUndo()` after the successful removal. Re-run the structural audit to confirm no copy disappeared with the old instance.

- [ ] **Step 6: Final metadata and screenshot verification**

Call `get_metadata` on `7:3940` and `get_screenshot` on both the final footer and `7:3940`. The task is complete only when the footer remains inside `13:2`, the official Primer instance is attached, text and color tokens are bound, no duplicate local footer remains, and the screenshots show no clipping or overlap.
