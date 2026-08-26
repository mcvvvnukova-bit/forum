# OKVED audience parser

Build and verify the first executable audience-ingestion slice entirely on your machine.
The default path uses fixture data, loopback HTTP, PostgreSQL, MinIO, and Chromium.
Fixture commands remain fixture-only. Arbitrary live collection is unsupported.

## Quick start

Prerequisites: Node.js 24, Docker with Compose, and free loopback ports 5432, 9000, and 9001.

```bash
cp .env.example .env
set -a
. ./.env
set +a

docker compose up -d postgres minio
docker compose ps
npm ci
npx playwright install chromium
npm run migrate:up
TEST_DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL" npm test -- test/e2e/audience-parser.e2e.test.ts
```

Expected result: both services report healthy and the fixture acceptance tests pass.
The test releases and imports `43.11`, runs Chromium discovery, persists raw bundles,
replays twice, publishes three financial metrics, and reconciles every count.

If port 5432 belongs to another PostgreSQL instance, do not stop it.
Use the isolated 5433 procedure in the [canary runbook](docs/runbooks/audience-parser-canary.md#postgresql-port-5432-is-already-in-use).
The reusable overlay is tracked at
`deployment/okved-parser/postgres-5433.compose.yaml`.

## What the fixture proves

- Four browser result occurrences produce three unique accepted companies and one retained duplicate.
- Dry-run writes audit and raw rows only. Domain and evidence tables remain empty until replay or finance.
- Two replay deliveries leave three companies and three company/OKVED relations.
- Revenue is `125000.00`, income is `150000.00`, and expenses is the observed value `0.00`.
- Every published organization and metric links to evidence and a raw checksum.
- Reconciliation rejects non-terminal tasks, unexplained records, incomplete evidence, invalid end reasons, and stale financial projections.
- Browser source traffic remains on a loopback origin.

## Commands

```bash
npm run build
npm test
npm run test:unit
npm run test:integration
npm run migrate:up
npm run migrate:down
```

The complete manual fixture flow is in the [audience parser canary runbook](docs/runbooks/audience-parser-canary.md).
Source activation rules are in the [audience ingestion source policy](docs/architecture/audience-ingestion-source-policy.md).

The repository records one exceptional, operator-controlled authorization for a
bounded pilot covering OKVED `43.11`, year 2025, and exactly 10 legal entities.
That authorization was consumed on 2026-08-26. The
[live-pilot runbook](docs/runbooks/okved-live-pilot.md) now documents the
historical command and the post-attempt audit only; it does not authorize a
rerun. Any new live attempt requires a new explicit authorization, reviewed
policy record, checksum, and one-shot scope.

## Current scope

Fixture mode is the default and the only currently authorized execution mode.
The consumed live exception linked above does not authorize another live run,
full 967-code traversal, export or hidden API use, proxy or IP rotation, or
arbitrary non-loopback source traffic. IP support remains a separate stage-2
plan.
