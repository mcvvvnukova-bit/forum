# For-Whom Icon Illustrations Redraw Implementation Plan

Исторический технический план от 2026-08-31. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-icon-illustrations-redraw-implementation-plan-52ec04de-ZMIXkdP8nZ).

Происхождение: `docs/superpowers/plans/2026-08-31-for-whom-icon-illustrations-redraw.md`, SHA-256 `52ec04de49560d07894884f9a0be8fd3f4c04f064593e848c183c95ffd12f509`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перерисовать четыре иллюстрации блока «Для кого» в более иконографичном стиле и заменить ими картинки в пяти Figma-композициях.

**Architecture:** Сначала создаются четыре новые прозрачные PNG-иллюстрации как project-bound assets с суффиксом `-icon.png`, чтобы не потерять текущие файлы. Затем новые PNG загружаются в Figma через image fills, служебные asset nodes обновляются, а все 20 image nodes в пяти вариантах получают новые hashes с точечной проверкой масштаба и пересечений.

**Tech Stack:** встроенный `image_gen`, PNG с альфа-каналом, Figma Plugin API через `use_figma`, `sips`, Git.

## Technical constraints

- Исходные файлы и выбранный результат хранить раздельно до проверки.
- Проверять PNG dimensions/alpha и ссылки на сохранённые originals; визуальные требования брать из Outline.
- Перед заменой Figma fills проверить node IDs, исходные image hashes и сохранить возможность отмены.
- Preview-only исходники не становятся runtime assets без отдельного решения.

---

### Task 1: Зафиксировать утверждённый дизайн и рабочее состояние

**Files:**
- Create: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-pererisovka-illyustracij-dlya-kogo-blizhe-k-ikonkam-87038148-UnU3meWHXX)
- Create: `docs/plans/2026-08-31-for-whom-icon-illustrations-redraw.md`
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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-icon-illustrations-redraw-implementation-plan-52ec04de-ZMIXkdP8nZ).

- [ ] **Step 2: Сгенерировать `supplier-icon.png`**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-icon-illustrations-redraw-implementation-plan-52ec04de-ZMIXkdP8nZ).

- [ ] **Step 3: Сгенерировать `contractor-icon.png`**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-icon-illustrations-redraw-implementation-plan-52ec04de-ZMIXkdP8nZ).

- [ ] **Step 4: Сгенерировать `independent-specialist-icon.png`**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-icon-illustrations-redraw-implementation-plan-52ec04de-ZMIXkdP8nZ).

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
- Modify: `docs/plans/2026-08-31-for-whom-icon-illustrations-redraw.md`

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
