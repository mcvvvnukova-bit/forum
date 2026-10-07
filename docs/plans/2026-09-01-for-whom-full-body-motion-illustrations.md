# For-Whom Full-Body Motion Illustrations Implementation Plan

Исторический технический план от 2026-09-01. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l).

Происхождение: `docs/superpowers/plans/2026-09-01-for-whom-full-body-motion-illustrations.md`, SHA-256 `5b61c11d07c4f84b230e56576fa6bbb72f6d3cdf3e61e996c6284fba331243a9`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать четыре preview-иллюстрации персонажей «Для кого» в полный рост, в движении, и показать их в чате.

**Architecture:** Каждая роль генерируется отдельным вызовом встроенного `image_gen` с общим стилевым описанием. Результаты остаются preview-only в папке Codex, затем при необходимости очищаются от нарисованной шахматной подложки в отдельной preview-папке, без изменений Figma и без замены ассетов лендинга.

**Tech Stack:** встроенный `image_gen`, PNG preview-файлы, bundled Python/Pillow для проверки и очистки прозрачности при необходимости, `sips`.

## Technical constraints

- Исходные файлы и выбранный результат хранить раздельно до проверки.
- Проверять PNG dimensions/alpha и ссылки на сохранённые originals; визуальные требования брать из Outline.
- Перед заменой Figma fills проверить node IDs, исходные image hashes и сохранить возможность отмены.
- Preview-only исходники не становятся runtime assets без отдельного решения.

---

### Task 1: Сгенерировать четыре preview-иллюстрации

**Files:**
- Create: `/path/to/preview-output/customer-full-body-motion-preview.png`
- Create: `/path/to/preview-output/supplier-full-body-motion-preview.png`
- Create: `/path/to/preview-output/contractor-full-body-motion-preview.png`
- Create: `/path/to/preview-output/independent-specialist-full-body-motion-preview.png`

**Interfaces:**
- Consumes: утверждённая спецификация [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-illyustracii-dlya-kogo-polnyj-rost-i-dvizhenie-541f10d3-1GhDaew5ru).
- Produces: четыре preview PNG в стандартной папке `image_gen`.

- [ ] **Step 1: Сгенерировать заказчика**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l).

- [ ] **Step 2: Сгенерировать поставщика**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l).

- [ ] **Step 3: Сгенерировать исполнителя**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l).

- [ ] **Step 4: Сгенерировать частного специалиста**

Продуктовые тексты/промпт этого шага: [точный исторический источник](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l).

### Task 2: Проверить и показать preview

**Files:**
- Verify: generated preview PNG files
- Create: optional cleaned preview PNG files under `/path/to/preview-output/`

**Interfaces:**
- Consumes: четыре generated preview PNG.
- Produces: четыре изображения, показанные пользователю в чате.

- [ ] **Step 1: Проверить формат**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha /path/to/preview-output/*.png
```

Expected: изображения квадратные; если `hasAlpha: no`, создать cleaned preview-копии с альфа-каналом.

- [ ] **Step 2: Показать изображения в чате**

```markdown
```

Expected: пользователь видит четыре новые картинки, Figma и проектные ассеты не менялись.

Original linked previews and their design context are preserved in [Outline](https://docs.astforum.ru/doc/istochnik-06102026-for-whom-full-body-motion-illustrations-implementation-plan-5b61c11d-yOM6PlWg9l). They are historical preview-only originals, not runtime replacements.
