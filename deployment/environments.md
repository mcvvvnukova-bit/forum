# Окружения и контракт доказательства выпуска

## Наблюдаемое состояние

Снимок VPS получен **6 октября 2026 года** в режиме read-only. Документы подготовлены 7 октября по московскому времени (UTC+03:00) для `PROJ-152`.
Это наблюдение до наведения порядка, а не выпуск текущей candidate-ветки. Новый Primer UI в production не опубликован.

Hostname: `test-debian`. Сверка восстановленного SSH-доступа выполнена родительским этапом; настройки SSH/VPN не менялись.
Публичный HTTP 200 сам по себе не доказывает версию исходников, сборки или приложения.

Наблюдения разделены на три [manifest](../artifacts/releases/):

| Окружение | Запись | Область |
| --- | --- | --- |
| dev | [dev observed](../artifacts/releases/2026-10-06-vps-dev-observed.json) | API, gateway, составной dev-сайт |
| production | [production observed](../artifacts/releases/2026-10-06-vps-production-observed.json) | Семь файлов старого статического сайта |
| shared | [shared observed](../artifacts/releases/2026-10-06-vps-shared-observed.json) | 18 общих контейнеров, Caddy, DB boundary, restore proof |

Каждый из 20 действующих контейнеров включён ровно один раз. Связи между manifest используют `componentIds`.
`production` описывает сайт `astforum.ru`; общие сервисы также обслуживают действующие системы организации.

## Домены, маршруты и файловые корни

Все перечисленные домены проходят через `outline-caddy-1`. Активная JSON-конфигурация Caddy совпадает с адаптированным mounted Caddyfile.
Их canonical SHA256: `4c25782266ea149aa1b5e5d01b0f6af0388e7c93b98c6d60611594e12e544db8`.

| Домен / маршрут | Upstream или root Caddy | Контейнер / mounted источник |
| --- | --- | --- |
| `astforum.ru/` | `/srv/astforum` | `/opt/outline/astforum`, семь файлов `deployment/astforum-static` |
| `dev.astforum.ru/` | `dev_landing_auth:8080` | `outline-dev_landing_auth-1`; `/opt/outline/dev-astforum/landing` |
| `dev.astforum.ru/api/auth/*` | gateway → `forum_api:3001` | `forum-api-forum_api-1`, API PR5; override совпадает с PR5/PR6 |
| `docs.astforum.ru` | `outline:3000` | `outline-outline-1` |
| `roadmap.astforum.ru` | `astforum-openproject-web:8080` | `astforum-openproject-web-1` |
| `roadmap.astforum.ru/hocuspocus*` | `astforum-openproject-collaboration:1234` | `astforum-openproject-collaboration-1` |
| `cal.astforum.ru` | `astforum-cal-diy-web-1:3000` | Custom Cal.diy image; source/build chain неизвестна |
| `campaigns.astforum.ru` | `astforum-mail-listmonk-1:9000` | `astforum-mail-listmonk-1` |
| `mail.astforum.ru` | `astforum-stalwart:8080` | `astforum-mail-stalwart-1` |
| `webmail.astforum.ru` | `astforum-tmail:80` | `astforum-mail-tmail-1` |
| `pg.astforum.ru` | `pgadmin:5050` | `pgadmin-pgadmin-1` |

Production также содержит правило relay для Sber callback. Это маршрутизация; она не заменяет статические production-файлы новым UI.
HTTP-хеши dev получены с авторизованной gateway-сессией. Содержимое cookie, сессии и пользовательских ответов не публикуется.
Публичные ответы Outline/OpenProject зафиксированы как hashes/status; их совпадение с файловым mount не утверждается.

## Все действующие сервисы

Полные image IDs, Compose paths, сети и разрешённые code/config/site mounts находятся в manifest.
Docker image ID означает локальный image content ID. Его нельзя выдавать за registry manifest digest.
`vendor` фиксирует полученный образ, но не утверждает известный upstream Git commit.

