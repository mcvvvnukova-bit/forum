# For-Whom Icon Illustrations Redraw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перерисовать четыре иллюстрации блока «Для кого» в более иконографичном стиле и заменить ими картинки в пяти Figma-композициях.

**Architecture:** Сначала создаются четыре новые прозрачные PNG-иллюстрации как project-bound assets с суффиксом `-icon.png`, чтобы не потерять текущие файлы. Затем новые PNG загружаются в Figma через image fills, служебные asset nodes обновляются, а все 20 image nodes в пяти вариантах получают новые hashes с точечной проверкой масштаба и пересечений.

**Tech Stack:** встроенный `image_gen`, PNG с альфа-каналом, Figma Plugin API через `use_figma`, `sips`, Git.

## Global Constraints

- Сохранять исходный блок Figma `12:2` без изменений.
- Не менять текст карточек, шрифты, размеры фреймов и порядок пяти вариантов.
- Новые иллюстрации должны быть прозрачными квадратными PNG.
- Стиль: плоские иконки-персонажи, чёрный контур, белые/светло-серые плоскости, оранжево-красные акценты, минимум мелкой детализации.
- Поставщик: коробки и погрузчик.
- Исполнитель: каска, экскаватор и бара как компактный строительный рабочий предмет.
- Частный специалист: молоток, гаечный ключ и шуруповёрт.
- Без текста, логотипов, водяных знаков и псевдонадписей внутри изображений.
- Не трогать существующие несвязанные dirty-worktree изменения.

---

### Task 1: Зафиксировать утверждённый дизайн и рабочее состояние

**Files:**
- Create: `docs/superpowers/specs/2026-08-31-for-whom-icon-illustrations-redraw-design.md`
- Create: `docs/superpowers/plans/2026-08-31-for-whom-icon-illustrations-redraw.md`
- Read: `deployment/astforum-static/assets/landing/for-whom/*.png`

**Interfaces:**
- Consumes: утверждение пользователя по стилю и реквизиту.
- Produces: согласованный документ и план, на которые опираются генерация и Figma-замена.

- [ ] **Step 1: Проверить git status**

```bash
git status --short
```

Expected: видны только существующие unrelated changes плюс новые документы после их создания.

- [ ] **Step 2: Проверить текущие PNG**

```bash
file deployment/astforum-static/assets/landing/for-whom/*.png
```

Expected: четыре текущих PNG имеют RGBA.

- [ ] **Step 3: Закоммитить документы**

```bash
git add docs/superpowers/specs/2026-08-31-for-whom-icon-illustrations-redraw-design.md docs/superpowers/plans/2026-08-31-for-whom-icon-illustrations-redraw.md
git commit -m "docs: plan for-whom icon illustration redraw"
```

Expected: коммит содержит только два новых markdown-файла.

### Task 2: Сгенерировать четыре icon-style PNG

**Files:**
- Create: `deployment/astforum-static/assets/landing/for-whom/customer-icon.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/supplier-icon.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/contractor-icon.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/independent-specialist-icon.png`

**Interfaces:**
- Consumes: спецификацию стиля из Task 1.
- Produces: четыре локальных ассета для загрузки в Figma.

- [ ] **Step 1: Сгенерировать `customer-icon.png`**

```text
Use case: stylized-concept
Asset type: transparent square landing-page audience icon illustration
Primary request: redraw the customer role as an icon-like character in a working situation
Subject: one construction project client with a simplified estimate sheet, blueprint, or tablet, communicating planning, control, and decision-making
Style/medium: flat character icon, bold clean black outline, white and light-gray surfaces, restrained orange-red accents, simple geometric shapes, minimal detail
Composition/framing: centered compact silhouette, square composition, generous transparent padding, readable at small card size
Constraints: genuinely transparent background; no text; no logo; no watermark; no pseudo letters; no extra people; no detailed scene background
Avoid: photorealism, complex shading, busy props, small illegible details, background rectangle
```

- [ ] **Step 2: Сгенерировать `supplier-icon.png`**

