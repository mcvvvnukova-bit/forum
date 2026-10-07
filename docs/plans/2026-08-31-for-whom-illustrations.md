# For-Whom Illustrations Implementation Plan

Исторический технический план от 2026-08-31. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

Происхождение: `docs/superpowers/plans/2026-08-31-for-whom-illustrations.md`, SHA-256 `1e5e04a7ff1ab5b8998b761ba3f6ecc5b23f75e51af946de3004d51961c7ce6b`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать и сохранить четыре согласованные персонажные PNG-иллюстрации для блока лендинга «Для кого».

**Architecture:** Каждая роль генерируется отдельным вызовом встроенного `image_gen` с одним стилевым референсом — `deployment/astforum-static/forum-hard-hat.png`. Каждый результат проверяется визуально, переносится в целевую папку и валидируется как квадратный PNG с альфа-каналом; затем вся серия проверяется совместно.

**Tech Stack:** встроенный `image_gen`, `view_image`, PNG, `sips`, Git.

## Technical constraints

- Исходные файлы и выбранный результат хранить раздельно до проверки.
- Проверять PNG dimensions/alpha и ссылки на сохранённые originals; визуальные требования брать из Outline.
- Перед заменой Figma fills проверить node IDs, исходные image hashes и сохранить возможность отмены.
- Preview-only исходники не становятся runtime assets без отдельного решения.

---

### Task 1: Подготовить каталог и референс

**Files:**
- Reference: `deployment/astforum-static/forum-hard-hat.png`
- Create: `deployment/astforum-static/assets/landing/for-whom/`

**Interfaces:**
- Consumes: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-illyustracii-dlya-bloka-dlya-kogo-c2286387-QrG6VkztvZ).
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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

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

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-illustrations-implementation-plan-1e5e04a7-a1Aql2mxhD).

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
