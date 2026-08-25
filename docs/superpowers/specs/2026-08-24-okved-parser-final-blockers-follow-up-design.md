# Follow-up: закрытие финальных блокеров OKVED parser

## Цель

Закрыть три остаточных Important-замечания scoped re-review ветки `codex/okved-parser` без расширения продуктового scope: сделать постановку replay-задачи атомарной, сравнение повторных browser-records — независимым от порядка, а raw-снимки — fail-closed для неизвестных form secrets.

Этот follow-up продолжает утверждённый дизайн первого исполняемого среза из `2026-08-24-okved-parser-first-executable-slice-design.md`. Все ранее зафиксированные ограничения и финансовый маппинг сохраняются.

## Границы

- Этап 1 по-прежнему обрабатывает только юридические лица с ИНН-10.
- ИП остаются вторым этапом.
- Live List-Org и live ФНС не включаются и не тестируются.
- Browser discovery продолжает выполняться через Chromium и видимые элементы страницы; bulk endpoints и прямой HTTP-crawler запрещены.
- Финансовый маппинг не меняется: `revenue ← Ф2.2110`, `income ← доходы ФНС`, `expenses ← расходы ФНС`.
- Новая таблица outbox и отдельный dispatcher-сервис не добавляются.
- Схема из одиннадцати доменных таблиц остаётся без изменений.
- Неблокирующее разделение крупных orchestration-файлов не входит в follow-up, кроме небольших выделений, прямо необходимых для тестируемых правил.

## Рассмотренные варианты crash-safe enqueue

### 1. Одна PostgreSQL-транзакция для task и pg-boss job — выбран

pg-boss поддерживает отправку job через переданный transaction-bound database adapter. Queue создаётся до начала доменной транзакции. Затем одна PostgreSQL-транзакция:

1. проверяет, что run существует и допускает replay;
2. создаёт `crawl_task` со стабильным UUID;
3. вставляет pg-boss job с тем же UUID как job ID и payload `{ runId, taskId }`;
4. коммитит обе записи вместе.

Если enqueue возвращает конфликт, выбрасывает ошибку или соединение обрывается до commit, PostgreSQL откатывает и task, и job. После успешного commit не существует окна, в котором task сохранён без job.

Преимущества: закрывает crash-window на уровне БД, не требует нового daemon и не изменяет доменную схему. Цена: инфраструктурный pg-boss adapter получает отдельную transaction-bound операцию, а composition root координирует две инфраструктурные записи.

### 2. Transactional outbox — отклонён

Outbox также даёт eventual delivery, но требует новой таблицы, poller-а, claim/lease протокола и дополнительного lifecycle. Для двух записей в одной PostgreSQL базе это лишняя инфраструктура.

### 3. Детерминированный task с повторным enqueue — отклонён

Повтор команды мог бы переиспользовать pending task, но без внешнего retry orphan оставался бы незавершённым. Это ослабляет требование «после crash нет task без job».

## Атомарная постановка replay

### Компоненты

- `PgBossJobQueue` сохраняет обычный `publish()` для существующих consumers и получает transaction-bound метод постановки job.
- Transaction adapter реализует минимальный pg-boss `IDatabase.executeSql()` поверх существующего `Database.query()`; Playwright, application и domain слои его не видят.
- Composition root `browser-runner` сначала гарантирует существование queue, затем открывает `PostgresDatabase.transaction()` и внутри использует `AudienceRepository` на том же transaction object вместе с transaction-bound enqueue.

### Инварианты

- UUID task и UUID pg-boss job совпадают.
- Payload всегда содержит тот же `{ runId, taskId }`.
- `singletonKey` остаётся `audience:<runId>:replay_write`.
- Ошибка до commit оставляет ноль новых replay tasks и ноль новых jobs.
- Успешный commit оставляет ровно один task и соответствующий job.
- Повторная доставка того же payload остаётся source-free после успешного завершения task.
- Ошибка инициализации или создания queue происходит до создания task.
- `failPreparedTask()` не используется для компенсации enqueue: атомарная транзакция не оставляет подготовленную запись, которую нужно компенсировать.

### Проверка crash-window

Integration regression выполняет реальную PostgreSQL-транзакцию и инъецирует исключение после `prepareTask`, но до pg-boss insert/commit. После rollback запросы к `audience.crawl_tasks` и pg-boss jobs подтверждают отсутствие обеих записей. Второй сценарий выполняет успешную атомарную постановку и worker delivery, после чего reconciliation не видит non-terminal task.

## Независимая от порядка обработка дублей

### Нормализованный результат

Для каждого `sourceRecordKey` browser traversal хранит первый нормализованный результат:

- `accepted` с полным нормализованным `OrganizationCandidate`, либо
- `rejected` с точной типизированной причиной reject.

Сравнение выполняется до ветвления на публикацию accepted/rejected:

- accepted + эквивалентный accepted — обычный duplicate;
- rejected + rejected с той же причиной — обычный duplicate;
- accepted + rejected — `duplicate_conflict`;
- rejected + accepted — `duplicate_conflict`;
- rejected(reason A) + rejected(reason B) — `duplicate_conflict`;
- accepted с изменившимися нормализованными полями — `duplicate_conflict`.

