# For-Whom Full-Body Motion Illustrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать четыре preview-иллюстрации персонажей «Для кого» в полный рост, в движении, и показать их в чате.

**Architecture:** Каждая роль генерируется отдельным вызовом встроенного `image_gen` с общим стилевым описанием. Результаты остаются preview-only в папке Codex, затем при необходимости очищаются от нарисованной шахматной подложки в отдельной preview-папке, без изменений Figma и без замены ассетов лендинга.

**Tech Stack:** встроенный `image_gen`, PNG preview-файлы, bundled Python/Pillow для проверки и очистки прозрачности при необходимости, `sips`.

## Global Constraints

- Figma не изменять.
- Текущие ассеты лендинга не заменять.
- Четыре роли: заказчик, поставщик, исполнитель, частный специалист.
- Все персонажи в полный рост и в активном движении.
- Стиль: современная 2D-мультяшная строительная иллюстрация, крупный чёрный контур, бело-серая спецодежда, оранжево-красные акценты.
- Исполнитель без экскаватора.
- Заказчик с естественно удерживаемым рулоном чертежа; допускается маленькое строящееся здание.
- Без текста, логотипов, псевдонадписей, водяных знаков и фоновой сцены.

---

### Task 1: Сгенерировать четыре preview-иллюстрации

**Files:**
- Create: `/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/customer-full-body-motion-preview.png`
- Create: `/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/supplier-full-body-motion-preview.png`
- Create: `/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/contractor-full-body-motion-preview.png`
- Create: `/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/independent-specialist-full-body-motion-preview.png`

**Interfaces:**
- Consumes: утверждённая спецификация `docs/superpowers/specs/2026-09-01-for-whom-full-body-motion-illustrations-design.md`.
- Produces: четыре preview PNG в стандартной папке `image_gen`.

- [ ] **Step 1: Сгенерировать заказчика**

```text
Full-body cartoon construction project customer, walking while using a tablet and carrying a rolled blueprint naturally, with a small building-under-construction prop, transparent background.
```

- [ ] **Step 2: Сгенерировать поставщика**

```text
Full-body cartoon construction-material supplier walking while carrying a box, with secondary boxes and compact forklift props, transparent background.
```

- [ ] **Step 3: Сгенерировать исполнителя**

```text
Full-body cartoon construction contractor digging or moving a wheelbarrow, no excavator, transparent background.
```

- [ ] **Step 4: Сгенерировать частного специалиста**

```text
Full-body cartoon private specialist measuring or moving with hammer, wrench, and cordless screwdriver/drill visible, transparent background.
```

### Task 2: Проверить и показать preview

**Files:**
- Verify: generated preview PNG files
- Create: optional cleaned preview PNG files under `/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/`

**Interfaces:**
- Consumes: четыре generated preview PNG.
- Produces: четыре изображения, показанные пользователю в чате.

- [ ] **Step 1: Проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha /Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/*.png
```

Expected: изображения квадратные; если `hasAlpha: no`, создать cleaned preview-копии с альфа-каналом.

- [ ] **Step 2: Показать изображения в чате**

```markdown
![Заказчик](/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/customer-full-body-motion-preview.png)
![Поставщик](/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/supplier-full-body-motion-preview.png)
![Исполнитель](/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/contractor-full-body-motion-preview.png)
![Частный специалист](/Users/vvv/.codex/visualizations/2026/09/01/for-whom-full-body-motion/independent-specialist-full-body-motion-preview.png)
```

Expected: пользователь видит четыре новые картинки, Figma и проектные ассеты не менялись.
