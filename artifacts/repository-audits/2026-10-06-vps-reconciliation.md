# Read-only сверка VPS перед наведением порядка

Снимок получен 6 октября 2026; sanitized запись подготовлена 7 октября для PROJ-152.
Это подтверждённое наблюдение прежнего runtime. Deployment, merge, migrations и изменение данных этим этапом не выполнялись.

[Карта окружений и контракт](../../deployment/environments.md) связывают 20 контейнеров, девять доменов, фактические roots и источники.
[Три manifest](../releases/) содержат hashes и явно отмечают неизвестное происхождение. Их статус — `observed-unreconciled`.

## Источники доказательств

Приватные материалы read-only сверки сохранены вне Git. В записи используются только разрешённые metadata/source/config/site поля.
IDs ниже — названия категорий доказательства, а не публикуемые пути доступа к приватной копии.

| ID | Разрешённый источник | Что перенесено |
| --- | --- | --- |
| E1 | Docker inspect metadata | 20 container names/image IDs, Compose paths, сети, code/config/site mounts |
| E2 | Config/production Git-byte comparisons | 19 рассмотренных файлов; выбранные active config/static hashes и Git blob matches |
| E3 | API source comparisons | 33 matching API/build-input файла PR5; AppleDouble и legacy остатки исключены |
| E4 | Active Caddy metadata | Active/adapted canonical hashes, domains/upstreams/root |
| E5 | API compiled/migration и gateway origin metadata | 13 API output hashes; 9 origin route statuses/body hashes |
| E6 | Public HTTP metadata | 20 статусов/hashes: 9 dev страниц, 8 JS/CSS, production, Outline, OpenProject |
| E7 | Явно выбранные source/config/site файлы snapshot | Gateway Git-byte match; проверка dev mounted byte hashes |
| E8 | ACL и restore metadata | Зафиксированный default ACL drift; 3 успешных isolated restore, counts 21/9/42 |

E2 также содержит два одинаковых неактивных `Caddyfile.candidate` без совпадения с рассмотренными Git blobs и два legacy deployment-script экземпляра.
Они не выданы за active config или принятый release source. Active Caddyfile сравнен независимо в E4.

## Подтверждённые границы и оставшиеся расхождения

- Gateway source bytes равны PR4 `8833c8604e96a437ff4a8b8294e038567544ebec`.
- API source/build-input bytes равны PR5 `5084b30b0be5c3939870be8fdadd9643cd9af0a0`; все 13 runtime output hashes совпадают со свежей candidate-компиляцией.
- Mail/Outline/OpenProject Compose и Caddyfile равны PR6 `a75924cb7b715f9bd0d958bc812438389d090094`.
- DNS override равен PR13 `e9b9331d32c2a11fe7da6391fe01b6cfba8f9f60`; pgAdmin Compose/servers равны PR16 `9e4666fbd5cddef9d3d4a6b24c286f7a75557ac6`.
- Все семь production static файлов совпадают с сохранёнными Git blobs; публичный root body hash совпадает с `index.html`.
- Все девять dev origin страниц совпадают с public и mounted byte hashes; восемь public JS/CSS assets также совпадают с mounts.
- Built dev source SHA, custom Cal.diy image chain, mounted OpenProject patches и API installed dependencies остаются неизвестны.
- Auth loader отсутствует на audience/profile страницах, хотя присутствует на home/login/register: наблюдаемое F6.
- Активный API sandbox `iam/party` отделён от `forum.public`; profile preview остаётся fixture.
- Broad future-object default ACL в `forum.public` остаётся зарегистрированным drift; данные/grants не менялись.

## Восстановление и санитарная обработка

Родительский этап восстановил три свежих custom dumps в PostgreSQL 18.6 с `network-none`, `--no-owner --no-privileges`.
Counts: `forum` 21, sandbox 9, Outline 42 таблицы. Это schema/data restore proof; ownership/ACL recovery не проверен.
Globals/ACL сохранены отдельно приватно. Dumps, globals SQL, credentials, secret archives и пользовательские данные при подготовке Task3 не читались.

JSON строился явным allowlist полей. Data volumes, upload inventories, Env values, connection strings и secret/access paths исключены.
Sanitized данные не получены копированием полного inspect/config inventory. Config/site/source files читались только для byte/hash проверки.

Schema проверена реальным Ajv 8.20.0 из API-owned install, formats 3.0.1, dialect 2020-12.
Положительные observed/release fixtures и отрицательные probes проверяют строгие поля, SHA formats и обязательность source/build/deploy/served chain.
Synthetic release probe — проверка контракта; он не публикуется как факт deployment.

Task7 должен реализовать проверку соответствия ссылок и hashes между этапами. Schema проверяет структуру, а не истинность receipts.
Исходный approved plan сохранён без изменений, SHA256 `f6706bfe6f01608730d888af75ddce179579419ac6f77d549af1486bb59fd472`.
