# For-Whom Illustrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать и сохранить четыре согласованные персонажные PNG-иллюстрации для блока лендинга «Для кого».

**Architecture:** Каждая роль генерируется отдельным вызовом встроенного `image_gen` с одним стилевым референсом — `deployment/astforum-static/forum-hard-hat.png`. Каждый результат проверяется визуально, переносится в целевую папку и валидируется как квадратный PNG с альфа-каналом; затем вся серия проверяется совместно.

**Tech Stack:** встроенный `image_gen`, `view_image`, PNG, `sips`, Git.

## Global Constraints

- Четыре отдельных квадратных PNG-файла с прозрачным фоном.
- Одинаковые масштаб персонажей, ракурс ¾, толщина контура, палитра и детализация.
- Чёрный рисованный контур, белые и светло-серые заливки, оранжево-красные акценты, лёгкие глянцевые блики и мягкая объёмная штриховка.
- Полуфигурная композиция: один персонаж, одно действие, не более двух смысловых предметов.
- Без текста, водяных знаков, логотипов, псевдологотипов, лишних рук и деформированных инструментов.
- Финальные файлы: `deployment/astforum-static/assets/landing/for-whom/`.

---

### Task 1: Подготовить каталог и референс

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-31-for-whom-illustrations-design.md`.
- Produces: каталог выдачи и единый стилевой референс.

- [ ] **Step 1: Проверить референс**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/forum-hard-hat.png
```

Expected: `1536 × 1024`, `hasAlpha: yes`.

- [ ] **Step 2: Создать каталог**

```bash
mkdir -p deployment/astforum-static/assets/landing/for-whom
```

Expected: каталог существует, другие ассеты не изменены.

### Task 2: Сгенерировать «Заказчика»

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/customer.png`

**Interfaces:**
- Consumes: стилевой референс из Task 1.
- Produces: PNG для карточки «Заказчик».

- [ ] **Step 1: Сгенерировать изображение встроенным `image_gen`**

```text
Use case: stylized-concept
Asset type: square character illustration for a landing-page audience card
Input images: Image 1 is a style reference only; match its bold black hand-drawn contour, white and light-gray fills, orange-red accents, glossy highlights, soft dimensional shading, and clean transparent cutout. Do not copy its composition or logo.
Primary request: a construction project client reviewing a blueprint while marking a decision on a tablet
Subject: one confident project lead, waist-up, three-quarter view; blueprint and tablet are the only semantic props
Style/medium: polished editorial character illustration matching Image 1
Composition/framing: centered compact silhouette, consistent card scale, generous transparent padding
Color palette: black, white, light gray, warm skin tones, restrained orange-red accents
Constraints: genuinely transparent background; no text; no logos; no watermark; no extra people; exactly two natural hands; readable tablet and blueprint; communicate decision-making rather than manual construction work
Avoid: photorealism, detailed background, border, floor rectangle, malformed hands, duplicated props, pseudotext
```

- [ ] **Step 2: Проверить результат через `view_image`**

Expected: роль читается как заказчик; фон прозрачен; анатомия, реквизит, контур и палитра корректны.

- [ ] **Step 3: Сохранить выбранный результат как `customer.png` и проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/customer.png
```

Expected: ширина равна высоте, `hasAlpha: yes`.

### Task 3: Сгенерировать «Поставщика»

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/supplier.png`

**Interfaces:**
- Consumes: стилевой референс и масштаб `customer.png`.
- Produces: PNG для карточки «Поставщик».

- [ ] **Step 1: Сгенерировать изображение встроенным `image_gen`**

```text
Use case: stylized-concept
Asset type: square character illustration for a landing-page audience card
Input images: Image 1 is a style reference only; match its bold black hand-drawn contour, white and light-gray fills, orange-red accents, glossy highlights, soft dimensional shading, and clean transparent cutout. Do not copy its composition or logo.
Primary request: a construction-material supplier checking one compact material package against a delivery note
Subject: one warehouse representative, waist-up, three-quarter view; one small package or material sample and one delivery clipboard are the only semantic props
Style/medium: polished editorial character illustration matching Image 1 and the customer asset
Composition/framing: centered compact silhouette, same character scale and padding as the customer asset
Color palette: black, white, light gray, warm skin tones, restrained orange-red accents
Constraints: genuinely transparent background; no text; no logos; no watermark; no extra people; exactly two natural hands; communicate supply verification rather than heavy cargo loading
Avoid: photorealism, warehouse background, forklift, box stack, border, floor rectangle, malformed hands, pseudotext
```

- [ ] **Step 2: Проверить результат через `view_image`**

Expected: роль читается как поставщик; композиция не перегружена; стиль и масштаб совпадают с `customer.png`.

- [ ] **Step 3: Сохранить результат как `supplier.png` и проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/supplier.png
```

Expected: ширина равна высоте, `hasAlpha: yes`.