```text
Use case: stylized-concept
Asset type: transparent square landing-page audience icon illustration
Primary request: redraw the supplier role as an icon-like character in a working supply situation
Subject: one construction-material supplier with simplified boxes and a compact forklift silhouette; the forklift reads clearly but stays secondary to the character and boxes
Style/medium: flat character icon, bold clean black outline, white and light-gray surfaces, restrained orange-red accents, simple geometric shapes, minimal detail
Composition/framing: centered compact silhouette, square composition, generous transparent padding, readable at small card size
Constraints: genuinely transparent background; no text; no logo; no watermark; no pseudo letters; no extra people; boxes and forklift must both be present; no detailed warehouse background
Avoid: photorealism, complex shading, overloaded box stacks, tiny mechanical details, background rectangle
```

- [ ] **Step 3: Сгенерировать `contractor-icon.png`**

```text
Use case: stylized-concept
Asset type: transparent square landing-page audience icon illustration
Primary request: redraw the contractor role as an icon-like construction worker in a working situation
Subject: one contractor wearing a hard hat, with a simplified excavator silhouette and a compact construction mortar tub or wheelbarrow-like container
Style/medium: flat character icon, bold clean black outline, white and light-gray surfaces, restrained orange-red accents, simple geometric shapes, minimal detail
Composition/framing: centered compact silhouette, square composition, generous transparent padding, readable at small card size
Constraints: genuinely transparent background; no text; no logo; no watermark; no pseudo letters; no extra people; hard hat, excavator, and tub/container must all be present; no detailed construction-site background
Avoid: photorealism, complex shading, oversized excavator, cluttered jobsite, background rectangle
```

- [ ] **Step 4: Сгенерировать `independent-specialist-icon.png`**

```text
Use case: stylized-concept
Asset type: transparent square landing-page audience icon illustration
Primary request: redraw the independent specialist role as an icon-like self-employed craft specialist in a working situation
Subject: one private specialist with three simplified tools: hammer, wrench, and screwdriver/drill; tools are clear, simple, and part of the same compact composition
Style/medium: flat character icon, bold clean black outline, white and light-gray surfaces, restrained orange-red accents, simple geometric shapes, minimal detail
Composition/framing: centered compact silhouette, square composition, generous transparent padding, readable at small card size
Constraints: genuinely transparent background; no text; no logo; no watermark; no pseudo letters; no extra people; hammer, wrench, and screwdriver/drill must all be present; no detailed room background
Avoid: photorealism, complex shading, messy tool pile, malformed hands, background rectangle
```

