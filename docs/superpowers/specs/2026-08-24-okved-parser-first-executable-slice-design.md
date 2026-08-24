# Первый исполняемый срез парсера организаций по ОКВЭД

## Цель

Создать воспроизводимый локальный ingestion-контур, который доказывает структуру данных, браузерный пользовательский flow и идемпотентную публикацию без обращения к live List-Org.

Первый исполняемый срез работает только с юридическими лицами и сохранёнными fixture-страницами. Он принимает один ОКВЭД, запускает браузер против локального fixture-origin, проходит форму поиска, страницы результатов и карточки организаций, сохраняет проверяемые raw-артефакты, нормализует компании и связывает их с ОКВЭД. Финансовые adapters разбирают малые fixture-фрагменты БФО и `revexp` по согласованному маппингу.

## Утверждённые границы

- Этап 1 — только юридические лица с ИНН длиной 10.
- Этап 2 — ИП с ИНН-12, ОГРНИП и отдельными источниками; реализация ИП в этот срез не входит.
- List-Org в production предполагает автоматическую headful-навигацию через видимые элементы `/search`.
- Live-доступ к List-Org в этот срез не входит и остаётся закрыт source-policy gate.
- Excel/bulk endpoints, скрытые API, прямой HTTP-crawler, подмена browser identity, proxy rotation и CAPTCHA-solving запрещены.
- CAPTCHA, 403, policy block и contract drift терминально блокируют live-run; resume заблокированного run не поддерживается.
- Финансовые поля фиксированы: `revenue ← Ф2.2110`, `expenses ← расходы ФНС`, `income ← доходы ФНС`.

## Рассмотренные варианты

### 1. Модульный ingestion-контур с browser port — выбран

Node.js/TypeScript-приложение содержит модуль `audience`, прямой PostgreSQL adapter, storage port и `BrowserSession` port. Fixture и будущий live browser-runner реализуют один контракт, но fixture-origin запрещает незамоканный внешний трафик.

Преимущества: соответствует целевой архитектуре, позволяет тестировать браузерный flow без live-сайта, сохраняет provenance и не требует переписывать доменную публикацию при подключении List-Org.

Цена: больше начального scaffolding, чем у одноразового скрипта.

### 2. Одноразовый Playwright-скрипт с прямой записью в БД — отклонён

Быстрее даёт первые строки, но смешивает навигацию, парсинг, валидацию и SQL. Повтор запуска, частичные ошибки и переход к worker/queue потребуют переписывания.

### 3. Файловый ETL без PostgreSQL — отклонён

Упрощает fixture-разбор, но не проверяет ключи, ограничения, транзакционную публикацию и финансовый lineage, ради которых создаётся первый срез.

## Архитектура

### Runtime

- Node.js 24 LTS и TypeScript.
- PostgreSQL через `pg` и явный параметризованный SQL.
- Миграции grouped SQL через выбранный Node migration runner.
- Playwright с закреплённой версией Chromium.
- Локальное S3-совместимое хранилище за storage port.
- Fixture browser tests могут выполняться headless; будущий live List-Org adapter — только foreground/headful на интерактивном хосте.

### Компоненты

1. `audience/domain` — ИНН, ОКВЭД, crawl state, естественные ключи и правила публикации.
2. `audience/application` — импорт ОКВЭД, запуск crawl, публикация компаний и финансов, reconciliation.
3. `audience/infrastructure/postgres` — repositories и транзакции владельца схемы `audience`.
4. `audience/infrastructure/storage` — immutable raw bundles и checksum metadata.
5. `audience/infrastructure/sources/list-org-browser` — `BrowserSession` adapter.
6. `audience/infrastructure/sources/fns-revexp` — streaming XML parser fixture-релиза.
7. `audience/infrastructure/sources/fns-bfo` — parser fixture-ответа формы 0710002.
8. `test/support/list-org-fixture-server` — локальный origin с формой, пагинацией, карточками и ошибочными сценариями.

## Модель данных