### Task 4: Сгенерировать «Исполнителя»

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/contractor.png`

**Interfaces:**
- Consumes: стилевой референс и масштаб предыдущих иллюстраций.
- Produces: PNG для карточки «Исполнитель».

- [ ] **Step 1: Сгенерировать изображение встроенным `image_gen`**

```text
Use case: stylized-concept
Asset type: square character illustration for a landing-page audience card
Input images: Image 1 is a style reference only; match its bold black hand-drawn contour, white and light-gray fills, orange-red accents, glossy highlights, soft dimensional shading, and clean transparent cutout. Do not reproduce its logo.
Primary request: a construction contractor actively performing work while checking alignment with a spirit level
Subject: one skilled site worker in protective helmet and gloves, waist-up, three-quarter view; one compact hand tool and one spirit level are the only semantic props
Style/medium: polished editorial character illustration matching the existing series
Composition/framing: centered compact silhouette, same character scale and padding as the other assets
Color palette: black, white, light gray, warm skin tones, restrained orange-red accents
Constraints: genuinely transparent background; no text; no logos; no watermark; no extra people; exactly two natural hands; safe plausible grip; clearly communicate construction work
Avoid: photorealism, building-site background, border, floor rectangle, malformed hands, floating tools, pseudotext
```

- [ ] **Step 2: Проверить результат через `view_image`**

Expected: персонаж читается как исполнитель; СИЗ и хват инструмента правдоподобны; стиль совпадает с серией.

- [ ] **Step 3: Сохранить результат как `contractor.png` и проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/contractor.png
```

Expected: ширина равна высоте, `hasAlpha: yes`.

### Task 5: Сгенерировать «Частного специалиста»

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/independent-specialist.png`

**Interfaces:**
- Consumes: стилевой референс и масштаб предыдущих иллюстраций.
- Produces: PNG для карточки «Частный специалист».

- [ ] **Step 1: Сгенерировать изображение встроенным `image_gen`**

```text
Use case: stylized-concept
Asset type: square character illustration for a landing-page audience card
Input images: Image 1 is a style reference only; match its bold black hand-drawn contour, white and light-gray fills, orange-red accents, glossy highlights, soft dimensional shading, and clean transparent cutout. Do not copy its composition or logo.
Primary request: an independent construction specialist taking a precise measurement with a handheld laser distance meter
Subject: one self-employed engineer, waist-up, three-quarter view; laser distance meter and a compact tablet or tool bag are the only semantic props
Style/medium: polished editorial character illustration matching the existing series
Composition/framing: centered compact silhouette, same character scale and padding as the other assets
Color palette: black, white, light gray, warm skin tones, restrained orange-red accents
Constraints: genuinely transparent background; no text; no logos; no watermark; no extra people; exactly two natural hands; plausible measurement pose; communicate personal expertise and independent work
Avoid: photorealism, room background, border, floor rectangle, malformed hands, oversized equipment, pseudotext
```

- [ ] **Step 2: Проверить результат через `view_image`**

Expected: роль отличается от заказчика и исполнителя; измерительное действие понятно; стиль совпадает с серией.

- [ ] **Step 3: Сохранить результат как `independent-specialist.png` и проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/independent-specialist.png
```

Expected: ширина равна высоте, `hasAlpha: yes`.

### Task 6: Проверить и зафиксировать серию

**Files:**
- Verify: `deployment/astforum-static/assets/landing/for-whom/customer.png`
- Verify: `deployment/astforum-static/assets/landing/for-whom/supplier.png`
- Verify: `deployment/astforum-static/assets/landing/for-whom/contractor.png`
- Verify: `deployment/astforum-static/assets/landing/for-whom/independent-specialist.png`

**Interfaces:**
- Consumes: четыре изображения из Tasks 2–5.
- Produces: проверенную серию лендинговых ассетов.

- [ ] **Step 1: Просмотреть четыре изображения через `view_image`**

Expected: одинаковые масштаб, ракурс, контур, акцентный цвет и детализация; роли различаются действием и реквизитом.

- [ ] **Step 2: При необходимости точечно исправить только несогласованный результат**

```text
Change only the identified mismatch. Preserve the character identity, pose, props, transparent background, black contour, white/light-gray fills, orange-red accents, image dimensions, padding, and every other approved detail. Add no text, logos, watermark, or new objects.
```

Expected: исправлено только выявленное несоответствие.

- [ ] **Step 3: Проверить все четыре файла**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha deployment/astforum-static/assets/landing/for-whom/*.png
```

Expected: четыре квадратных PNG одинакового размера, каждый с `hasAlpha: yes`.

- [ ] **Step 4: Зафиксировать ассеты отдельным коммитом**

```bash
git add deployment/astforum-static/assets/landing/for-whom/customer.png deployment/astforum-static/assets/landing/for-whom/supplier.png deployment/astforum-static/assets/landing/for-whom/contractor.png deployment/astforum-static/assets/landing/for-whom/independent-specialist.png
git commit -m "feat: add for-whom landing illustrations"
```

Expected: коммит содержит только четыре финальных PNG-файла.
