# Five “Для кого” Figma Compositions Implementation Plan

Исторический технический план от 2026-08-31. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-five-dlya-kogo-figma-compositions-implementation-plan-1e4835e0-lre4bc5nw5).

Происхождение: `docs/superpowers/plans/2026-08-31-for-whom-figma-compositions.md`, SHA-256 `1e4835e00d27905f4bdeeae62395f98a49672080506d98cc946955cb28f78149`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в существующий Figma-файл пять самостоятельных desktop-композиций блока «Для кого», сохранив исходный блок и весь его текст без изменений и используя четыре готовые иллюстрации персонажей.

**Architecture:** Работа выполняется прямо на странице `Landing page` файла `WT2IPB0eHD9ULCPENEktwp`. Сначала фиксируется структурный baseline исходного узла `12:2`, затем четыре PNG загружаются и собираются в служебный asset frame, после чего создаются и наполняются пять фреймов шириной 1440 px; текстовые элементы клонируются из существующих инстансов, а изображения — из загруженных image frames. Каждый вариант проверяется по структуре и скриншоту до перехода к следующему, а служебный asset frame скрывается после финальной проверки.

**Tech Stack:** Figma Plugin API через `use_figma`, Figma `upload_assets`, существующие компоненты `Forum / Typography` и `Forum / Audience Card`, переменные Forum / Light / Primer, PNG с прозрачностью.

## Global Constraints

- Исходный фрейм `12:2` и вложенный блок `12:3` не изменять, не перемещать и не переименовывать.
- Каждый новый вариант — отдельный верхнеуровневый фрейм шириной ровно 1440 px.
- Порядок слева направо: V1, V2, V3, V4, V5; первый фрейм начинается не ближе чем через 200 px после крайнего существующего top-level узла, gap между вариантами — 160 px.
- Заголовок, номера, названия и описания сохраняются дословно, включая `соотвествующие`.
- Заголовок использует Unbounded SemiBold, остальной текст — Golos Text; Inter не использовать.
- В каждом варианте присутствуют все четыре PNG и все четыре набора текста.
- Не создавать глобальные переменные или библиотечные компоненты; переиспользовать существующие инстансы или их клоны.
- Не допускать пустых image fills, обрезанного текста, пересечения текста с изображениями и placeholder-слоёв.
- Каждый `use_figma` вызов выполняется с `skillNames: "figma-use,figma-generate-design"`, устанавливает текущую страницу не более одного раза и возвращает ID всех созданных или изменённых узлов.

---

### Task 1: Зафиксировать baseline и рабочие координаты

**Files:**
- Read: Figma `WT2IPB0eHD9ULCPENEktwp`, page `0:1`, node `12:2`
- Read: `deployment/astforum-static/assets/landing/for-whom/*.png`