- [ ] **Step 5: Проверить форматы**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/*-icon.png
```

Expected: все четыре файла квадратные PNG с `hasAlpha: yes`.

### Task 3: Загрузить новые ассеты в Figma и заменить fills

**Files:**
- Read: `deployment/astforum-static/assets/landing/for-whom/customer-icon.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/supplier-icon.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/contractor-icon.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/independent-specialist-icon.png`
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`

**Interfaces:**
- Consumes: four local icon PNG assets.
- Produces: updated Figma image fills in `Assets — Для кого` and all five variants.

- [ ] **Step 1: Inspect target Figma nodes**

```javascript
const page = figma.root.children.find(p => p.name === "Landing page");
await figma.setCurrentPageAsync(page);
const targetNames = [
  "Assets — Для кого",
  "Для кого — V1 — Сценарная лента",
  "Для кого — V2 — Центральный хаб",
  "Для кого — V3 — Бескарточная галерея",
  "Для кого — V4 — Каскад",
  "Для кого — V5 — Сценическая композиция"
];
return targetNames.map(name => {
  const node = page.children.find(child => child.name === name);
  return { name, id: node?.id ?? null, type: node?.type ?? null, width: node?.width ?? null, height: node?.height ?? null };
});
```

Expected: all six top-level frames exist.

- [ ] **Step 2: Upload PNG bytes**

Use four upload endpoints produced by a `use_figma` script and POST each local PNG with `Content-Type: image/png`.

Expected: returned image hashes for customer, supplier, contractor, and independent specialist.

- [ ] **Step 3: Replace image fills**

```javascript
// Before running this script, assign the exact four hashes returned by Step 2
// to this object. Do not use temporary strings or guessed values.
const hashes = roleHashes;
const page = figma.root.children.find(p => p.name === "Landing page");
await figma.setCurrentPageAsync(page);
const mutated = [];
const roleMatchers = [
  { key: "customer", patterns: ["customer", "заказчик"] },
  { key: "supplier", patterns: ["supplier", "поставщик"] },
  { key: "contractor", patterns: ["contractor", "исполнитель"] },
  { key: "independent", patterns: ["independent", "specialist", "частный"] }
];
const roots = ["Assets — Для кого", "Для кого — V1 — Сценарная лента", "Для кого — V2 — Центральный хаб", "Для кого — V3 — Бескарточная галерея", "Для кого — V4 — Каскад", "Для кого — V5 — Сценическая композиция"]
  .map(name => page.children.find(child => child.name === name))
  .filter(Boolean);
for (const root of roots) {
  const imageNodes = root.findAll(node => "fills" in node && Array.isArray(node.fills) && node.fills.some(fill => fill.type === "IMAGE"));
  for (const node of imageNodes) {
    const lowName = node.name.toLowerCase();
    const role = roleMatchers.find(item => item.patterns.some(pattern => lowName.includes(pattern)));
    if (!role) continue;
    node.fills = [{ type: "IMAGE", imageHash: hashes[role.key], scaleMode: "FIT" }];
    mutated.push(node.id);
  }
}
return { mutatedNodeIds: mutated, count: mutated.length };
```

Expected: 24 mutated image nodes: four asset nodes plus 20 variant nodes.

### Task 4: Verify Figma and local outputs

**Files:**
- Verify: `deployment/astforum-static/assets/landing/for-whom/*-icon.png`
- Modify: `docs/superpowers/plans/2026-08-31-for-whom-icon-illustrations-redraw.md`

**Interfaces:**
- Consumes: updated Figma variants and local assets.
- Produces: verification evidence and final committed assets.

- [ ] **Step 1: Run structural Figma audit**

```javascript
const page = figma.root.children.find(p => p.name === "Landing page");
await figma.setCurrentPageAsync(page);
const variantNames = ["Для кого — V1 — Сценарная лента", "Для кого — V2 — Центральный хаб", "Для кого — V3 — Бескарточная галерея", "Для кого — V4 — Каскад", "Для кого — V5 — Сценическая композиция"];
return variantNames.map(name => {
  const frame = page.children.find(child => child.name === name);
  const images = frame.findAll(node => "fills" in node && Array.isArray(node.fills) && node.fills.some(fill => fill.type === "IMAGE"));
  const texts = frame.findAllWithCriteria({ types: ["TEXT"] }).map(node => node.characters);
  return { name, id: frame.id, imageCount: images.length, textCount: texts.length, hasTexts: texts.includes("Заказчик") && texts.includes("Поставщик") && texts.includes("Исполнитель") && texts.includes("Частный специалист") };
});
```

Expected: every variant has four image nodes and all four role labels.

- [ ] **Step 2: Inspect screenshots**

Capture screenshots of the five variant frames and the service asset frame.

Expected: new images are visible, icon-like, not blank, not covering card text, and important props are not cropped.

- [ ] **Step 3: Record execution notes and commit**

```bash
git add deployment/astforum-static/assets/landing/for-whom/customer-icon.png deployment/astforum-static/assets/landing/for-whom/supplier-icon.png deployment/astforum-static/assets/landing/for-whom/contractor-icon.png deployment/astforum-static/assets/landing/for-whom/independent-specialist-icon.png docs/superpowers/plans/2026-08-31-for-whom-icon-illustrations-redraw.md
git commit -m "feat: redraw for-whom illustrations as icons"
```

Expected: commit contains only four new icon PNG files and the completed plan notes.
