# Financial Observations Wide Fields FigJam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обновить таблицу `financial_observations` в FigJam так, чтобы `revenue`, `expenses` и `profit` хранились отдельными полями, при этом цвет шапки оставался неизменным.

**Architecture:** Изменяется существующий узел таблицы `2:119` в файле FigJam `ZfpxFolI3ywaEHvvi4vAyD`. Строка шапки не редактируется; к таблице добавляется одна строка, после чего все строки данных приводятся к согласованной структуре. Структура и цвет шапки проверяются чтением узла и снимком до и после изменения.

**Tech Stack:** Figma FigJam, Figma Plugin API через `use_figma`, инструменты `get_figjam` и `get_screenshot`.

## Global Constraints

- Удалить поля `metric financialMetric` и `amount decimal`.
- Добавить `revenue decimal`, `expenses decimal` и `profit decimal`.
- Сохранить первичный ключ `company_inn + report_year + source`.
- Не создавать справочник финансовых метрик.
- Не менять цвет шапки `financial_observations` и шапок других таблиц.
- Сохранить существующие поля происхождения данных и внешние связи.

---

### Task 1: Обновить структуру `financial_observations`

**Files:**
- Modify: FigJam file `ZfpxFolI3ywaEHvvi4vAyD`, node `2:119`
- Reference: `docs/superpowers/specs/2026-08-21-financial-observations-wide-fields-design.md`

**Interfaces:**
- Consumes: существующая таблица `financial_observations` размером 11 × 3 с шапкой в строке 0.
- Produces: таблица размером 12 × 3 со структурой `company_inn`, `report_year`, `source`, `revenue`, `expenses`, `profit`, `source_record_id`, `source_fetch_id`, `dataset_release_id`, `as_of`, `collected_at`.

- [ ] **Step 1: Зафиксировать исходную структуру и оформление**

Вызвать `get_figjam` для узла `2:119` и проверить:

```text
tableNumRows="11"
tableNumColumns="3"
row 3: PK | metric | financialMetric
row 5:    | amount | decimal
```

Получить снимок узла `2:119` через `get_screenshot` и сохранить его как визуальный эталон цвета шапки.

- [ ] **Step 2: Выполнить атомарное изменение таблицы**

Вызвать `use_figma` с `skillNames: "figma-use,figma-use-figjam"` и выполнить следующий сценарий:

```javascript
const table = await figma.getNodeByIdAsync("2:119");
if (!table || table.type !== "TABLE") throw new Error("financial_observations not found");
if (table.numRows !== 11 || table.numColumns !== 3) throw new Error("unexpected table dimensions");
if (table.cellAt(3, 1).text.characters !== "metric") throw new Error("metric row not found");
if (table.cellAt(5, 1).text.characters !== "amount") throw new Error("amount row not found");

const headerFillsBefore = JSON.stringify(table.cellAt(0, 0).fills);
table.insertRow(11);

const rows = [
  ["PK,FK", "company_inn", "char10"],
  ["PK", "report_year", "smallint"],
  ["PK", "source", "text"],
  ["", "revenue", "decimal"],
  ["", "expenses", "decimal"],
  ["", "profit", "decimal"],
  ["", "source_record_id", "text"],
  ["FK", "source_fetch_id", "bigint"],
  ["FK", "dataset_release_id", "bigint"],
  ["", "as_of", "date"],
  ["", "collected_at", "timestamptz"]
];

const cells = [];
for (let row = 1; row <= 11; row++) {
  for (let col = 0; col < 3; col++) cells.push(table.cellAt(row, col));
}
const createdCells = [table.cellAt(11, 0), table.cellAt(11, 1), table.cellAt(11, 2)];

const fonts = [];
for (const cell of cells) {
  const font = cell.text.fontName;
  if (!fonts.some(item => item.family === font.family && item.style === font.style)) fonts.push(font);
}
await Promise.all(fonts.map(font => figma.loadFontAsync(font)));

for (let row = 0; row < rows.length; row++) {
  for (let col = 0; col < 3; col++) table.cellAt(row + 1, col).text.characters = rows[row][col];
}

if (JSON.stringify(table.cellAt(0, 0).fills) !== headerFillsBefore) {
  throw new Error("header fill changed");
}

return {
  createdNodeIds: createdCells.map(cell => cell.id),
  mutatedNodeIds: [table.id, ...cells.map(cell => cell.id)],
  numRows: table.numRows,
  numColumns: table.numColumns,
  headerFillPreserved: true
};
```

Ожидаемый результат: вызов завершается без ошибки, `numRows` равно `12`, `numColumns` равно `3`, `headerFillPreserved` равно `true`.

- [ ] **Step 3: Проверить структуру после изменения**

Повторно вызвать `get_figjam` для `2:119` и проверить точное соответствие строк:

```text
1  PK,FK | company_inn        | char10
2  PK    | report_year       | smallint
3  PK    | source            | text
4        | revenue           | decimal
5        | expenses          | decimal
6        | profit            | decimal
7        | source_record_id  | text
8  FK    | source_fetch_id   | bigint
9  FK    | dataset_release_id| bigint
10       | as_of             | date
11       | collected_at      | timestamptz
```

Дополнительно проверить, что строки `metric` и `amount` отсутствуют.

- [ ] **Step 4: Проверить оформление и связи**

Получить новый снимок узла `2:119` и снимок области ER-диаграммы. Сравнить цвет шапки с исходным снимком, убедиться в читаемости строк и отсутствии визуальных наложений. Проверить через `get_figjam`, что существующие коннекторы по-прежнему ссылаются на узел `2:119`.

- [ ] **Step 5: Зафиксировать завершение плана**

Обновить этот план, отметив выполненные шаги, и сохранить изменения документации отдельным коммитом:

```bash
git add docs/superpowers/plans/2026-08-21-financial-observations-wide-fields-figjam.md
git commit -m "docs: record financial observations diagram update"
```
