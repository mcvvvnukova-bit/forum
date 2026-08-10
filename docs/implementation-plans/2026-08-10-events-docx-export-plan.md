# Events DOCX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать брендированную DOCX-копию актуального реестра из 29 мероприятий и сохранить её как `docs/Мероприятия 09-12.2026.docx`, не переименовывая и не изменяя исходный Markdown.

**Architecture:** Одноразовый Python-пайплайн читает актуальный Markdown, преобразует четыре месячные таблицы в типизированную модель и собирает кандидат DOCX во временной папке. Отдельный валидатор проверяет OOXML, данные, размеры шрифтов, секции, ссылки и повторяемые заголовки; затем `render_docx.py` рендерит все страницы для обязательной визуальной проверки. Только прошедший все проверки кандидат копируется в финальный путь.

**Tech Stack:** Python 3 из bundled runtime, `python-docx 1.2.0`, `lxml 6.0.2`, `Pillow 12.2.0`, OOXML, LibreOffice через `render_docx.py`, PNG/PDF render.

## Global Constraints

- Единственный источник данных: `/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md` в актуальном состоянии на момент запуска.
- Спецификация: `/Users/vvv/Проекты/АСТ Форум/docs/implementation-plans/2026-08-10-events-docx-design.md`; исходник и spec доступны только для чтения.
- Финальный output: `/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx`; исходный Markdown не переименовывать.
- Перенести ровно 29 строк: сентябрь — 10, октябрь — 7, ноябрь — 10, декабрь — 2; сохранить порядок, поля, URL и тарифы.
- Основной текст, статистика, примечания и содержимое таблиц — не меньше 12 pt.
- Все заголовки, включая название, разделы, месяцы и заголовки колонок, — ровно 14 pt в пунктах Word.
- Первая секция portrait: логотип, титул и статистика. Месячные таблицы — landscape.
- Сохранить восемь колонок и кликабельные ссылки; заголовок каждой таблицы повторять на каждой странице.
- Обрезание текста и уменьшение шрифта запрещены. При нехватке места увеличивать число страниц, высоту строк и переносы.
- Цвета: `#282828`, `#4A4A4A`, `#F53F00`, `#FF551A`, `#FF7140` в ролях, заданных spec.
- Логотип: `/Users/vvv/Проекты/АСТ Форум/Brandbook/horizontal logo/png/horizontal logo_FORUM_color_text.png`.
- Проверить визуально каждую страницу после полного render; выборочная проверка страниц недопустима.
- Не коммитить изменения. Единственный новый постоянный артефакт реализации — финальный DOCX.

## File Map

- Read: `docs/Мероприятия 09-12.2026.md` — актуальные данные.
- Read: `docs/implementation-plans/2026-08-10-events-docx-design.md` — дизайн и QA.
- Read: `Brandbook/all colors.pdf` — утверждённая палитра.
- Read: `Brandbook/horizontal logo/png/horizontal logo_FORUM_color_text.png` — логотип.
- Create temporary: `/tmp/ast_forum_events_docx_20260810/build_events_docx.py` — parser и генератор.
- Create temporary: `/tmp/ast_forum_events_docx_20260810/test_build_events_docx.py` — unit tests parser/data contracts.
- Create temporary: `/tmp/ast_forum_events_docx_20260810/verify_events_docx.py` — OOXML и content validator.
- Create temporary: `/tmp/ast_forum_events_docx_20260810/events.candidate.docx` — кандидат.
- Create temporary: `/tmp/ast_forum_events_docx_20260810/rendered/` — PDF и `page-*.png` для всех страниц.
- Create final: `docs/Мероприятия 09-12.2026.docx` — прошедший QA результат.

---

### Task 1: Зафиксировать входы и реализовать parser Markdown

**Files:**
- Create: `/tmp/ast_forum_events_docx_20260810/test_build_events_docx.py`
- Create: `/tmp/ast_forum_events_docx_20260810/build_events_docx.py`
- Read: `/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md`

**Interfaces:**
- Produces: `DocumentData`, `MonthTable`, `EventRow`, `parse_markdown(path: Path) -> DocumentData`.
- Contract: 29 строк, четыре месяца, восемь ячеек в строке, точные суммы и исходный порядок.

