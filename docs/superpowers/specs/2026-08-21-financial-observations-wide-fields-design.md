# Financial observations: отдельные поля показателей

## Цель

Обновить таблицу `financial_observations` на ER-диаграмме так, чтобы выручка, расходы и прибыль организации хранились отдельными столбцами, а не отдельными строками с типом метрики.

## Согласованное изменение

- Удалить поля `metric financialMetric` и `amount decimal`.
- Добавить поля `revenue decimal`, `expenses decimal` и `profit decimal`.
- Сохранить составной первичный ключ `company_inn + report_year + source`.
- Сохранить остальные поля и связи таблицы без изменений.
- Не создавать отдельный справочник финансовых метрик.

## Итоговая структура

| Тип ключа | Поле | Тип данных |
|---|---|---|
| PK, FK | `company_inn` | `char10` |
| PK | `report_year` | `smallint` |
| PK | `source` | `text` |
|  | `revenue` | `decimal` |
|  | `expenses` | `decimal` |
|  | `profit` | `decimal` |
|  | `source_record_id` | `text` |
| FK | `source_fetch_id` | `bigint` |
| FK | `dataset_release_id` | `bigint` |
|  | `as_of` | `date` |
|  | `collected_at` | `timestamptz` |

## Ограничения оформления

- Сохранить текущее положение и ширину таблицы, если увеличение высоты не требует иного.
- Не менять цвет шапки таблицы `financial_observations`.
- Не менять цвета шапок других таблиц ER-диаграммы.

## Проверка результата

- В таблице отсутствуют `metric` и `amount`.
- В таблице присутствуют `revenue`, `expenses` и `profit` с типом `decimal`.
- Ключи `company_inn`, `report_year` и `source` сохранены.
- Все поля происхождения данных и внешние связи сохранены.
- Цвет шапки визуально совпадает с исходным.