**Interfaces:**
- Consumes: утверждённая спецификация [продуктовый источник](https://docs.astforum.ru/doc/istochnik-06102026-pyat-kompozicij-bloka-dlya-kogo-v-figma-121f6f2a-YD93d73M9t).
- Produces: объект `baseline` с геометрией и составом `12:2`, `placementStartX`, `sourceCards`, `sourceHeader`, `sourceFonts`.

- [x] **Step 1: Проверить четыре локальных PNG**

Run:

```bash
file deployment/astforum-static/assets/landing/for-whom/customer.png \
  deployment/astforum-static/assets/landing/for-whom/supplier.png \
  deployment/astforum-static/assets/landing/for-whom/contractor.png \
  deployment/astforum-static/assets/landing/for-whom/independent-specialist.png
```

Expected: четыре PNG 1254 × 1254 с alpha channel, каждый меньше 10 MB.

- [x] **Step 2: Прочитать baseline Figma без записи**

В одном read-only `use_figma` вызове получить страницу `0:1`, узлы `12:2`, `12:3`, header instances `23:62`/`23:64`, карточки `570:283`, `570:290`, `570:297`, `570:304`; вернуть их имена, размеры, координаты, fills и текстовые потомки. Отдельно вернуть `maxRight = Math.max(...page.children.map(n => n.x + n.width))` и `placementStartX = maxRight + 200`.

Expected: `12:2` имеет размер 1440 × 1012; найдены четыре карточки и два элемента заголовка; все тексты совпадают со спецификацией.

- [x] **Step 3: Сохранить baseline в плане выполнения**

Зафиксировать в рабочем состоянии:

```javascript
const variantNames = [
  "Для кого — V1 — Сценарная лента",
  "Для кого — V2 — Центральный хаб",
  "Для кого — V3 — Бескарточная галерея",
  "Для кого — V4 — Каскад",
  "Для кого — V5 — Сценическая композиция"
];
const sourceCardIds = ["570:283", "570:290", "570:297", "570:304"];
const imageNames = ["customer", "supplier", "contractor", "independent-specialist"];
```

Expected: эти значения используются без перестановки во всех последующих задачах.

### Task 2: Загрузить и организовать изображения

**Files:**
- Read: `deployment/astforum-static/assets/landing/for-whom/customer.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/supplier.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/contractor.png`
- Read: `deployment/astforum-static/assets/landing/for-whom/independent-specialist.png`
- Create: Figma top-level frame `Assets — Для кого`

**Interfaces:**
- Consumes: `placementStartX` from Task 1 and four local PNG paths.
- Produces: four reusable raster nodes named `Image/Customer`, `Image/Supplier`, `Image/Contractor`, `Image/Independent specialist` inside `Assets — Для кого`.

- [x] **Step 1: Получить четыре single-use upload URL**

Вызвать `figma_upload_assets` с:

```json
{
  "fileKey": "WT2IPB0eHD9ULCPENEktwp",
  "count": 4,
  "batchCommit": false,
  "scaleMode": "FIT"
}
```

Expected: четыре upload URL; `nodeId` не передаётся, поэтому на текущей странице создаются четыре image frames.

- [x] **Step 2: Загрузить PNG параллельно**

POST raw bytes каждого файла в соответствующий URL с `Content-Type: image/png`. Порядок URL соответствует `customer`, `supplier`, `contractor`, `independent-specialist`.

Expected: Figma возвращает/создаёт четыре raster frames с непустыми IMAGE fills.

- [x] **Step 3: Собрать временный asset frame**

В `use_figma` создать top-level frame `Assets — Для кого` размером 560 × 560 в точке `(placementStartX, 0)`, переместить в него четыре новых image frames, переименовать по интерфейсу задачи, выставить каждому размер 240 × 240 и разложить сеткой 2 × 2 с gap 24. Не скрывать frame до окончания клонирования изображений.

Expected: asset frame содержит ровно четыре видимых raster nodes с непустыми fills.

- [x] **Step 4: Проверить asset frame**

Выполнить structural read и один screenshot `Assets — Для кого`.

Expected: четыре разных персонажа видимы целиком, прозрачный фон сохранён, пустых fills нет.

### Task 3: Создать пять пустых top-level фреймов

**Files:**
- Create: Figma frames `Для кого — V1 — Сценарная лента` … `Для кого — V5 — Сценическая композиция`

**Interfaces:**
- Consumes: `placementStartX`, `variantNames`, background fill и layout grid исходного `12:2`.
- Produces: пять frame IDs `v1Id` … `v5Id`.

- [x] **Step 1: Рассчитать позиции**

Использовать:

```javascript
const widths = [1440, 1440, 1440, 1440, 1440];
const heights = [1180, 1080, 980, 1080, 1040];
const gap = 160;
const y = 690;
const x = widths.map((_, i) => placementStartX + i * (1440 + gap));
```

Expected: фреймы не пересекаются с существующими top-level узлами и друг с другом.

- [x] **Step 2: Создать фреймы**

В одном `use_figma` вызове создать пять top-level frames с рассчитанными размерами и координатами, скопировать background fill и 12-column grid из `12:2`, включить `clipsContent = false`, а каждому добавить временный пустой content frame с padding 120.

Expected: на странице пять новых top-level узлов с точными именами и шириной 1440 px; исходный `12:2` не затронут.

- [x] **Step 3: Проверить структуру и удалить только временные content frames**

Через metadata подтвердить имена, размеры и позиции. Затем удалить пять созданных нами пустых content frames, оставив top-level frames как стабильные контейнеры для следующих задач.

Expected: пять пустых контейнеров существуют; placeholders отсутствуют; `12:2` сохраняет baseline.

### Task 4: Собрать V1 — «Сценарная лента»

**Files:**
- Modify: Figma frame `Для кого — V1 — Сценарная лента`

**Interfaces:**
- Consumes: header instances, source card instances, four raster nodes.
- Produces: заполненный `v1Id` с четырьмя лентами.

- [x] **Step 1: Добавить общий header**

Клонировать `23:62` и `23:64`, поместить в header frame шириной 1200 px с вертикальным gap 12, координаты `(120, 80)`. Текст не изменять.

- [x] **Step 2: Создать четыре широкие панели**

Создать content column шириной 1200 px на `y = 230`, gap 20. Каждая панель имеет 1200 × 200 px, радиус 16, padding 24, фон по циклу orange/neutral/red/neutral. Нечётные панели смещены на 0 px, чётные — на 48 px вправо; ширина чётных уменьшается до 1152 px, чтобы остаться внутри контейнера.

- [x] **Step 3: Наполнить панели**

Для ролей 01 и 03: card instance слева, иллюстрация справа. Для 02 и 04: иллюстрация слева, card instance справа. Клон карточки сохраняет исходный текст и component linkage; изображение имеет 180 × 180 px, `FIT`, не пересекается с карточкой. Между панелями добавить тонкий серый progression marker шириной 2 px, не закрывающий контент.

- [x] **Step 4: Проверить V1**

Metadata: header + 4 panels + 4 card clones + 4 raster clones. Screenshot: чередование читается, выступающие персонажи не обрезаны, все описания видимы.

### Task 5: Собрать V2 — «Центральный хаб»

**Files:**
- Modify: Figma frame `Для кого — V2 — Центральный хаб`

**Interfaces:**
- Consumes: header instances, source cards, four raster nodes.
- Produces: заполненный `v2Id` с центральным ядром и четырьмя спутниками.

- [x] **Step 1: Добавить header и центральное ядро**

Header располагается в `(120, 72)` и повторяет исходный текст. В центре области на `(520, 400)` создать круг 400 × 400 px с orange accent fill и внутренним светлым кругом 280 × 280 px; в центре разместить клонированный заголовок секции в компактном масштабе без изменения текста.

- [x] **Step 2: Создать четыре спутника**

Разместить контейнеры 400 × 300 px в точках `(90, 250)`, `(950, 250)`, `(90, 680)`, `(950, 680)`. В каждом: card clone 285 × 213 и image clone 160 × 160. Левые изображения смотрят/расположены к центру справа от карточек, правые — слева от карточек; вертикальные спутники не пересекаются с ядром.

- [x] **Step 3: Проверить V2**

Metadata: один hub + 4 satellites + 4 card clones + 4 raster clones. Screenshot: центральное ядро доминирует, но не перекрывает спутники; направление персонажей читается без стрелок.

### Task 6: Собрать V3 — «Бескарточная галерея»

**Files:**
- Modify: Figma frame `Для кого — V3 — Бескарточная галерея`

**Interfaces:**
- Consumes: header instances, nested typography instances of source cards, four raster nodes.
- Produces: заполненный `v3Id` без самостоятельных карточных фонов.

- [x] **Step 1: Добавить header и общий gallery surface**

Header — `(120, 72)`. Общий surface — `(120, 235)`, 1200 × 650 px, один neutral background, radius 20, без четырёх отдельных fills.

- [x] **Step 2: Разделить surface на зоны**

Добавить три вертикальных divider lines высотой 570 px на x 300, 600, 900 внутри surface. Создать четыре прозрачных zone frames 300 × 650 px.

- [x] **Step 3: Добавить изображения и тексты**

В каждой зоне поместить image clone 250 × 250 px сверху и ниже него клоны трёх вложенных typography instances соответствующей исходной карточки: номер, название, описание. Текстовая колонка имеет ширину 252 px и gap 12. Background исходной карточки не клонировать.

- [x] **Step 4: Проверить V3**

Metadata: 1 surface + 4 zones + 3 dividers + 12 typography instance clones + 4 raster clones; нет четырёх card-background frames. Screenshot: текст не обрезан и не соприкасается с divider lines; персонажи могут визуально выходить за линию только прозрачными частями.

### Task 7: Собрать V4 — «Каскад»

**Files:**
- Modify: Figma frame `Для кого — V4 — Каскад`

**Interfaces:**
- Consumes: header instances, source cards, four raster nodes.
- Produces: заполненный `v4Id` с четырьмя ступенчатыми панелями.

- [x] **Step 1: Добавить header и каскадный контейнер**

Header — `(120, 72)`. Каскадная область — `(120, 240)`, 1200 × 760 px, `clipsContent = false`.

- [x] **Step 2: Создать четыре ступени**

Панели имеют 760 × 260 px и размещаются в точках `(0, 0)`, `(140, 150)`, `(280, 300)`, `(420, 450)` относительно каскадной области. Цвета — orange, neutral, red, neutral; radius 20; лёгкая тень только у верхней границы каждой ступени.

- [x] **Step 3: Наполнить ступени**

В каждой панели card clone расположен в защищённой нижней/левой зоне, image clone 210 × 210 px — у верхнего правого края и может выступать вверх до 40 px. Панели перекрывают только фон соседей; card и image каждой предыдущей ступени остаются полностью видимыми.

- [x] **Step 4: Проверить V4**

Metadata: 4 panels + 4 card clones + 4 raster clones. Screenshot: диагональ 01→04 очевидна; ни один текст или персонаж не скрыт соседней панелью.

### Task 8: Собрать V5 — «Сценическая композиция»

**Files:**
- Modify: Figma frame `Для кого — V5 — Сценическая композиция`

**Interfaces:**
- Consumes: header instances, nested typography instances, four raster nodes.
- Produces: заполненный `v5Id` с общей сценой и четырьмя текстовыми островами.

- [x] **Step 1: Добавить header и сцену**

Header — `(120, 72)`. Общая сцена — `(120, 225)`, 1200 × 720 px, neutral fill, radius 24, `clipsContent = false`. Добавить четыре мягких цветовых пятна через radial gradients: orange, gray, red, gray; без линий-коннекторов.

- [x] **Step 2: Сформировать центральную группу**

Разместить четыре image clones размером 260 × 260 px в диапазоне x 360–840 и y 160–390 внутри сцены, с горизонтальным перекрытием не более 40 px. Силуэты не должны закрывать лица и основные рабочие атрибуты соседей.

- [x] **Step 3: Добавить четыре текстовых острова**

Создать четыре острова 250 × 190 px в углах сцены: `(32, 32)`, `(918, 32)`, `(32, 498)`, `(918, 498)`. В каждый поместить клоны number/title/body typography instances соответствующей роли; островам дать полупрозрачный light fill, radius 16 и padding 16. Линии-коннекторы не добавлять.

- [x] **Step 4: Проверить V5**

Metadata: 1 scene + 4 gradient spots + 4 raster clones + 4 text islands + 12 typography instance clones. Screenshot: центральная группа читается как одна сцена, каждый текстовый остров однозначно связан с ближайшим персонажем.

### Task 9: Финальная очистка и проверка

**Files:**
- Modify: Figma frame `Assets — Для кого`
- Read: Figma node `12:2`
- Read: five new variant frames

**Interfaces:**
- Consumes: `baseline`, `v1Id` … `v5Id`, asset frame ID.
- Produces: чистый Figma canvas и итоговый verification report.

- [x] **Step 1: Скрыть служебные assets**

После подтверждения наличия 20 image clones выставить `Assets — Для кого.visible = false`. Исходные четыре upload frames не удалять, чтобы сохранить безопасный источник image fills для дальнейшего редактирования.

- [x] **Step 2: Проверить исходный блок**

Повторить baseline read `12:2` и сравнить имя, x/y, width/height, число дочерних узлов и все текстовые строки с Task 1.

Expected: полное совпадение; при расхождении остановиться и не скрывать проблему.

- [x] **Step 3: Проверить пять вариантов структурно**

Для каждого frame ID подтвердить: width 1440; имена в ожидаемом порядке; 4 image clones; 4 набора текста; отсутствие nodes с именами `/placeholder/i`; отсутствие пустых IMAGE fills; bounding boxes всех текстов лежат внутри соответствующих защищённых областей.

- [x] **Step 4: Проверить шрифты**

Собрать все TEXT descendants пяти фреймов и вернуть уникальные пары `family/style`.

Expected: только Unbounded SemiBold и разрешённые начертания Golos Text из исходного блока; Inter отсутствует.

- [x] **Step 5: Сделать финальные скриншоты**

Получить отдельный screenshot каждого варианта и один screenshot/zoom общего ряда пяти фреймов. Проверить обрезку, перекрытия, пустые изображения, placeholder-текст и визуальную различимость композиций.

- [x] **Step 6: Зафиксировать результат плана**

Обновить чекбоксы этого файла, добавить короткий execution note с ID пяти фреймов и ссылкой на Figma node первого варианта; выполнить:

```bash
git add docs/superpowers/plans/2026-08-31-for-whom-figma-compositions.md
git commit -m "docs: record for-whom Figma execution"
```

Expected: коммит содержит только обновление этого plan-файла; посторонние изменения worktree не затронуты.

## Execution Notes — 2026-08-31

- V1 `Для кого — V1 — Сценарная лента`: `589:123`;
- V2 `Для кого — V2 — Центральный хаб`: `589:125`;
- V3 `Для кого — V3 — Бескарточная галерея`: `589:127`;
- V4 `Для кого — V4 — Каскад`: `589:129`;
- V5 `Для кого — V5 — Сценическая композиция`: `589:131`;
- служебный frame `Assets — Для кого`: `588:123`, скрыт после клонирования изображений;
- исходный `12:2` повторно проверен: имя, координаты, размер 1440 × 1012, число дочерних узлов и 14 текстовых строк совпадают с baseline;
- в каждом варианте найдено ровно четыре непустых IMAGE fill, обязательные строки присутствуют, placeholder-слои отсутствуют;
- уникальные пары шрифтов: `Unbounded / SemiBold`, `Golos Text / SemiBold`, `Golos Text / Regular`;
- отдельные скриншоты пяти вариантов и общий снимок страницы визуально проверены.

Первый вариант: [открыть в Figma](https://www.figma.com/design/WT2IPB0eHD9ULCPENEktwp/Макеты-2.0?node-id=589-123).