- [ ] **Step 1: Создать безопасную временную рабочую папку и зафиксировать хеши входов**

Run:

```bash
mkdir -p '/tmp/ast_forum_events_docx_20260810/rendered'
shasum -a 256 \
  '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md' \
  '/Users/vvv/Проекты/АСТ Форум/docs/implementation-plans/2026-08-10-events-docx-design.md' \
  '/Users/vvv/Проекты/АСТ Форум/Brandbook/all colors.pdf' \
  '/Users/vvv/Проекты/АСТ Форум/Brandbook/horizontal logo/png/horizontal logo_FORUM_color_text.png' \
  > '/tmp/ast_forum_events_docx_20260810/inputs.before.sha256'
```

Expected: четыре строки SHA-256; ни один входной файл не изменён.

- [ ] **Step 2: Написать unit tests контракта parser**

Create `/tmp/ast_forum_events_docx_20260810/test_build_events_docx.py` с фактическими ожиданиями:

```python
from pathlib import Path
import unittest

from build_events_docx import parse_markdown

SOURCE = Path('/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md')


class ParseEventsMarkdownTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown(SOURCE)

    def test_exact_month_counts(self):
        self.assertEqual(
            {m.name: len(m.rows) for m in self.data.months},
            {'Сентябрь': 10, 'Октябрь': 7, 'Ноябрь': 10, 'Декабрь': 2},
        )

    def test_exact_total_and_columns(self):
        rows = [row for month in self.data.months for row in month.rows]
        self.assertEqual(len(rows), 29)
        self.assertTrue(all(len(row.cells) == 8 for row in rows))

    def test_city_and_theme_totals(self):
        self.assertEqual(
            self.data.city_counts,
            {'Москва': 19, 'Санкт-Петербург': 4, 'Екатеринбург': 3,
             'Казань': 2, 'Не опубликован': 1},
        )
        self.assertEqual(
            self.data.theme_counts,
            {'Строительство': 25, 'ИТ / госсектор': 4},
        )

    def test_nisf_tariffs_and_links_are_preserved(self):
        rows = [row for month in self.data.months for row in month.rows]
        nisf = next(row for row in rows if 'Национальный инвестиционно-строительный форум' in row.cells[2])
        self.assertEqual(
            nisf.cells[6],
            '«Бизнес» — 15 000 ₽; VIP — 40 000 ₽; VIP расширенный — 60 000 ₽',
        )
        self.assertEqual(sum(row.url is not None for row in rows), 29)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: Запустить тест и убедиться, что parser ещё отсутствует**

Run:

```bash
cd '/tmp/ast_forum_events_docx_20260810'
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' -m unittest -v test_build_events_docx.py
```

Expected: FAIL при импорте `parse_markdown` или `build_events_docx`.

- [ ] **Step 4: Реализовать parser без изменения исходника**

В `/tmp/ast_forum_events_docx_20260810/build_events_docx.py` определить:

```python
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import re


MONTHS = ('Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь')
EXPECTED_HEADERS = (
    'Даты', 'Город', 'Мероприятие', 'Тематика',
    'Формат / фокус', 'Профиль', 'Стоимость участия',
    'Стоимость выставочного стенда',
)


@dataclass(frozen=True)
class EventRow:
    cells: tuple[str, ...]
    event_label: str
    url: str | None
    suffix: str


@dataclass(frozen=True)
class MonthTable:
    name: str
    headers: tuple[str, ...]
    rows: tuple[EventRow, ...]


@dataclass(frozen=True)
class DocumentData:
    title: str
    freshness: str
    months: tuple[MonthTable, ...]
    city_counts: dict[str, int]
    theme_counts: dict[str, int]


def split_md_row(line: str) -> tuple[str, ...]:
    cells, current, escaped = [], [], False
    for char in line.strip():
        if escaped:
            current.append(char)
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == '|':
            cells.append(''.join(current).strip())
            current = []
        else:
            current.append(char)
    if escaped:
        current.append('\\')
    cells.append(''.join(current).strip())
    return tuple(cells[1:-1])


