# Техническая карта репозитория Forum

Работа по [PROJ-152](https://roadmap.astforum.ru/work_packages/190/activity) организована в `apps/`, `deployment/`, `scripts/` и `docs/plans/`. Продуктовые требования находятся в [Outline](https://docs.astforum.ru), исторические исходники — в [сохранённом индексе](https://docs.astforum.ru/doc/materialy-ishodnikov-repozitoriya-06102026-47OWJsSXqE). [Реестр миграции](artifacts/repository-audits/document-migration-manifest.json) связывает source SHA с точными оригиналами и проверенным повторным открытием.

## Владение исходниками

| Каталог | Назначение |
| --- | --- |
| `apps/` | API, legacy landing, Primer home, audience pages, public auth, profile fixture, dev gateway и прежний production static |
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

Один корневой lockfile владеет шестью npm workspaces. Команды отдельного приложения: `npm run <script> --workspace @astforum/<owner>`. `apps/dev-gateway` проверяется Python-тестами; `apps/web/production-static` не является npm package. Браузерная layout-проверка legacy находится в [tests/e2e](tests/e2e/legacy-landing-layout.mjs), CI — в [quality workflow](.github/workflows/quality.yml).

## Источники и выпуск

[Accepted source matrix](artifacts/repository-audits/accepted-source-matrix.json) хранит неизменяемые source pins и отдельные current candidate paths/hashes. [Task5 source parity](artifacts/repository-audits/task-5-source-parity.json) и [аудит6октября](artifacts/repository-audits/2026-10-06-forum-repository-audit.md) являются датированными наблюдениями. Их counts/served bytes не подтверждают текущую сборку или VPS.

[Окружения](deployment/environments.md) описывают наблюдённые границы, [порядок выпуска](deployment/release.md) — обязательные source/build/deploy/served receipts. Продуктовые документы и private delivery/access reports не хранятся в Git. [Правила работы](AGENTS.md) требуют отдельную ветку, проверки, commits/PR и проверенную связь OpenProject; текущая документация не разрешает deployment.