При конфликте run получает terminal blocker и raw-доказательство текущей карточки. Ранее сохранённый raw bundle остаётся связан с первым occurrence. Конфликтующая запись не попадает в companies/rejects как самостоятельный результат.

### Уточнение audit/reconciliation для блокеров и конфликтов

Occurrence добавляется в текущую страницу сразу после полного разбора карточки и проверки возврата к неизменившейся выдаче. Если после этого на той же странице возникает terminal blocker, уже разобранные occurrences сохраняются как partial page вместе с санитизированным raw-доказательством; блокировка не имеет права отбрасывать их.

`DiscoveryAudit` содержит отдельный счётчик `blockedOrConflicted`. Он учитывает один первый occurrence каждого materialized source record, который из-за `duplicate_conflict` был удалён из companies/rejects. Повторное конфликтующее occurrence остаётся в `duplicates`, поэтому каждое occurrence объясняется ровно один раз:

`occurrences = acceptedCompanies + duplicates + rejected + blockedOrConflicted`.

Блокер, достигнутый до полного разбора новой карточки (например, mid-page `http_403` или `contract_drift`), сам по себе не создаёт occurrence и не увеличивает `blockedOrConflicted`; ранее завершённые occurrences partial page продолжают учитываться в своих accepted/rejected/duplicate категориях. Таким образом `duplicate_conflict` по-прежнему исключает организацию из companies/rejects и сохраняет terminal evidence, не нарушая исходный критерий «reconciliation объясняет каждую fixture-запись».

### Критерий порядка

Один и тот же набор карточек обязан давать одинаковый blocker и одинаковые доменные количества при любой перестановке. Тесты явно покрывают accepted→rejected, rejected→accepted и rejected(reason A)→rejected(reason B).

## Fail-closed form sanitization

### DOM

- `value` удаляется из общего списка сохраняемых HTML-атрибутов.
- Ни один `<input>` не сохраняет текущее значение в raw DOM, независимо от типа и имени.
- `<input type="password">` удаляется целиком.
- Input с sensitive name удаляется целиком. Sensitive names сравниваются без учёта регистра и включают конфигурируемые query names, а также подстроки `token`, `csrf`, `secret`, `credential`, `password`, `api_key`, `apikey`, `authorization`, `cookie` и `session`.
- Остальные разрешённые inputs могут сохранять только структурные безопасные атрибуты `type`, `name`, `checked` и `disabled`.
- Post-scan отклоняет serialized markup, если он всё же содержит `value=` либо sensitive input name/value pair.

### Screenshot

Перед screenshot создаются overlays для:

- всех password inputs;
- inputs с sensitive name;
- всех form controls с непустым runtime value;
- узлов, содержащих известные contacts/secrets, как и раньше.

Потеря значения поискового поля в screenshot допустима, сохранение неизвестного секрета — нет. DOM/action evidence остаётся достаточным для проверки browser flow.

### Общая граница сохранения

`assertBrowserCaptureSafe()` остаётся последней проверкой до checksum и immutable write. Тесты вызывают именно persistence boundary, а не только внутренний sanitizer. Password, CSRF, API key и произвольный visible token не должны появляться ни в DOM, ни в screenshot input area, ни в manifest/action metadata.

## Ошибки и наблюдаемость

- Atomic enqueue возвращает публичную ошибку без содержимого connection string, payload secrets или argv.
- Rollback enqueue не создаёт failed task: отсутствующая операция точнее отражает отсутствие job.
- Duplicate conflict использует существующий terminal reason `duplicate_conflict` и сохраняет санитизированный blocker artifact.
- Raw sanitizer продолжает fail closed: сомнительный input удаляется или маскируется, а остаток приводит к отказу до S3.
- Live source gates не изменяются.

## TDD и критерии готовности

Follow-up готов только при выполнении всех условий:

1. RED-тест доказывает существующее окно task-before-job; после исправления rollback оставляет ноль task/job.
2. Успешный atomic enqueue создаёт связанный task/job и доходит через pg-boss worker до terminal task без non-terminal orphan.
3. Accepted→rejected, rejected→accepted и rejected(A)→rejected(B) завершаются одинаковым `duplicate_conflict` с raw evidence.
4. Точный accepted duplicate и rejected duplicate с той же причиной остаются допустимыми дублями.
5. Password, CSRF, API-key и visible token fixtures сначала демонстрируют утечку или отсутствие маскирования, затем не проходят в immutable evidence.
6. Существующие contact/URL/action redaction regressions остаются зелёными.
7. Полный TypeScript build, все unit/integration/e2e тесты, migration down/up и clean fixture acceptance проходят при `APP_MODE=fixture` и `LIST_ORG_LIVE_ENABLED=false`.
8. Scoped независимое ревью не находит Critical или Important замечаний в follow-up diff.

## Результат

После follow-up ветка должна обеспечивать атомарную постановку replay, детерминированную классификацию повторных source records и fail-closed сохранение browser evidence. Только после свежей полной верификации и чистого scoped review ветку можно предлагать к интеграции.