def strip_outer_bold(value: str) -> str:
    value = value.strip()
    return value[2:-2] if value.startswith('**') and value.endswith('**') else value


def parse_event_cell(value: str) -> tuple[str, str | None, str]:
    value = strip_outer_bold(value)
    match = re.fullmatch(r'\[(.*?)\]\((https?://[^)]+)\)(.*)', value)
    if not match:
        return value, None, ''
    label, url, suffix = match.groups()
    return strip_outer_bold(label), url, suffix


def parse_markdown(path: Path) -> DocumentData:
    lines = path.read_text(encoding='utf-8').splitlines()
    title = lines[0].removeprefix('# ').strip()
    freshness_line = next(line for line in lines if line.startswith('Актуальность проверки:'))
    freshness = freshness_line.split(':', 1)[1].replace('**', '').strip().rstrip('.')
    tables, current_month, headers, rows = [], None, None, []

    def flush():
        nonlocal headers, rows
        if current_month is not None:
            tables.append(MonthTable(current_month, headers, tuple(rows)))
        headers, rows = None, []

    for line in lines:
        month_match = re.fullmatch(r'### (Сентябрь|Октябрь|Ноябрь|Декабрь)', line)
        if month_match:
            flush()
            current_month = month_match.group(1)
            continue
        if current_month is None or not line.startswith('|'):
            continue
        cells = tuple(strip_outer_bold(cell) for cell in split_md_row(line))
        if cells == EXPECTED_HEADERS:
            headers = cells
            continue
        if all(set(cell) <= {'-', ':', ' '} for cell in cells):
            continue
        if len(cells) != 8 or headers is None:
            raise ValueError(f'Некорректная строка таблицы {current_month}: {line}')
        label, url, suffix = parse_event_cell(cells[2])
        rows.append(EventRow(cells, label, url, suffix))
    flush()

    if tuple(table.name for table in tables) != MONTHS:
        raise ValueError('Ожидались четыре месячные таблицы в фиксированном порядке')
    all_rows = [row for table in tables for row in table.rows]
    city_counts = dict(Counter(row.cells[1] for row in all_rows))
    theme_counts = dict(Counter(row.cells[3] for row in all_rows))
    return DocumentData(title, freshness, tuple(tables), city_counts, theme_counts)
```

- [ ] **Step 5: Запустить parser tests**

Run:

```bash
cd '/tmp/ast_forum_events_docx_20260810'
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' -m unittest -v test_build_events_docx.py
```

Expected: 4 tests PASS; total 29; months 10/7/10/2; themes 25/4.

---

### Task 2: Собрать portrait-титул, статистику и брендовые стили

**Files:**
- Modify: `/tmp/ast_forum_events_docx_20260810/build_events_docx.py`
- Create: `/tmp/ast_forum_events_docx_20260810/events.candidate.docx`

**Interfaces:**
- Consumes: `DocumentData` from Task 1.
- Produces: `configure_styles(doc: Document)`, `add_title_and_statistics(doc: Document, data: DocumentData, logo_path: Path)`, `build_docx(...)`.

- [ ] **Step 1: Добавить constants и базовые helpers Word**

Добавить в `build_events_docx.py`:

```python
from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

PRIMARY = '282828'
SECONDARY = '4A4A4A'
ACCENT = 'F53F00'
ACCENT_SECONDARY = 'FF551A'
TABLE_HEADER = 'FF7140'
BODY_PT = 12
HEADING_PT = 14


def set_run_font(run, points: int, color: str, bold: bool = False):
    run.font.name = 'Arial'
    run.font.size = Pt(points)
    run.font.color.rgb = RGBColor.from_string(color)
    run.font.bold = bold


def set_paragraph_spacing(paragraph, before=0, after=4, line=1.0):
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line


def configure_styles(doc: Document):
    normal = doc.styles['Normal']
    normal.font.name = 'Arial'
    normal.font.size = Pt(BODY_PT)
    normal.font.color.rgb = RGBColor.from_string(PRIMARY)
    for style_name in ('Title', 'Heading 1', 'Heading 2', 'Heading 3'):
        style = doc.styles[style_name]
        style.font.name = 'Arial'
        style.font.size = Pt(HEADING_PT)
        style.font.color.rgb = RGBColor.from_string(PRIMARY)
        style.font.bold = True
