# Individual Sber ID Profile Figma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать на странице `ЛК физ лица` отдельный профиль физического лица с полными read-only данными Сбер ID и прототипным переходом по имени пользователя.

**Architecture:** Новый фрейм создаётся рядом с текущим `240:86` посредством клонирования актуальной оболочки ЛК, чтобы сохранить связанные Primer instances, библиотечные Octicons и `Forum / Light`. Основной dashboard-контент заменяется на адаптивную вертикальную композицию из заголовка, внешней ссылки и четырёх тематических карточек; переход на профиль настраивается через Figma reactions.

**Tech Stack:** Figma Plugin API через `use_figma`, Primer Web (Community), Primer Octicons, коллекция переменных `FORUM / Dashboard Tokens` в режиме `Light`.

## Global Constraints

- Целевой Figma fileKey: `WT2IPB0eHD9ULCPENEktwp`; page: `108:73`; исходный dashboard frame: `240:86`.
- Новый frame: `1440 × 1100`, на той же странице, справа от существующего контента с безопасным зазором.
- Primer — единственная UI-система; библиотечные instances не detach.
- Системные иконки — только опубликованные Primer Octicons с `remote: true`.
- Брендирование — только `FORUM / Dashboard Tokens`, mode `Light`; жёсткие цвета и типографика запрещены при наличии семантического токена.
- Аватар и лейблы подтверждения не добавляются.
- Все утверждённые персональные данные показываются полностью и только для чтения.
- Демонстрационные значения должны явно оставаться фиктивными данными макета.
- Ссылка `Алексей Смирнов` на dashboard должна вести к новому frame по `ON_CLICK`.
- В профиле ни один рабочий пункт боковой навигации не имеет current/selected state.

---

### Task 1: Зафиксировать исходную структуру и создать оболочку профиля

**Files:**
- Modify: Figma file `WT2IPB0eHD9ULCPENEktwp`, page `108:73`
- Reference: `docs/superpowers/specs/2026-08-12-individual-sber-id-profile-figma-design.md`

**Interfaces:**
- Consumes: dashboard frame `240:86` и его актуальные Primer instances.
- Produces: новый frame `Profile / Individual / Sber ID`, его стабильный node ID и IDs областей header/sidebar/main.

- [ ] **Step 1: Прочитать исходную иерархию без изменений**

Вызвать `use_figma` с `skillNames: "figma-use,figma-generate-design"`, один раз переключить page и вернуть прямых детей исходного frame:

```js
const page = await figma.getNodeByIdAsync('108:73')
await figma.setCurrentPageAsync(page)
const source = await figma.getNodeByIdAsync('240:86')
if (!source || source.type !== 'FRAME') throw new Error('Dashboard frame 240:86 not found')
return {
  source: { id: source.id, name: source.name, x: source.x, y: source.y, width: source.width, height: source.height },
  children: source.children.map((n, index) => ({ index, id: n.id, name: n.name, type: n.type }))
}
```

- [ ] **Step 2: Проверить предусловия**

Ожидается frame `1440 × 1100`, содержащий актуальную шапку, sidebar и main-content. Если имена структурных областей отличаются от найденных ранее, использовать возвращённые IDs; не искать их глобально по странице.

- [ ] **Step 3: Клонировать оболочку и разместить справа**

```js
const page = await figma.getNodeByIdAsync('108:73')
await figma.setCurrentPageAsync(page)
const source = await figma.getNodeByIdAsync('240:86')
if (!source || source.type !== 'FRAME') throw new Error('Dashboard frame not found')
const profile = source.clone()
profile.name = 'Profile / Individual / Sber ID'
profile.x = Math.max(...page.children.filter(n => 'x' in n && 'width' in n).map(n => n.x + n.width)) + 160
profile.y = source.y
profile.resize(1440, 1100)
profile.placeholder = true
return {
  createdNodeIds: [profile.id],
  profile: { id: profile.id, name: profile.name, x: profile.x, y: profile.y, width: profile.width, height: profile.height }
}
```

- [ ] **Step 4: Удалить из клона только dashboard-контент**

Найти main-content внутри нового frame по структурной позиции/ID из Step 1. Сохранить header и sidebar. Удалить прямых детей main-content, затем установить main-content в вертикальный Auto Layout с текущими шириной, padding и token bindings оболочки. Вернуть все удалённые IDs и mutated IDs; не удалять содержимое исходного dashboard.

- [ ] **Step 5: Проверить оболочку**

Сделать screenshot нового frame. Ожидается сохранённая шапка, sidebar, пустая основная область без dashboard-карточек, аватара и посторонних элементов. После проверки оставить `profile.placeholder = true` до заполнения.

---

### Task 2: Собрать заголовок профиля и read-only вводный блок

**Files:**
- Modify: Figma frame `Profile / Individual / Sber ID` из Task 1