Схема `audience` владеет таблицами:

- `crawl_runs` и `crawl_tasks` — параметры, состояния и аудит запуска;
- `source_fetches` — immutable metadata raw-артефактов;
- `dataset_releases` — версии файловых финансовых источников;
- `companies` — ЮЛ по валидированному ИНН;
- `okveds` — канонические строковые коды;
- `company_okveds` — M:N с составным ключом `(company_inn, okved_code)` и `is_primary`;
- `run_company_matches` — связь результата с запуском;
- `organization_evidence` — provenance нормализованных данных компании;
- `financial_evidence` — provenance отдельной финансовой метрики/группы;
- `financial_observations` — wide-проекция `(company_inn, report_year)`.

Денежные значения хранятся как `numeric(18,2)`. `NULL` означает отсутствие опубликованного значения; опубликованный `0` остаётся нулём и обязательно имеет evidence.

## Browser fixture-flow

1. Создать `crawl_run` с immutable scope: ОКВЭД, статус ЮЛ, лимиты и версии parser/fixtures.
2. Открыть локальный fixture-origin в Chromium.
3. Заполнить `okved`, включить `work`, проверить значения controls и отправить форму кликом.
4. После readiness condition проверить видимое состояние фильтров.
5. Сохранить ordered company IDs и fingerprint страницы.
6. Открыть каждую карточку в контролируемой вкладке, сохранить санитизированный raw bundle, закрыть вкладку и повторно проверить fingerprint выдачи.
7. Перейти на следующую страницу только кликом по видимой ссылке.
8. Завершить enumeration только по положительному end-of-results invariant или по явному лимиту.
9. Опубликовать staging в доменные таблицы транзакционно после reconciliation.

Fixture-origin покрывает happy path, duplicate company, изменившийся порядок, CAPTCHA, 403, soft block, contract drift и отсутствие terminal pagination marker. Любой незамоканный внешний request блокируется.

## Raw и provenance

Browser raw bundle содержит final URL, timestamp, navigation status/checksum, санитизированный post-render DOM, redacted screenshot, page/record identity и журнал browser actions. DOM и screenshot проходят allowlist/redaction и secret/PII scan до immutable persistence.

Dry-run пишет run/task/fetch audit и raw bundles, но не публикует доменные строки. Replay-write использует тот же raw manifest без повторного browser fetch.

## Ошибки и восстановление

- Невалидный ИНН и неоднозначный ОКВЭД попадают в reject, не в доменные таблицы.
- CAPTCHA, 403, policy block и contract drift дают терминальный `blocked`.
- Browser crash восстанавливается новым ephemeral context и безопасным replay от первой страницы с дедупликацией; cookies/storage state не сохраняются.
- Browser actions защищены write-ahead ledger, page fingerprint и lease/fencing token.
- Сбой одного финансового источника не стирает поля другого.
- Financial evidence и wide-проекция публикуются атомарно.

## Тестирование и критерии готовности

Первый срез готов, когда:

1. Чистая локальная среда поднимает PostgreSQL, storage, worker и fixture-origin.
2. Миграции применяются и откатываются на тестовой БД.
3. Fixture browser-flow проходит форму, две страницы и карточки без live-трафика.
4. Повторяющаяся компания создаёт одну `companies`, одну связь ИНН/ОКВЭД и один match в run.
5. Повтор fixture-run не меняет доменные количества и значения.
6. CAPTCHA/403/soft block/drift не превращаются в пустой успешный результат.
7. `revenue`, `income` и `expenses` соответствуют утверждённым источникам; `0` и `NULL` различаются.
8. Каждое опубликованное значение восстанавливается до raw checksum и evidence.
9. Reconciliation объясняет каждую fixture-запись и каждую задачу.

## Следующий переход

После прохождения fixture-среза отдельно закрываются source-policy gate List-Org и машинный контракт БФО. Затем выполняются bounded live discovery canary и financial enrichment canary. Реализация ИП начинается отдельным вторым этапом и не расширяет первый срез.
