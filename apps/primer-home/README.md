# primer-home runtime

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

Локальный loopback: `http://127.0.0.1:5188/`. Корневой lockfile владеет dependency installation. CI проверяет требуемые workspace scripts; build не выполняет публикацию.

`npm run build:dev` задаёт существующие session/auth build variables. Publisher: [deploy-dev-home.py](../../scripts/deployment/primer-home/deploy-dev-home.py), проверки: `python3 -m unittest discover -s ../../scripts/deployment/primer-home -p 'test_*.py' -v`.

Композиция/navigation/auth-loader согласуются с остальными публичными владельцами через `npm run test:composition` из корня. Публикация, target, backup/rollback и served SHA проверяются по [release runbook](../../deployment/release.md); historical source evidence не подтверждает текущий VPS.