**Interfaces:**
- Consumes: `profileId` и `mainContentId` из Task 1; существующие Primer Heading и Link instances в исходном dashboard.
- Produces: `profileHeaderId`, `titleInstanceId`, `sourceTextId`, `externalLinkInstanceId`.

- [ ] **Step 1: Импортировать/переиспользовать Primer Heading и Link**

Клонировать существующий library-linked Heading подходящего размера и Link из исходного dashboard, перенести клоны в main-content, не detach. Для Link использовать текст `Изменить в Сбер ID`; для Heading — `Профиль`.

- [ ] **Step 2: Создать горизонтальную header-композицию**

```js
const header = figma.createAutoLayout('HORIZONTAL', {
  name: 'Profile / Header',
  itemSpacing: 24,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0
})
main.appendChild(header)
header.layoutSizingHorizontal = 'FILL'
header.layoutSizingVertical = 'HUG'
header.primaryAxisAlignItems = 'SPACE_BETWEEN'
header.counterAxisAlignItems = 'MIN'
```

В левой вертикальной группе разместить Heading и пояснение `Данные получены из Сбер ID и доступны только для просмотра`. Справа — Primer Link `Изменить в Сбер ID`.

- [ ] **Step 3: Привязать текстовые роли к Forum / Light**

Для заголовка сохранить Primer typography bindings. Для пояснения использовать существующий семантический `color/text/secondary`; для ссылки — `color/text/link`. Перед изменением текста загрузить все текущие fonts через `getStyledTextSegments(['fontName'])` и `await figma.loadFontAsync(...)`.

- [ ] **Step 4: Указать внешний характер ссылки**

Если существующий Primer Link поддерживает `trailingVisual`, назначить опубликованный Octicon внешней ссылки через `INSTANCE_SWAP`; иначе оставить только семантическую ссылку без создания локальной иконки. Не создавать локальный master.

- [ ] **Step 5: Проверить секцию**

Вернуть created/mutated IDs и screenshot main-content. Проверить, что ссылка не выглядит как кнопка редактирования и что пояснение не обрезается на ширине desktop.

---

### Task 3: Создать карточки «Личные данные» и «Контакты»

**Files:**
- Modify: Figma frame `Profile / Individual / Sber ID`

**Interfaces:**
- Consumes: `mainContentId` и bindings `Forum / Light`.
- Produces: `cardsGridId`, `personalCardId`, `contactsCardId` и IDs всех row-композиций.

- [ ] **Step 1: Создать сетку карточек**

Использовать горизонтальный Auto Layout с двумя равными колонками внутри main-content. При невозможности безопасного `FILL` использовать два вертикальных Auto Layout child frame фиксированной ширины, рассчитанной как `(mainWidth - gap) / 2`.

- [ ] **Step 2: Создать композицию read-only карточки**

Карточка — Primer-compatible composition: vertical Auto Layout, семантический canvas/default background, border/default, Primer radius и padding из существующей dashboard-карточки. Строка данных — vertical Auto Layout с label вторичного цвета и value основного цвета; между строками используется Primer divider или семантическая border-переменная.

- [ ] **Step 3: Заполнить «Личные данные»**

Создать строки в указанном порядке:

```js
const personalRows = [
  ['Фамилия, имя, отчество', 'Смирнов Алексей Сергеевич'],
  ['Дата рождения', '14 марта 1988'],
  ['Пол', 'Мужской'],
  ['Место рождения', 'г. Москва'],
  ['Гражданство', 'Российская Федерация']
]
```

- [ ] **Step 4: Заполнить «Контакты»**

```js
const contactRows = [
  ['Телефон', '+7 912 345-67-89'],
  ['Электронная почта', 'alexey.smirnov@example.ru']
]
```

- [ ] **Step 5: Проверить структуру и визуал**

Вернуть IDs сетки, карточек, строк и текстов. Screenshot должен подтвердить одинаковую ширину карточек, вертикальный ритм, отсутствие input-стилизации и обрезания email.

---

### Task 4: Создать карточки «Документы» и «Адреса»

**Files:**
- Modify: Figma frame `Profile / Individual / Sber ID`

**Interfaces:**
- Consumes: `cardsGridId` и card/row composition из Task 3.
- Produces: `documentsCardId`, `addressesCardId` и полный набор read-only rows.

- [ ] **Step 1: Создать «Документы»**

```js
const documentRows = [
  ['Паспорт РФ', '45 12 345678'],
  ['Кем выдан', 'ГУ МВД России по г. Москве'],
  ['Дата выдачи', '22 июня 2008'],
  ['Код подразделения', '770-001'],
  ['ИНН', '770123456789'],
  ['СНИЛС', '123-456-789 01']
]
```

- [ ] **Step 2: Создать «Адреса»**

