# Hierarchical OKVED Directory FigJam Implementation Plan

Исторический технический план от 2026-08-21. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-hierarchical-okved-directory-figjam-implementation-plan-e192f4bb-8EvA4Qaw7O).

Происхождение: `docs/superpowers/plans/2026-08-21-okved-hierarchical-directory-figjam.md`, SHA-256 `e192f4bbe6df22d855c557658b156bab7973acf9d207e033977e4291d84d90eb`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обновить существующую FigJam ER-диаграмму, добавив иерархический справочник строительных ОКВЭД, три аналитических справочника и все согласованные связи.

**Architecture:** `okveds` хранит канонические текстовые коды, самоссылочную иерархию и по одному nullable-внешнему ключу на каждое аналитическое измерение. `company_okveds.code` становится внешним ключом на `okveds.code`; бизнес-сегменты, коммерческие роли и типы предложения представлены самостоятельными справочниками.

**Tech Stack:** PostgreSQL logical schema, Figma FigJam TableNode и ConnectorNode, Figma Plugin API через `use_figma`.

## Global Constraints

- Изменяется доска `https://www.figma.com/board/ZfpxFolI3ywaEHvvi4vAyD`.
- Сохраняется порядок колонок таблиц: тип ключа, название поля, тип данных, комментарий.
- Полные ОКВЭД хранятся как `varchar8`, не как число.
- У каждого ОКВЭД допускается максимум один бизнес-сегмент, одна коммерческая роль и один тип предложения.
- Аналитические внешние ключи nullable до завершения классификации.
- Существующие таблицы и связи, кроме ключа `company_okveds.code`, не изменяются.

---

### Task 1: Проверить исходную ER-диаграмму и обновить `company_okveds`

**Files:**
- Reference: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-ierarhicheskij-spravochnik-stroitelnyh-okved-059977e3-R9m1XtxsdR)
- Modify remotely: FigJam table `company_okveds`, node `2:70`

**Interfaces:**
- Consumes: существующее поле `company_okveds.code varchar8` с ключом `PK`.
- Produces: поле `company_okveds.code varchar8` с ключом `PK,FK`, готовое к связи с `okveds.code`.

- [ ] **Step 1: Прочитать узел `2:70` через `get_figjam`**

Проверить, что таблица называется `company_okveds`, содержит шесть строк и поле `code` находится в строке 2 с типом `varchar8`.

- [ ] **Step 2: Загрузить текущий шрифт ячейки ключа и изменить `PK` на `PK,FK`**

В `use_figma` получить `table.cellAt(2, 0)`, загрузить `cell.text.fontName`, записать `PK,FK` и вернуть ID таблицы и изменённой ячейки.

- [ ] **Step 3: Проверить изменение**

Повторно прочитать `2:70` и убедиться, что остальные строки остались без изменений.

### Task 2: Добавить четыре справочника

**Files:**
- Reference: [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-ierarhicheskij-spravochnik-stroitelnyh-okved-059977e3-R9m1XtxsdR)
- Create remotely: FigJam tables `okveds`, `business_segments`, `commercial_roles`, `offer_types`

**Interfaces:**
- Consumes: свободное место на текущей FigJam-доске и визуальный стиль существующих таблиц.
- Produces: четыре TableNode с возвращёнными стабильными node ID для построения связей.

- [ ] **Step 1: Создать `okveds`**

Создать таблицу из 11 строк и 4 колонок со значениями:

```text
header: okveds
PK | code | varchar8 |
FK | parent_code | varchar8 | nullable
   | level | smallint |
   | section | char1 |
   | name | text |
FK | business_segment_code | text | nullable
FK | commercial_role_code | text | nullable
FK | offer_type_code | text | nullable
   | created_at | timestamptz |
   | updated_at | timestamptz |
```

Сохранить заголовок светло-синим, размеры колонок по 192 px и высоту обычных строк 64 px; длинные строки допускается увеличить до 88 px.

- [ ] **Step 2: Создать `business_segments`**

Создать таблицу из 6 строк и 3 колонок:

```text
header: business_segments
PK | code | text
UK | name | text
   | description | text
   | created_at | timestamptz
   | updated_at | timestamptz
```

- [ ] **Step 3: Создать `commercial_roles`**

Создать таблицу с той же структурой, заголовком `commercial_roles` и отдельным node ID.

- [ ] **Step 4: Создать `offer_types`**

Создать таблицу с той же структурой, заголовком `offer_types` и отдельным node ID.

- [ ] **Step 5: Проверить таблицы структурно и визуально**

Для каждого node ID вызвать `get_figjam`; затем получить скриншоты и проверить заголовки, порядок колонок, отсутствие обрезанного текста и пересечений с существующими узлами.

### Task 3: Добавить связи и провести итоговую проверку

**Files:**
- Modify remotely: FigJam canvas `0:1`

**Interfaces:**
- Consumes: node ID пяти таблиц: существующей `company_okveds` и четырёх созданных справочников.
- Produces: пять ConnectorNode с ERD-кардинальностями.

- [ ] **Step 1: Добавить связь `okveds → company_okveds`**

Создать коннектор с `ERD_EXACTLY_ONE` на стороне `okveds`, `ERD_ZERO_OR_MORE` на стороне `company_okveds` и подписью `used by companies`.

- [ ] **Step 2: Добавить три аналитические связи**

Для каждого аналитического справочника создать связь к `okveds`: `ERD_ZERO_OR_ONE` на стороне справочника и `ERD_ZERO_OR_MORE` на стороне `okveds`. Подписи: `classifies segment`, `classifies role`, `classifies offer`.

- [ ] **Step 3: Добавить самоссылочную иерархию `okveds`**

Создать self-connector с `ERD_ZERO_OR_ONE` на стороне родителя, `ERD_ZERO_OR_MORE` на стороне дочерних кодов и подписью `parent of`.

- [ ] **Step 4: Проверить структуру**

Через `get_figjam` подтвердить поля всех четырёх таблиц, ключ `PK,FK` у `company_okveds.code`, пять новых коннекторов и их кардинальности.

- [ ] **Step 5: Проверить итоговое изображение**

Получить скриншот корневого узла `0:1` с `contentsOnly: false` и размером не менее 4096 px. Проверить, что таблицы читаемы, линии не перекрывают заголовки и новые элементы не скрывают существующую схему.