| Контейнер | Образ | Происхождение конфигурации / ограничение |
| --- | --- | --- |
| `forum-api-forum_api-1` | `astforum/forum-api:20261001-sber-dns` | 33 source/build-input файла PR5; DNS override PR13; build/deploy/dependencies неизвестны |
| `outline-dev_landing_auth-1` | `python:3.13-alpine` | Gateway bytes PR4, Compose PR6, API override PR5/PR6 |
| `outline-caddy-1` | `caddy:2.10-alpine` | Caddyfile и Compose PR6; active config hash совпадает |
| `outline-outline-1` | `outlinewiki/outline:1.9.2` | Compose PR6; vendor image |
| `outline-postgres-1` | `postgres:18-alpine` | Compose PR6; общий PostgreSQL, measured 18.6 |
| `outline-redis-1` | `redis:8-alpine` | Compose PR6; vendor image |
| `pgadmin-pgadmin-1` | `dpage/pgadmin4:9.17` | Compose/servers PR16, не прежний PR7 |
| `astforum-openproject-web-1` | `openproject/openproject:17.8.0-slim` | Compose PR6; mounted Ruby patches без source/hash proof |
| `astforum-openproject-worker-1` | `openproject/openproject:17.8.0-slim` | Compose PR6; те же непроверенные mounted patches |
| `astforum-openproject-collaboration-1` | `openproject/hocuspocus:17.8.0` | Compose PR6; vendor image |
| `astforum-openproject-db-1` | `postgres:17-alpine` | Compose PR6; vendor image |
| `astforum-openproject-cache-1` | `memcached:1.6-alpine` | Compose PR6; vendor image |
| `astforum-mail-tmail-1` | `linagora/tmail-web:v0.36.0` | Compose PR6; application settings не сверялись |
| `astforum-mail-listmonk-1` | `listmonk/listmonk:v6.2.0` | Compose PR6; data/uploads исключены |
| `astforum-mail-stalwart-1` | `stalwartlabs/stalwart:v0.16.21` | Compose PR6; application settings/data не сверялись |
| `astforum-mail-database-1` | `postgres:17-alpine` | Compose PR6; vendor image |
| `astforum-cal-diy-web-1` | `astforum/cal-diy:8b6088261b09` | Tag/Compose path содержит SHA; Git/build/deploy proof отсутствует |
| `astforum-cal-diy-reminder-worker-1` | тот же custom image | Mounted worker не сравнивался с Git |
| `astforum-cal-diy-database-1` | `postgres:16-alpine` | Vendor image; происхождение Compose неизвестно |
| `astforum-cal-diy-redis-1` | `redis:8-alpine` | Vendor image; происхождение Compose неизвестно |

`file-byte-match` фиксирует равенство конкретных файлов Git blobs. Оно не определяет уникальный checkout или команду deployment.
Одни и те же production blobs есть в нескольких commits. Для сравнения выбран сохранённый commit `19120a8fb11b3251ea636d122ba09bf93af4e87d`.
Точные source SHA и paths PR4/5/6/13/16 находятся в `sources` соответствующего компонента.

API outputs проверены свежей компиляцией candidate: десять JS-файлов и три migration-файла совпадают со всеми 13 записанными runtime hashes.
Это доказательство bytes. Candidate lock/dependencies и тестовые scaffolding изменялись в Task2c; установленное дерево зависимостей runtime не измерялось.
Node snapshot API: `v24.21.0`; локальная компиляция: `v24.18.1`. Image build и deployment receipts отсутствуют.

## Dev UI и принятая структура

| Страницы | Source candidate | Auth loader в наблюдаемом HTML |
| --- | --- | --- |
| `/` | PR12 `deployment/primer-home` | Есть |
| `/customers/`, `/suppliers/`, `/work/`, `/participate/` | PR11 `deployment/audience-pages` | Нет |
| `/login/`, `/register/` | PR13 `deployment/public-auth` | Есть |
| `/profile/`, `/profile/work/` | PR14 `local-previews/user-profile` | Нет; fixture |

Origin/public hashes и mounted bytes совпадают для девяти страниц и восьми JS/CSS assets.
Source SHA этих built assets ещё не доказан воспроизводимой сборкой. Несогласованный auth loader — наблюдаемое F6.
Улучшения общей сборки candidate не отражают уже опубликованное состояние VPS.

План предусматривает единое владение публичным web artifact и будущий перенос production static в `apps/web/production-static`.
Сегодняшние server roots и source candidates выше остаются фактическими. Task4/5 выбирают/переносят исходники; Task7 создаёт выпуск с доказательствами.
Продуктовые требования находятся в Outline. Эти документы описывают эксплуатационные границы и не создают нового продуктового задания.

## Базы данных и восстановление

Действующий API обращается к `forum_sber_sandbox` на общем PostgreSQL: схемы `iam` и `party`.
Отдельная база `forum` содержит модель `public`/migration 003. Наличие SQL-файла в image не доказывает его применение к активной базе.
Наведение порядка **не разрешает** миграцию активного sandbox IAM в `forum.public` и подключение profile fixture к реальным данным.

Известные текущие IAM grants проверены отдельно. В `forum.public` остаётся broad default ACL для будущих объектов роли Outline:
таблицы `arwd`, sequences `rU`. Этот drift зарегистрирован, runtime grants не изменялись.