```js
const addressRows = [
  ['Адрес регистрации', '125009, г. Москва, ул. Тверская, д. 12, кв. 34'],
  ['Фактический адрес', '125009, г. Москва, ул. Тверская, д. 12, кв. 34'],
  ['Адрес доставки', '125009, г. Москва, ул. Тверская, д. 12, кв. 34']
]
```

- [ ] **Step 3: Добавить пояснение о демонстрационных данных**

Под карточками добавить вторичный текст: `В макете используются демонстрационные данные. Состав полей зависит от разрешений, предоставленных через Сбер ID.` Привязать к `color/text/secondary`, без warning/error semantics.

- [ ] **Step 4: Проверить переполнение**

Для длинных значений установить `textAutoResize = 'HEIGHT'`, фиксированную доступную ширину и перенос строк. Проверить, что нижняя часть content не выходит за `1100` px; если выходит, уменьшить только вертикальные gaps до существующих Primer spacing tokens, не шрифт.

- [ ] **Step 5: Снять placeholder**

После заполнения установить `profile.placeholder = false`. Вернуть mutated ID профиля и screenshot полного frame.

---

### Task 5: Настроить состояния навигации и прототипный переход

**Files:**
- Modify: исходный dashboard frame `240:86`
- Modify: новый frame `Profile / Individual / Sber ID`

**Interfaces:**
- Consumes: `profileId` из Task 1 и link instance `244:763` (`Link / Алексей Смирнов`) исходного dashboard.
- Produces: working prototype reaction от dashboard к profile и sidebar без selected item на profile.

- [ ] **Step 1: Снять current state со всех рабочих пунктов профиля**

В клонированном sidebar найти четыре вложенных `ActionList.Item/Default`. Для каждого вызвать `setProperties({'currentSelection#15618:0': false})`. Не изменять sidebar исходного dashboard.

- [ ] **Step 2: Настроить переход по имени пользователя**

```js
const dashboardName = await figma.getNodeByIdAsync('244:763')
if (!dashboardName || dashboardName.type !== 'INSTANCE') throw new Error('Dashboard profile link not found')
await dashboardName.setReactionsAsync([{
  trigger: { type: 'ON_CLICK' },
  actions: [{
    type: 'NODE',
    destinationId: profile.id,
    navigation: 'NAVIGATE',
    transition: { type: 'DISSOLVE', easing: { type: 'EASE_OUT' }, duration: 0.2 },
    preserveScrollPosition: false
  }]
}])
```

- [ ] **Step 3: Проверить реакцию структурно**

Повторно прочитать `dashboardName.reactions`. Ожидается `ON_CLICK`, `NAVIGATE`, `destinationId === profile.id`.

- [ ] **Step 4: Проверить библиотечные связи**

Обойти все instances нового frame и получить `getMainComponentAsync()`. Primer/Octicons-компоненты должны иметь `remote: true`; список нарушений должен быть пуст. Убедиться, что на page не появились локальные `COMPONENT` nodes.

- [ ] **Step 5: Проверить персональные поля**

Собрать все TEXT nodes нового frame и проверить наличие точных заголовков/значений из спецификации, отсутствие служебных маркеров незавершённости, масок `••••` и управляющих действий редактирования.

---

### Task 6: Финальная визуальная и доступностная проверка

**Files:**
- Verify: Figma frame `Profile / Individual / Sber ID`
- Verify: Figma dashboard frame `240:86`

**Interfaces:**
- Consumes: завершённый profile frame и настроенную reaction.
- Produces: подтверждённый профиль без визуальных и структурных дефектов.

- [ ] **Step 1: Сделать screenshot профиля в исходном размере**

Использовать `get_screenshot` для `profileId` с `maxDimension: 1800`. Проверить отсутствие обрезания, наложений, пустых контейнеров, аватара и подтверждающих лейблов.

- [ ] **Step 2: Проверить визуальную иерархию**

Ожидаемый порядок: header/sidebar → `Профиль` и пояснение → `Изменить в Сбер ID` → личные данные/контакты → документы/адреса → примечание о демонстрационных данных.

- [ ] **Step 3: Проверить контраст и семантические bindings**

Проверить, что text/fill/stroke bindings разрешаются через `FORUM / Dashboard Tokens`, `Light`. Не добавлять non-Light modes; небезопасный brand mapping заменить Primer Light fallback и перечислить в отчёте.

- [ ] **Step 4: Проверить доступность статического макета**

Подтвердить: ссылки визуально различимы; длинные значения переносятся; selected state не передаётся одним цветом; порядок focus в аннотации соответствует спецификации. Реальную клавиатурную навигацию, screen reader и внешний URL `Изменить в Сбер ID` отметить как непроверяемые в статичном Figma-макете.

- [ ] **Step 5: Зафиксировать итог**

Вернуть `profileId`, screenshot evidence, reaction evidence, count remote instances, count local components и список fallbacks/непроверенных ограничений. Передать пользователю прямую ссылку на новый frame.
