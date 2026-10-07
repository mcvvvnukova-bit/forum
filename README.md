# Техническая карта репозитория Forum

Работа по [PROJ-152](https://roadmap.astforum.ru/work_packages/190/activity) организована в `apps/`, `deployment/`, `scripts/` и `docs/plans/`. Продуктовые требования находятся в [Outline](https://docs.astforum.ru), исторические исходники — в [сохранённом индексе](https://docs.astforum.ru/doc/materialy-ishodnikov-repozitoriya-06102026-47OWJsSXqE). [Реестр миграции](artifacts/repository-audits/document-migration-manifest.json) связывает source SHA с точными оригиналами и проверенным повторным открытием.

## Владение исходниками

| Каталог | Назначение |
| --- | --- |
| `apps/` | API, legacy landing, единый public web (home/audience/auth), profile fixture, dev gateway и отдельный production static |
| `packages/` | Общая публичная навигация |
| `deployment/` | Конфигурация окружений и эксплуатационные инструкции |
| `scripts/` | Проверка, публикация и обслуживание по владельцам |
| `docs/plans/` | Markdown-планы технической реализации; дата и статус исторических планов указаны в каждом документе |
| `tests/` | Межкомпонентные и браузерные проверки |
| `artifacts/` | Разрешённые технические аудиты и доказательства согласно [retention policy](artifacts/README.md) |

Cal.diy имеет отдельный репозиторий и цикл выпуска. Прежний production static находится в `apps/web/production-static`; его наличие не означает публикацию нового Primer UI. Отменённый парсер организаций/финансов PR2 не входит в активные исходники; общий справочник ОКВЭД сохраняется отдельно в Outline.

## Установка и проверки

Из корня, Node24.18.1:

```sh
npm ci
npm run check:layout
npm run typecheck
npm run build
npm run test:composition
npm run test:publishers
npm run test:mail
```

Один корневой lockfile владеет четырьмя npm workspaces. Команды отдельного приложения: `npm run <script> --workspace @astforum/<owner>`. `apps/dev-gateway` проверяется Python-тестами; `apps/web/production-static` отдельно упаковывается владельцем `apps/web`. Браузерная layout-проверка legacy находится в [tests/e2e](tests/e2e/legacy-landing-layout.mjs), CI — в [quality workflow](.github/workflows/quality.yml).

## Источники и выпуск

[Accepted source matrix](artifacts/repository-audits/accepted-source-matrix.json) хранит неизменяемые source pins и отдельные current candidate paths/hashes. [Task7 current ownership](artifacts/repository-audits/task-7-source-ownership.json) отдельно фиксирует новые пути и hashes без переписывания прежних доказательств. [Task5 source parity](artifacts/repository-audits/task-5-source-parity.json) и [аудит6октября](artifacts/repository-audits/2026-10-06-forum-repository-audit.md) являются датированными наблюдениями. Их counts/served bytes не подтверждают текущую сборку или VPS.

[Окружения](deployment/environments.md) описывают наблюдённые границы, [порядок выпуска](deployment/release.md) — обязательные source/build/deploy/served receipts. Продуктовые документы и private delivery/access reports не хранятся в Git. [Правила работы](AGENTS.md) требуют отдельную ветку, проверки, commits/PR и проверенную связь OpenProject; текущая документация не разрешает deployment.

## Сверка 7 октября 2026

[Итоговый офлайн-аудит](artifacts/repository-audits/2026-10-07-final-reconciliation.md) и [измеренные runtime-цепочки](artifacts/repository-audits/2026-10-07-runtime-reconciliation.json) относятся к поставленному source SHA `e513872ce218357c77b1f7381c26e57c6de66e79`. Они отдельно фиксируют dev48 файлов, production7 неизменённых файлов, API image/payload/rollback, узкое исправление будущих DB-привилегий и действующие сервисы. Технические изменения этого аудита не объявляются новой поставкой приложений.

Текущие инвентарные manifests: [dev](artifacts/releases/2026-10-07-vps-dev-observed.json), [production](artifacts/releases/2026-10-07-vps-production-observed.json), [shared](artifacts/releases/2026-10-07-vps-shared-observed.json). Их консервативный статус `observed-unreconciled` сохраняет контракт schema v1: динамический HTTP не равен файлам исполняемого кода. Подтверждённые границы описаны отдельно; полный buildchain существующего custom-образа Cal.diy остаётся недоказанным. Точные [dev build](artifacts/releases/2026-10-07-dev-e513872-build.json) и [production build](artifacts/releases/2026-10-07-production-e513872-build.json) receipts по-прежнему имеют статус `build-only`.

[Реестр готовности к очистке](artifacts/repository-audits/2026-10-07-cleanup-eligibility.json) сохраняет SHA веток, уникальные commits, владельцев worktrees и незавершённые внешние этапы. Принятие main, финальный all-ref backup, синхронизация primary, перемещение самостоятельных nested repos и штатное архивирование ещё требуют завершения контроллером. Исторические manifests не переписаны.

`.graft/` — локальные данные независимого графа; `cal-diy-astforum` — исключённая из Forum область отдельного проекта, включая планируемую совместимую ссылку после его перемещения. Они исключены из Git и Forum GitNexus. Эти правила не останавливают существующие Graft readers и не обновляют индексы. Текущий held-индекс Forum устарел; завершающая переиндексация относится к принятой итоговой ветке и выполняется отдельно без перезапуска чужих процессов.
