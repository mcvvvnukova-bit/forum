# public-auth runtime

Продуктовые требования: [Outline](https://docs.astforum.ru/doc/pub0202-perehod-k-registracii-i-vhodu-dC0gjF8wo8). Исторические решения/оригиналы связаны в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

Из этого каталога, Node24.18.1:

```sh
npm ci --prefix ../..
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Локальный loopback: `http://127.0.0.1:5193/`. Корневой lockfile владеет dependency installation. CI проверяет требуемые workspace scripts; build не выполняет публикацию.

Общий component/loader имеет самостоятельные login/register entrypoints. `vite.config.ts` proxy обращается к session API; tests используют управляемый fetch. Vendor font license: `src/fonts/OFL.txt`. Publisher: [deploy.py](../../scripts/deployment/public-auth/deploy.py); `npm test` включает его проверки.

Композиция/navigation/auth-loader согласуются с остальными публичными владельцами через `npm run test:composition` из корня. Публикация, target, backup/rollback и served SHA проверяются по [release runbook](../../deployment/release.md); historical source evidence не подтверждает текущий VPS.
