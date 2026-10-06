# Forum: ревью кода и сверка репозиториев

Срез: 6 октября 2026 года, около 20:50 МСК. Репозиторий: `mcvvvnukova-bit/forum`.

**Вывод: механическое объединение веток и повторное развёртывание пока не готовы.** Найдены один дефект высокой важности и пять замечаний средней важности, включая известную зависимость публикаций. GitHub получен через fetch; исходный код, локальные ветки, серверные приложения и данные не изменялись. Этот отчёт и связанный план — новые документы.

## Замечания по коду

### F1. HIGH: откат лендинга не восстанавливает работающий шлюз

PR [№4](https://github.com/mcvvvnukova-bit/forum/pull/4), `deployment/dev-landing/deploy.sh:103` и `:111`.

При ошибке после пересоздания `dev_landing_auth` скрипт удаляет каталоги сайта и шлюза, восстанавливает их из backup и пересоздаёт только Caddy. Работающий шлюз сохраняет новое загруженное Python-приложение и bind mounts старых удалённых каталогов. Восстановленные файлы на диске не доказывают восстановление обслуживаемого сайта. Изменение пароля через `--set-password` также не входит в backup/rollback.

Подтверждено точным исходником: bind mounts объявлены на строках 225–226, gateway пересоздаётся на 263, rollback пересоздаёт только Caddy на 111. Тесты gateway проверяют HTTP-поведение, но не эту последовательность деплоя.

Исправление: откатывать gateway и затронутые secrets к прежнему состоянию, учитывать первое развёртывание; проверять прежний сайт и вход через HTTP после принудительной ошибки поздней проверки. Не запускать старый full-site deploy поверх сайта, собранного из новых UI-пакетов.

### F2. MEDIUM: повторная настройка роли расширяет права runtime

PR [№5](https://github.com/mcvvvnukova-bit/forum/pull/5), `deployment/forum-db/configure_forum_app_role.sh:124`.

Скрипт выдаёт SELECT/INSERT/UPDATE/DELETE на все таблицы `public` и такие же default privileges будущим таблицам. После миграции 003 это разрешает runtime удалять `persons`, изменять и удалять аудит/outbox, менять журнал миграций. Контракт `deployment/forum-api/grant-runtime.sql` даёт более узкие права, а `deployment/forum-db/tests/public-schema.sql` прямо запрещает DELETE для `persons`. Последующее исполнение узкого grant-файла не отзывает уже выданные права.

Исправление: отделить legacy bootstrap от consolidated schema; проверить версию до изменений, явно отозвать лишние текущие/default grants и проверить положительные и отрицательные ACL после повторного запуска. На действующей БД это ревью не выполняло SQL.

### F3. MEDIUM: настройка pgAdmin обращается к удалённому контейнеру

PR №5, `deployment/forum-db/configure_forum_app_role.sh:281`.

`pgadmin_id` получен на строке 46. На 256 Compose пересоздаёт контейнер, но переменная не обновляется. У существующего пользователя последующая установка `forum_app.pgpass` вызывает inspect прежнего ID и завершает настройку уже после изменения прав/HBA и пересоздания pgAdmin.

Исправление: получать ID после recreate/readiness; проверить проход всей настройки с существующим пользователем и изменившимся ID. Это подтверждение по потоку исходника, без вмешательства в сервер.

### F4. MEDIUM: браузерная приёмка API зависит от отсутствующего frontend

PR №5, `apps/api/test/browser-smoke.mjs:8`.

Тест загружает Playwright/Vite через `deployment/dev-landing/package.json` и запускает `vite.landing.config.ts`/`landing.html`. В точном Git-дереве PR №5 каталога `deployment/dev-landing` нет. Проверка в временном экспорте head воспроизвела `Cannot find module '@playwright/test'` до обращения к БД.

Исправление: объявить и включить зависимый frontend в проверяемую интеграционную базу либо сделать API fixture самостоятельным. Проверять браузерную приёмку из чистого checkout без помощи файлов основной рабочей папки.

### F5. MEDIUM: форма входа может оставить страницу аудитории в состоянии 404

PR [№13](https://github.com/mcvvvnukova-bit/forum/pull/13), `deployment/public-auth/src/PublicAuth.tsx:88`; PR [№11](https://github.com/mcvvvnukova-bit/forum/pull/11), `deployment/audience-pages/src/App.tsx:25` и `:35`.

На `/work/` пользователь открывает «Войти», пока запрос сессии страницы ещё ожидает ответа. PublicAuth меняет pathname на `/login`; завершение запроса с 401 вызывает render App, который читает новый pathname и показывает «Страница не найдена». Закрытие формы возвращает URL через history.back, но App не подписан на popstate и остаётся в 404.

Временный составной Vitest с реальными компонентами воспроизвёл эту последовательность. Родительское ревью проверило источник pushState, render и асинхронного setLoading. Отдельные тесты формы используют искусственные ссылки и не включают реальный App аудитории.

Исправление: общий контракт маршрутизации и фонового маршрута модального окна; тест session request → открытие формы → 401 → закрытие/Back с сохранением исходной страницы.

### F6. MEDIUM: последующая публикация страницы удаляет общую форму входа

PR №13, `deployment/public-auth/scripts/deploy.py:33`; PR [№12](https://github.com/mcvvvnukova-bit/forum/pull/12), `deployment/primer-home/scripts/deploy-dev-home.py:119`; PR №11, `deployment/audience-pages/scripts/deploy.py:41`.

Auth deploy добавляет loader только в существующий на тот момент HTML. Следующая публикация homepage либо audience заменяет HTML собственной сборкой без loader. `--preserve-homepage` защищает только главную. Проверка homepage принимает равенство собственной сборке и эту потерю не замечает.

Временные каталоги и реальные функции deploy независимо подтвердили: auth → home удаляет loader главной; auth → audience удаляет loader `/work/`, сохраняя его на главной. Это известная зависимость: body PR №13 требует ручного повторного включения auth при следующих публикациях. Недостаёт автоматического контракта совместной поставки.

Исправление: единый составной артефакт публичного сайта или обязательная операция композиции каждого релиза; проверять общую форму на всех страницах после любой публикации и отката.

## Подтверждённое состояние Git

- GitHub `main`: `19120a8fb11b3251ea636d122ba09bf93af4e87d`, последний коммит 21.08.2026.
- Локальный `main`: `cb0fe3b`, опережает `origin/main` на 21 коммит. Текущий checkout: `codex/dev-landing-cal-diy-embed`, `0dd7dd2eb5f1a6a7fa5a7d3e8991072934d39692`, опережает `origin/main` на 25 коммитов.
- Проверены все 19 локальных веток: коммитов, отсутствующих во всей fetched-истории `origin`, не найдено. Это не означает принятие работы в main.
- GitHub: 14 веток — main и 13 веток открытых PR. Из 13 PR одиннадцать draft; №11 и №16 готовы к ревью. CLEAN в GitHub означает отсутствие текущего merge conflict, а не совместимость поведения.
- В текущем HEAD 222 tracked-файла, 18 изменённых tracked-файлов и 880 untracked-записей. 224 untracked-пути встречаются на remote tips; 221 совпадает с remote blob, три отличаются: AGENTS.md и две PNG-копии логотипа. 656 записей не встречаются на remote tips, 535 из них находятся в artifacts.
- Эти 880 записей не являются числом физических файлов: вложенные репозитории представлены одной записью каждый. Полное резервирование должно учитывать их отдельно, а также ignored-файлы.
- Все 30 файлов untracked `apps/api/` уже сохранены в ветке PR №5. Нельзя считать весь apps неопубликованным кодом.
- В origin/main нет root README, package/workspace manifest и действующего приложения API. По всем 14 remote refs найдено 838 уникальных путей, ни одного `.github/workflows`.
- GitHub Actions workflows: 0; checks у всех 13 открытых PR: 0. `main` protected=false. Rulesets API вернул 403 с требованием GitHub Pro для приватного репозитория; доступность обязательных server-side merge gates сейчас ограничена тарифом.

| PR | Head SHA | Commits / files от main | Назначение / решение для плана |
|---|---|---|---|
| [3](https://github.com/mcvvvnukova-bit/forum/pull/3) | `4c76633c0a424e94752bc5fbdfcb832b6a13449b` | 5 / 2 | Правила разработки; сохранить актуальную редакцию AGENTS |
| [4](https://github.com/mcvvvnukova-bit/forum/pull/4) | `8833c8604e96a437ff4a8b8294e038567544ebec` | 30 / 150 | Legacy лендинг и gateway; устранить F1, выделить действующие части |
| [5](https://github.com/mcvvvnukova-bit/forum/pull/5) | `5084b30b0be5c3939870be8fdadd9643cd9af0a0` | 1 / 60 | API/DB; устранить F2–F4 |
| [6](https://github.com/mcvvvnukova-bit/forum/pull/6) | `a75924cb7b715f9bd0d958bc812438389d090094` | 5 / 41 | Инфраструктура; сверить с VPS, архивы не запускать |
| [7](https://github.com/mcvvvnukova-bit/forum/pull/7) | `a07a9a0d475d06e391a2c635b572237f33b76a71` | 31 / 24 | pgAdmin baseline; учитывать последующие изменения №16 |
| [8](https://github.com/mcvvvnukova-bit/forum/pull/8) | `465496e308f53821a0969f063290e61dc38936dc` | 1 / 8 | Шаблоны писем; отдельная сохранённая область |
| [9](https://github.com/mcvvvnukova-bit/forum/pull/9) | `8b8d14886fb7709938ad46976e21a1c1206c9466` | 1 / 23 | Maintenance tools; в body нет OP#-кода, нужна проверенная задача |
| [10](https://github.com/mcvvvnukova-bit/forum/pull/10) | `00a47c2acdfd1e6e3f92ce4fb00b1046a40f3b45` | 28 / 178 | Выборочно архив: включает также старые варианты активного лендинга |
| [11](https://github.com/mcvvvnukova-bit/forum/pull/11) | `2b85a4162bbd1a64703dab6da6ab787e469516fb` | 26 / 145 | Аудитории; совместная проверка с №13 |
| [12](https://github.com/mcvvvnukova-bit/forum/pull/12) | `b332db9dc9666c2110403e447d2b46c30675a5dc` | 18 / 99 | Primer главная; единая композиция релиза |
| [13](https://github.com/mcvvvnukova-bit/forum/pull/13) | `e9b9331d32c2a11fe7da6391fe01b6cfba8f9f60` | 14 / 59 | Auth и DNS override; устранить F5–F6 |
| [14](https://github.com/mcvvvnukova-bit/forum/pull/14) | `acd3583c369752107b158b317545e17c966588e9` | 11 / 24 | Fixture профиля; не считать реальным OAuth/userinfo/persistence |
| [16](https://github.com/mcvvvnukova-bit/forum/pull/16) | `9e4666fbd5cddef9d3d4a6b24c286f7a75557ac6` | 1 / 4 | Новые подключения pgAdmin; интегрировать поверх принятого baseline №7 |

Merge-base всех перечисленных PR — полный SHA origin/main выше. Полное включение head одного PR в другой не найдено; общая история и совпадающие файлы всё равно требуют проверки перекрытий. В частности, №10 относительно №4 содержит старые PNG вместо новых WEBP, поэтому его название «архив» не гарантирует изоляцию runtime-изменений.

## VPS, OpenProject и вложенные проекты

Две SSH-попытки к настроенному `forum-prod` (`84.47.165.130:15833`, testing-user) завершились connect timeout до аутентификации. Список контейнеров, deployed bytes, volumes, image digests и серверные Git checkout сейчас не получены. HTTPS dev вернул 200, OpenProject API — ожидаемый 401 без авторизации и успешные ответы под Кузьмина. Ответ сайта не доказывает состояние контейнеров или завершение входа.

Подтверждена API/browser identity: id=8, login=kuzmina, «Ассистент Кузьмина». Живые задачи: [PROJ-149](https://roadmap.astforum.ru/work_packages/PROJ-149) — общая инфраструктура; [PROJ-148](https://roadmap.astforum.ru/work_packages/PROJ-148) — интеграция GitHub; [PROJ-35](https://roadmap.astforum.ru/work_packages/PROJ-35) — регистрация физлица через Сбер ID; [PROJ-31](https://roadmap.astforum.ru/work_packages/PROJ-31) — переход к регистрации и входу. Во вкладке GitHub PROJ-149 видны №6 и №7. Остальные ссылки PR↔задача не перепроверены по вкладкам и не объявляются подтверждёнными.

`cal-diy-astforum/` — чистый отдельный репозиторий с собственными origin/upstream. `local-previews/primer-home/` — отдельный чистый Git без remote, его история требует самостоятельного сохранения перед удалением; версия приложения уже представлена в PR №12, но не все файлы совпадают.

## Покрытие и ограничения

Проведены инвентаризация всех открытых PR/веток, проверка происхождения файлов, ревью backend PR №5 и frontend/release seams №4, №11–14. №3, №6–10, №16 проверены по назначению, перекрытиям и выбранной конфигурации; это не построчное ревью всего их содержимого.

На временных экспортах: API build/typecheck успешны, 15 DB-free tests прошли; 12 существующих deployment tests прошли. Составные Python/Vitest probes подтвердили F5–F6. DB integration, реальный OAuth, полноценный browser E2E и live rollback не выполнялись. Пройденные отдельные suites не отменяют межпакетные ошибки.

GitNexus status: up-to-date на 0dd7dd2, совпадают все 741 covered-файл. MCP выполнены query/context/trace/impact/detect_changes; local diff затрагивает gateway, booking и документы. Индекс представляет dirty workspace, а не каждый PR head. Taint/PDG layer отсутствует; занятую БД индекса не пересоздавали. Поэтому это source-backed ревью с ограниченным графовым контекстом, без полного graph/taint-покрытия всех веток.

Проверка безопасности охватила IAM, runtime grants, cookies/proxy и deployment rollback. Проверка типов, ошибок, тестов, архитектурных границ и документации выполнена в выбранных областях; измерений производительности и полного dependency/security audit не было.

## Уточнения владельца от 6 октября

Парсер организаций/финансов по ОКВЭД из закрытого PR №2 исключён из системы: этот функционал не нужен и не включается в интеграцию веток или будущие планы. Исторические документы о нём не являются действующим заданием. Общий справочник ОКВЭД рассматривается отдельно.

В `docs/` должны остаться только планы технической реализации. Всё продуктовое описание хранится в Outline `docs.astforum.ru`; его локальные источники удаляются из Git после сверки и проверки сохранности нужного содержания в Outline. Этот технический аудит перенесён в `artifacts/repository-audits/`; массовый перенос продуктовых документов ещё не выполнен.

Полный порядок действий: [план наведения порядка](../../docs/plans/2026-10-06-001-refactor-forum-repository-order-plan.md).
