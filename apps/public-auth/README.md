# public-auth: технический указатель

Продуктовые требования: [Outline](https://docs.astforum.ru/doc/pub0202-perehod-k-registracii-i-vhodu-dC0gjF8wo8). Исторические решения/оригиналы связаны в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

Компоненты и прежние unit-тесты перенесены в [`apps/web`](../web/README.md).
Из корня: `npm ci`, `npm run dev --workspace @astforum/web`,
`npm run typecheck --workspace @astforum/web`, `npm test --workspace @astforum/web`.
Один bootstrap/session/build обслуживает homepage, audience и login/register.

Прежний publisher в `scripts/deployment/public-auth` остаётся для regression-проверок
предыдущей композиции и запрещает изменения unified-target с `.web-release.json`.
Новая публикация и возврат: [release runbook](../../deployment/release.md).