```

- [ ] **Step 2: Реализовать portrait-титул и статистику**

```python
def add_title_and_statistics(doc: Document, data: DocumentData, logo_path: Path):
    section = doc.sections[0]
    section.orientation = WD_ORIENT.PORTRAIT
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    logo_p = doc.add_paragraph()
    logo_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    logo_p.add_run().add_picture(str(logo_path), width=Inches(4.8))

    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(title_p.add_run(data.title), HEADING_PT, PRIMARY, bold=True)
    set_paragraph_spacing(title_p, before=6, after=3)

    date_p = doc.add_paragraph()
    date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(date_p.add_run(f'Актуальность: {data.freshness}'), BODY_PT, SECONDARY)

    rule = doc.add_paragraph()
    set_run_font(rule.add_run('━' * 48), BODY_PT, ACCENT)
    rule.alignment = WD_ALIGN_PARAGRAPH.CENTER

    heading = doc.add_paragraph()
    set_run_font(heading.add_run('Краткая статистика'), HEADING_PT, PRIMARY, bold=True)
    set_paragraph_spacing(heading, before=4, after=4)

    stats = (
        'Всего событий: 29',
        'По месяцам: сентябрь — 10; октябрь — 7; ноябрь — 10; декабрь — 2',
        'По городам: Москва — 19; Санкт-Петербург — 4; Екатеринбург — 3; Казань — 2; Не опубликован — 1',
        'По тематике: Строительство — 25; ИТ / госсектор — 4',
    )
    for index, text in enumerate(stats):
        p = doc.add_paragraph(style='List Bullet')
        set_run_font(p.add_run(text), BODY_PT, PRIMARY, bold=index == 0)
        set_paragraph_spacing(p, after=2)
