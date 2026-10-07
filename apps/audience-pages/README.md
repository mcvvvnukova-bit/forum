> Runtime ownership moved to [`apps/web`](../web/README.md). Use its single build and release contract; this index retains historical product links.

# audience-pages runtime

Продуктовые требования: [Outline](https://docs.astforum.ru). Исторические решения/оригиналы связаны в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

Из этого каталога, Node24.18.1:

```sh
npm ci --prefix ../..
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Локальный loopback: `http://127.0.0.1:5191/`. Корневой lockfile владеет dependency installation. CI проверяет требуемые workspace scripts; build не выполняет публикацию.

`node scripts/package-site.mjs` создаёт `dist/site` с customer/supplier/work/participate entrypoints и изолированными assets. Publisher: [deploy.py](../../scripts/deployment/audience-pages/deploy.py); его проверки запускаются `python3 -m unittest discover -s ../../scripts/deployment/audience-pages -p 'test_*.py' -v`.

Композиция/navigation/auth-loader согласуются с остальными публичными владельцами через `npm run test:composition` из корня. Публикация, target, backup/rollback и served SHA проверяются по [release runbook](../../deployment/release.md); historical source evidence не подтверждает текущий VPS.
