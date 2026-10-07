# Техническая карта репозитория Forum

Наведение порядка выполняется по [PROJ-152](https://roadmap.astforum.ru/work_packages/PROJ-152) и [техническому плану](docs/plans/2026-10-06-001-refactor-forum-repository-order-plan.md). Продуктовые описания и требования находятся в [Outline](https://docs.astforum.ru).

## Исходное состояние на 6 октября 2026 года

Этот этап начинается с `origin/main` — `19120a8fb11b3251ea636d122ba09bf93af4e87d`. Принятая версия приложения ещё не собрана: исходники распределены по открытым PR, старым веткам и рабочим копиям.

[Матрица происхождения](artifacts/repository-audits/2026-10-06-source-inventory.json) фиксирует 19 ранее существовавших локальных веток, 8 рабочих копий, два самостоятельных вложенных репозитория и локальные изменения. Новая ветка выполнения `codex/PROJ-152-repository-order` учитывается отдельно. Все ветки и рабочие копии сохранены; приватная резервная копия с историей и ignored-файлами находится вне Git. В матрице нет содержимого секретов, патчей или продуктовых документов.

[Технический аудит](artifacts/repository-audits/2026-10-06-forum-repository-audit.md) содержит исходные замечания и ограничения. Его числа относятся к моменту аудита; свежие значения находятся в JSON. PR-кандидаты ещё требуют совместных проверок. Состояние действующих dev/production сборок и серверной конфигурации требует отдельной живой сверки.

## Назначение каталогов после выполнения плана

| Каталог | Назначение |
|---|---|
| `apps/` | Исходники приложений: API, общий web, шлюз dev и отдельный fixture профиля |
| `deployment/` | Конфигурация окружений, шаблоны поставки, manifests и инструкции эксплуатации |
| `scripts/` | Сценарии поставки, проверки и обслуживающие инструменты |
| `docs/plans/` | Только планы технической реализации; продуктовые источники — в Outline |
| `tests/` | Межкомпонентные и браузерные проверки |
| `artifacts/` | Разрешённые технические аудиты и доказательства релизов без секретов и персональных данных |

Это целевая карта, а не описание уже выполненного переноса. До объединения web отдельно сохраняются исходники homepage, audience и auth. Cal.diy имеет собственный репозиторий и цикл релиза. Исторические сценарии исключаются из активной сборки и поставки; материалы восстановления сохраняются в Git history и приватной копии.

Перенос продуктовых файлов из Git выполняется после проверки их сохранности в Outline. Отменённый парсер организаций и финансов по ОКВЭД из закрытого PR №2 исключён из принятой базы и дальнейшей разработки. Общий справочник ОКВЭД имеет отдельную границу.

Правила работы, учётная запись ассистента и обязательная связь коммитов/PR с OpenProject закреплены в [AGENTS.md](AGENTS.md).


## Workspace checks

Use Node 24.18.1 and `npm ci` at the repository root. One root lock owns all six explicit application workspaces; `npm run typecheck` and `npm run build` require every owner. Public integration runs with `npm run test:composition`, publishers with `npm run test:publishers`, and local mail resources with `npm run test:mail`. Individual app commands use `npm run <script> --workspace @astforum/<owner>`.

Accepted runtime source lives in `apps/`: API, legacy landing, Primer home, audience pages, public auth, profile fixture and Python dev gateway. `apps/web/production-static` is unchanged production source, not yet an npm package. Shared public navigation lives in `packages/public-navigation.ts`. Publishers are `scripts/deployment/<owner>`; local browser layout acceptance is `tests/e2e/legacy-landing-layout.mjs`. Infrastructure stays in `deployment/`; mail templates and the owned logo stay in `deployment/mail/templates/`. The source-path parity map is `artifacts/repository-audits/task-5-source-parity.json`.