```

Acceptance:
- титул, дата и все текстовые заголовки имеют 14/12 pt по правилам;
- PNG используется без преобразования и с сохранением пропорций 1600×600;
- статистика вычисляется и сверяется parser tests, а не копируется из потенциально устаревшего абзаца.

---

### Task 3: Добавить landscape-таблицы, ссылки и повторяемые заголовки

**Files:**
- Modify: `/tmp/ast_forum_events_docx_20260810/build_events_docx.py`

**Interfaces:**
- Consumes: `DocumentData.months`.
- Produces: четыре Word tables, `add_hyperlink`, `set_repeat_table_header`, `set_row_cant_split`, `add_month_tables`.

- [ ] **Step 1: Добавить OOXML helpers**

```python
def set_cell_shading(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tc_pr.append(shd)
    shd.set(qn('w:fill'), fill)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement('w:tblHeader')
    header.set(qn('w:val'), 'true')
    tr_pr.append(header)


def set_row_cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement('w:cantSplit')
    tr_pr.append(cant_split)


def set_fixed_layout(table):
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.find(qn('w:tblLayout'))
    if layout is None:
        layout = OxmlElement('w:tblLayout')
        tbl_pr.append(layout)
    layout.set(qn('w:type'), 'fixed')


def add_hyperlink(paragraph, text: str, url: str):
    rel_id = paragraph.part.relate_to(
        url,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        is_external=True,
    )
    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), rel_id)
    run = OxmlElement('w:r')
    props = OxmlElement('w:rPr')
    color = OxmlElement('w:color')
    color.set(qn('w:val'), ACCENT)
    size = OxmlElement('w:sz')
    size.set(qn('w:val'), str(BODY_PT * 2))
    underline = OxmlElement('w:u')
    underline.set(qn('w:val'), 'single')
    props.extend((color, size, underline))
    run.append(props)
    text_node = OxmlElement('w:t')
    text_node.text = text
    run.append(text_node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
```

- [ ] **Step 2: Создать landscape section и четыре таблицы**

Использовать A4 landscape, поля 1,0 см и фиксированные ширины в сумме 27,3 см:

```python
COLUMN_WIDTHS_CM = (1.8, 2.2, 4.5, 2.5, 5.4, 1.8, 6.0, 3.1)


def add_month_tables(doc: Document, data: DocumentData):
    section = doc.add_section(WD_SECTION.NEW_PAGE)
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    section.top_margin = Cm(1.0)
    section.bottom_margin = Cm(1.0)
    section.left_margin = Cm(1.0)
    section.right_margin = Cm(1.0)

    for month_index, month in enumerate(data.months):
        if month_index:
            doc.add_page_break()
        month_p = doc.add_paragraph()
        month_p.paragraph_format.keep_with_next = True
        set_run_font(month_p.add_run(month.name), HEADING_PT, PRIMARY, bold=True)

        table = doc.add_table(rows=1, cols=8)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        set_fixed_layout(table)
        for column, width_cm in zip(table.columns, COLUMN_WIDTHS_CM):
            column.width = Cm(width_cm)

        header_row = table.rows[0]
        set_repeat_table_header(header_row)
        for index, (cell, label, width_cm) in enumerate(zip(header_row.cells, month.headers, COLUMN_WIDTHS_CM)):
            cell.width = Cm(width_cm)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_shading(cell, TABLE_HEADER)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run_font(p.add_run(label), HEADING_PT, PRIMARY, bold=True)

        for event in month.rows:
            row = table.add_row()
            set_row_cant_split(row)
            for index, (cell, value, width_cm) in enumerate(zip(row.cells, event.cells, COLUMN_WIDTHS_CM)):
                cell.width = Cm(width_cm)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
                p = cell.paragraphs[0]
                set_paragraph_spacing(p, after=0, line=1.0)
                if index == 2 and event.url:
                    add_hyperlink(p, event.event_label, event.url)
                    if event.suffix:
                        set_run_font(p.add_run(event.suffix), BODY_PT, PRIMARY)
                else:
                    set_run_font(p.add_run(strip_outer_bold(value)), BODY_PT, PRIMARY)
```

- [ ] **Step 3: Завершить builder CLI и создать кандидат**

```python
def build_docx(source: Path, logo: Path, output: Path):
    data = parse_markdown(source)
    if sum(len(month.rows) for month in data.months) != 29:
        raise ValueError('DOCX не создаётся: актуальный источник содержит не 29 строк')
    doc = Document()
    configure_styles(doc)
    add_title_and_statistics(doc, data, logo)
    add_month_tables(doc, data)
    note = doc.add_paragraph()
    set_run_font(
        note.add_run('Перед покупкой билетов даты и тарифы следует повторно проверить на официальных страницах мероприятий.'),
        BODY_PT,
        SECONDARY,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)


if __name__ == '__main__':
    build_docx(
        Path('/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md'),
        Path('/Users/vvv/Проекты/АСТ Форум/Brandbook/horizontal logo/png/horizontal logo_FORUM_color_text.png'),
        Path('/tmp/ast_forum_events_docx_20260810/events.candidate.docx'),
    )
```

Run:

```bash
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' \
  '/tmp/ast_forum_events_docx_20260810/build_events_docx.py'
test -s '/tmp/ast_forum_events_docx_20260810/events.candidate.docx'
```

Expected: кандидат существует и не пуст; source/spec не изменены.

---

### Task 4: Реализовать автоматическую проверку DOCX и OOXML

**Files:**
- Create: `/tmp/ast_forum_events_docx_20260810/verify_events_docx.py`
- Read: `/tmp/ast_forum_events_docx_20260810/events.candidate.docx`

**Interfaces:**
- Produces: exit code 0 только для кандидата, выполняющего все структурные и data-integrity требования.

- [ ] **Step 1: Написать validator с жёсткими assertions**

Validator должен открыть DOCX через `python-docx` и ZIP/OOXML и проверить:

```python
from pathlib import Path
import sys
from zipfile import ZipFile
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn
from docx.shared import Pt

CANDIDATE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/ast_forum_events_docx_20260810/events.candidate.docx')
doc = Document(CANDIDATE)

assert len(doc.tables) == 4, len(doc.tables)
assert [len(table.rows) - 1 for table in doc.tables] == [10, 7, 10, 2]
assert sum(len(table.rows) - 1 for table in doc.tables) == 29
assert all(len(table.columns) == 8 for table in doc.tables)
assert doc.sections[0].orientation == WD_ORIENT.PORTRAIT
assert any(section.orientation == WD_ORIENT.LANDSCAPE for section in doc.sections[1:])

for table in doc.tables:
    header = table.rows[0]
    assert header._tr.get_or_add_trPr().find(qn('w:tblHeader')) is not None
    for cell in header.cells:
        runs = [run for p in cell.paragraphs for run in p.runs if run.text]
        assert runs and all(run.font.size == Pt(14) for run in runs)
    for row in table.rows[1:]:
        assert row._tr.get_or_add_trPr().find(qn('w:cantSplit')) is not None
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    if run.text:
                        assert run.font.size is None or run.font.size >= Pt(12)

with ZipFile(CANDIDATE) as archive:
    document_xml = archive.read('word/document.xml').decode('utf-8')
    rels_xml = archive.read('word/_rels/document.xml.rels').decode('utf-8')
    media = [name for name in archive.namelist() if name.startswith('word/media/')]

assert document_xml.count('<w:tblHeader') == 4
assert document_xml.count('<w:hyperlink') == 29
assert 'w:orient="landscape"' in document_xml
assert 'w:fill="FF7140"' in document_xml
assert 'w:val="28"' in document_xml
assert 'w:val="24"' in document_xml
assert rels_xml.count('TargetMode="External"') >= 29
assert media, 'Логотип не встроен в DOCX'

print('PASS: 29 rows; 4 tables; 8 columns; portrait+landscape; fonts 12/14 pt; 29 hyperlinks; repeated headers; logo embedded')
```

- [ ] **Step 2: Запустить parser tests и DOCX validator**

Run:

```bash
cd '/tmp/ast_forum_events_docx_20260810'
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' -m unittest -v test_build_events_docx.py
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' verify_events_docx.py
```

Expected: все unit tests PASS; validator печатает строку `PASS` и возвращает code 0.

- [ ] **Step 3: Если проверка не проходит, исправить builder, пересоздать кандидат и повторить Task 4**

Запрещено ослаблять assertions ради прохождения. Исправлять нужно структуру кандидата.

---

### Task 5: Выполнить render и проверить каждую страницу

**Files:**
- Read: `/tmp/ast_forum_events_docx_20260810/events.candidate.docx`
- Create temporary: `/tmp/ast_forum_events_docx_20260810/rendered/page-*.png`
- Create temporary: `/tmp/ast_forum_events_docx_20260810/rendered/events.candidate.pdf`

**Interfaces:**
- Consumes: validated candidate from Task 4.
- Produces: полный набор последовательных PNG и постраничный QA verdict.

- [ ] **Step 1: Отрендерить кандидат с официальным helper**

Run:

```bash
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' \
  '/Users/vvv/.codex/plugins/cache/openai-primary-runtime/documents/26.805.11740/skills/documents/render_docx.py' \
  '/tmp/ast_forum_events_docx_20260810/events.candidate.docx' \
  --output_dir '/tmp/ast_forum_events_docx_20260810/rendered' \
  --width 2200 \
  --height 2200 \
  --emit_pdf \
  --verbose
find '/tmp/ast_forum_events_docx_20260810/rendered' -maxdepth 1 -name 'page-*.png' -print | sort -V
```

Expected: последовательные `page-*.png` без пропусков и PDF `events.candidate.pdf`.

- [ ] **Step 2: Автоматически проверить целостность PNG-набора**

Run:

```bash
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' -c "
from pathlib import Path
from PIL import Image
pages = sorted(Path('/tmp/ast_forum_events_docx_20260810/rendered').glob('page-*.png'), key=lambda p: int(p.stem.split('-')[1]))
assert pages, 'Нет PNG-страниц'
assert [int(p.stem.split('-')[1]) for p in pages] == list(range(1, len(pages) + 1))
for page in pages:
    with Image.open(page) as image:
        assert image.width >= 1000 and image.height >= 1000, (page, image.size)
print(f'PASS: {len(pages)} contiguous rendered pages')
"
```

- [ ] **Step 3: Просмотреть каждую PNG-страницу через `view_image`**

Открыть последовательно каждый файл из отсортированного вывода `find`; не использовать выборку. Для каждой страницы подтвердить:

- нет обрезанных колонок, строк, заголовков и логотипа;
- таблица находится в landscape и использует полную доступную ширину;
- основной текст и таблицы визуально читаемы при 12 pt, заголовки — 14 pt;
- строки заголовков таблиц повторяются на каждой странице продолжения;
- оранжевый фон `#FF7140` и текст `#282828` контрастны;
- нет пустых страниц, наложений, висячих названий месяцев и потерянных строк;
- ссылки визуально различимы, но названия мероприятий остаются читаемыми;
- длинные тарифы полностью видны и переносятся внутри ячеек.

- [ ] **Step 4: Выполнить обязательный цикл исправлений**

При любом дефекте изменить `build_events_docx.py`, пересоздать кандидат и полностью повторить Tasks 4–5. Разрешённые изменения: ширины колонок, поля не меньше 1,0 см, интервалы, внутренние отступы, переносы и число страниц. Запрещено уменьшать 12/14 pt или обрезать содержимое.

Acceptance: каждая страница получила явный PASS после визуального просмотра.

---

### Task 6: Финальная целостность и публикация DOCX

**Files:**
- Read: `/tmp/ast_forum_events_docx_20260810/events.candidate.docx`
- Create final: `/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx`
- Verify unchanged: source Markdown и design spec.

**Interfaces:**
- Consumes: candidate с PASS автоматических и постраничных проверок.
- Produces: единственный финальный DOCX в утверждённом пути.

- [ ] **Step 1: Перед публикацией проверить неизменность всех входов**

Run:

```bash
shasum -a 256 \
  '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.md' \
  '/Users/vvv/Проекты/АСТ Форум/docs/implementation-plans/2026-08-10-events-docx-design.md' \
  '/Users/vvv/Проекты/АСТ Форум/Brandbook/all colors.pdf' \
  '/Users/vvv/Проекты/АСТ Форум/Brandbook/horizontal logo/png/horizontal logo_FORUM_color_text.png' \
  > '/tmp/ast_forum_events_docx_20260810/inputs.after.sha256'
cmp -s \
  '/tmp/ast_forum_events_docx_20260810/inputs.before.sha256' \
  '/tmp/ast_forum_events_docx_20260810/inputs.after.sha256'
```

Expected: `cmp` returns 0. Если вход изменился, не публиковать кандидат; начать заново с Task 1 на свежем источнике.

- [ ] **Step 2: Скопировать прошедший QA кандидат в финальный путь**

Run:

```bash
cp -p \
  '/tmp/ast_forum_events_docx_20260810/events.candidate.docx' \
  '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx'
cmp -s \
  '/tmp/ast_forum_events_docx_20260810/events.candidate.docx' \
  '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx'
```

Expected: финал побайтно идентичен кандидату; исходник остаётся `Мероприятия 09-12.2026.md`.

- [ ] **Step 3: Повторить автоматический validator для финального файла**

Передать финальный путь валидатору как CLI argument:

```bash
'/Users/vvv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3' \
  '/tmp/ast_forum_events_docx_20260810/verify_events_docx.py' \
  '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx'
shasum -a 256 '/Users/vvv/Проекты/АСТ Форум/docs/Мероприятия 09-12.2026.docx'
```

Expected: validator PASS; SHA-256 финала зафиксирован в отчёте.

- [ ] **Step 4: Финальный отчёт без коммита**

Сообщить:

- путь `docs/Мероприятия 09-12.2026.docx`;
- 29 строк и месячные суммы 10/7/10/2;
- 4 таблицы, 8 колонок, 29 кликабельных ссылок;
- portrait-титул и landscape-таблицы;
- размеры 12/14 pt и встроенный логотип;
- число проверенных PNG-страниц и факт `inspect every page`;
- SHA-256 итогового DOCX;
- подтверждение, что source/spec не изменились и коммит не выполнялся.

Не выполнять `git commit`.