| Проверка свежего custom dump | Restore | Таблиц | Граница доказательства |
| --- | --- | --- | --- |
| `forum` | PostgreSQL 18.6, `network-none` | 21 | Schema/data читаются |
| `forum_sber_sandbox` | PostgreSQL 18.6, `network-none` | 9 | Schema/data читаются |
| `outline` | PostgreSQL 18.6, `network-none` | 42 | Schema/data читаются |

Restore выполнялся с `--no-owner --no-privileges`. Это не проверка восстановления ownership и ACL.
Globals/ACL сохранены отдельно приватно; их содержимое и database dumps не читались при подготовке документов.
Подробности подтверждённого восстановления и санитарной обработки: [техническая сверка](../artifacts/repository-audits/2026-10-06-vps-reconciliation.md).

## Контракт manifest для Task7

[release-manifest.schema.json](release-manifest.schema.json) использует [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core).
`schemaVersion: 1` — версия нашего контракта. `recordedAt` — фактическое время первоначальной подготовки записи в UTC (`Z`); `observedOn` — дата исходного снимка.
Даты в описании указаны по Москве (UTC+03:00). Записанное `2026-10-06T21:59:10Z` соответствует 7 октября, 00:59:10 по Москве; timestamp сохранён при исправлении метаданных.

| Поля | Значение / проверка |
| --- | --- |
| `recordKind: observed` | Только `observed-unreconciled`; `releaseProof` запрещён |
| `recordKind: release` | Только `verified`; обязательный `releaseProof` каждого компонента; пустые `limitations` |
| `sources[].kind: git` | Полный 40-hex commit, repository, path и provenance; verified требует `release-chain` |
| `sources[].kind: vendor` | Image name и 64-hex локальный image ID; source commit не придумывается |
| `sources[].kind: unknown` | Обязательные reason/provenance; запрещено в verified release |
| `artifacts[]` | SHA256, path, kind, `sourceId`, provenance для source/config/site/build/image bytes |
| `originHttp`, `publicHttp` | URL без userinfo/query/fragment, HTTP status, body SHA256; assets/auth loader — опциональны |
| `runtime` | Наблюдаемые container/image/Compose/network metadata; только code/config/site mounts |
| `releaseProof.build` | source IDs, mode, command, tool runtime, timestamp, полный список output hashes |
| `releaseProof.deploy` | target, operation ID, timestamp и deployed artifact hashes |
| `releaseProof.served` | timestamp, runtime image ID или artifact/HTTP proof; site/API/gateway обязательно имеют origin и public HTTP |

Builder получает точные sources/lockfiles из чистого checkout и создаёт immutable artifact со всеми output hashes.
Deployer получает этот artifact и ожидаемый environment; после deployment он сравнивает целевые bytes и выполняет origin/public проверки.
Для vendor component режим `vendor-image` фиксирует неизменяемый image ID; для production static допустим `static-copy`.
URL origin — адрес измеренного upstream, public URL — соответствующий публичный маршрут. `matchesMountedBytes: true` обязателен для release HTTP receipts.

Task7 обязан дополнительно проверять семантику, которую обычная JSON Schema не выражает:

1. Уникальные component/source IDs и существующие `sourceId`, `sourceIds`, cross-manifest `componentIds`.
2. Exact source commits, paths и dependency inputs действительно использованы build; vendor image ID соответствует inspected runtime.
3. Build outputs → deployed artifacts → served artifacts/response bytes соответствуют одному выпуску; сравнивать hashes, не имена файлов.
4. Каждый output включён в deployment inventory; HTTP proof относится к этому component/environment и измерен после deployment.
5. Timestamp order и фактическая команда/operation receipt; metadata нельзя заполнять задним числом по совпадающим файлам.
6. Config hashes совпадают с активной конфигурацией; auth-loader версия/route coverage согласованы между всеми страницами.

Структурная валидность JSON не является проверкой настоящего выпуска. `verified` присваивается только после успешной полной цепочки.
Неизвестное поле запрещено на каждом объектном уровне. Запрещены Env values, secrets, passwords, tokens, user data, uploads и connection strings.
Не включать credential/secret paths или содержимое application settings. Path/URL constraints дополняют allowlist, но не заменяют санитарный просмотр строк.

Одноразовая проверка Task3 использует уже установленный `apps/api/node_modules/ajv/dist/2020.js` (Ajv 8.20.0) и `ajv-formats` 3.0.1.
Это принадлежность API install, а не объявленная root dependency будущего release tooling.
Если Task7 делает validator постоянным инструментом, он должен объявить собственную dependency ownership и locked install.
