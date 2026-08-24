# Run the fixture audience parser canary

## Goal

Prove the complete audience-ingestion path without contacting a non-loopback source.
This runbook creates local infrastructure, imports the selected OKVED fixture, performs dry-run
discovery, replays twice, publishes fixture finance, reconciles, and inspects lineage.

This is a fixture acceptance run, not a live canary.

## Prerequisites

- Node.js 24 and npm
- Docker with Compose
- Chromium installed through Playwright
- Loopback ports 5432, 9000, and 9001, or the documented 5433 PostgreSQL override
- The repository root as the current directory

Use only the local example credentials from `.env.example`:

```bash
cp .env.example .env
set -a
. ./.env
set +a
```

Expected: `APP_MODE=fixture`, `LIST_ORG_LIVE_ENABLED=false`, and all source endpoints use
`127.0.0.1`. Do not add live URLs, cookies, tokens, IP controls, or proxies.

## Fast acceptance

Use this path for a repeatable release decision:

```bash
docker compose up -d postgres minio
npm ci
npx playwright install chromium
npm run migrate:up
TEST_DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL" npm test -- test/e2e/audience-parser.e2e.test.ts
```

Expected: nine tests pass. The test uses a temporary PostgreSQL database and MinIO bucket,
then removes both. It asserts 4 occurrences, 3 unique records, 1 duplicate, 3 companies,
3 company/OKVED relations, 0 rejected records, 0 non-terminal tasks, 0 unexplained fetches,
and exact values `125000.00`, `150000.00`, and `0.00`.

## Manual operator walkthrough

### 1. Start services and migrate

```bash
docker compose up -d postgres minio
docker compose ps
npm ci
npx playwright install chromium
npm run migrate:up
```

Expected: `postgres` and `minio` are healthy. Migration `001_audience_core` is applied.

### 2. Create the raw bucket and release selected OKVED 43.11

Upload the exact selected-OKVED fixture to MinIO:

```bash
node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
try {
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
} catch {
  await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
}
await client.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: "raw/okved-csv/selected-okveds.csv",
  Body: await readFile("data/okved/selected-okveds.csv"),
  ContentType: "text/csv; charset=utf-8",
}));
client.destroy();
console.log(JSON.stringify({ uploaded: "raw/okved-csv/selected-okveds.csv" }));
NODE
```

Record an idempotent fixture dataset release with the raw checksum:

```bash
OKVED_CHECKSUM="$(shasum -a 256 data/okved/selected-okveds.csv | awk '{print $1}')"
docker compose exec -T postgres psql \
  -v ON_ERROR_STOP=1 \
  -v checksum="$OKVED_CHECKSUM" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" <<'SQL'
WITH new_run AS (
  INSERT INTO audience.crawl_runs (
    id, scope_json, fixture_version, parser_version, status, terminal_reason, completed_at
  )
  SELECT gen_random_uuid(), '{}'::jsonb, 'selected-okveds-fixture/1.0.0',
         'selected-okveds/1.0.0', 'succeeded', 'fixture_release', now()
  WHERE NOT EXISTS (
    SELECT 1 FROM audience.dataset_releases
    WHERE source_kind = 'okved-csv'
      AND source_version = 'ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)'
  )
  RETURNING id
), new_fetch AS (
  INSERT INTO audience.source_fetches (
    id, run_id, source_kind, source_record_key, object_key, checksum_sha256,
    mime_type, final_url, navigation_status, captured_at, parser_version
  )
  SELECT gen_random_uuid(), id, 'okved-csv', 'selected-okveds:2025',
         'raw/okved-csv/selected-okveds.csv', :'checksum', 'text/csv',
         'http://127.0.0.1:9000/okved-raw/raw/okved-csv/selected-okveds.csv',
         200, now(), 'selected-okveds/1.0.0'
  FROM new_run
  RETURNING id
)
INSERT INTO audience.dataset_releases (
  id, source_kind, source_version, source_fetch_id, published_at
)
SELECT gen_random_uuid(), 'okved-csv', 'ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)', id, now()
FROM new_fetch;
SQL
```

Import through the application use case:

```bash
npx tsx -e 'import { readFile } from "node:fs/promises"; import { importSelectedOkveds } from "./src/modules/audience/application/import-selected-okveds.ts"; import { PostgresOkvedRepository } from "./src/modules/audience/infrastructure/postgres/okved-repository.ts"; import { PostgresDatabase } from "./src/shared/postgres/database.ts"; void (async () => { const db = new PostgresDatabase(process.env.DATABASE_URL); try { const release = await db.query("SELECT id FROM audience.dataset_releases WHERE source_kind = $1 AND source_version = $2", ["okved-csv", "ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)"]); const imported = await importSelectedOkveds(await readFile("data/okved/selected-okveds.csv", "utf8"), new PostgresOkvedRepository(db), release.rows[0].id); console.log(JSON.stringify({ imported })); } finally { await db.close(); } })();'
```

Expected: `{"imported":1}`. Repeating the release and import is safe.

### 3. Run browser discovery in dry-run mode

```bash
npm run --silent audience -- fixture-discover \
  --okved 43.11 \
  --year 2025 \
  --max-pages 2 \
  --max-companies 50 \
  --dry-run | tee /tmp/okved-fixture-discovery.json

RUN_ID="$(node -e 'const fs=require("node:fs"); const lines=fs.readFileSync("/tmp/okved-fixture-discovery.json","utf8").trim().split("\n"); process.stdout.write(JSON.parse(lines.at(-1)).result.runId)')"
printf '%s\n' "$RUN_ID"
```

Expected JSON: `status` is `succeeded`, `reason` is `terminal_marker`,
`discoveredCompanies` is 3, `publishedCompanies` is 0, and `rawObjects` is 6.

Confirm that dry-run did not leak into domain or evidence tables:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  (SELECT count(*) FROM audience.companies) AS companies,
  (SELECT count(*) FROM audience.company_okveds) AS company_okveds,
  (SELECT count(*) FROM audience.run_company_matches WHERE run_id = '$RUN_ID') AS run_matches,
  (SELECT count(*) FROM audience.organization_evidence) AS organization_evidence,
  (SELECT count(*) FROM audience.financial_evidence) AS financial_evidence,
  (SELECT count(*) FROM audience.financial_observations) AS financial_observations;
"
```

Expected: all six counts are 0.

### 4. Inspect raw artifacts

```bash
docker compose exec -T minio mc alias set local \
  http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
docker compose exec -T minio mc ls --recursive "local/$S3_BUCKET"

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT source_kind, source_record_key, object_key, checksum_sha256, final_url
FROM audience.source_fetches
WHERE run_id = '$RUN_ID'
ORDER BY created_at, id;
"
```

Expected: six List-Org manifests exist. Every URL begins with `http://127.0.0.1:` and every
checksum is 64 lowercase hexadecimal characters. The repeated source record remains visible.

### 5. Replay twice

Start the fixture worker in a second terminal with the same exported `.env`:

```bash
npm run worker
```

Expected: `{"ok":true,"status":"ready"}`. Keep it running until both replays finish.

In the operator terminal, enqueue the first replay and wait for its audited task:

```bash
npm run --silent audience -- replay-write --run-id "$RUN_ID"
until [ "$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT status FROM audience.crawl_tasks WHERE run_id = '$RUN_ID' AND task_kind = 'replay_write' ORDER BY created_at DESC LIMIT 1")" = "succeeded" ]; do sleep 1; done
```

Enqueue the same run again and wait for two successful replay tasks:

```bash
npm run --silent audience -- replay-write --run-id "$RUN_ID"
until [ "$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM audience.crawl_tasks WHERE run_id = '$RUN_ID' AND task_kind = 'replay_write' AND status = 'succeeded')" = "2" ]; do sleep 1; done
```

Expected after both deliveries: three companies, three `(company_inn, okved_code)` relations,
three run matches, and three organization evidence rows. Stop the worker with `Ctrl-C`.

### 6. Publish fixture finance and reconcile

```bash
npm run --silent audience -- fixture-finance --run-id "$RUN_ID" --year 2025
npm run --silent audience -- reconcile --run-id "$RUN_ID" | tee /tmp/okved-reconciliation.json
```

Expected reconciliation fields:

```json
{
  "discovery": {
    "occurrences": 4,
    "uniqueSourceRecords": 3,
    "acceptedCompanies": 3,
    "duplicates": 1,
    "rejected": 0
  },
  "tasks": { "nonTerminal": 0 },
  "financial": { "revenue": 1, "income": 1, "expenses": 1 },
  "unexplainedSourceFetches": 0,
  "consistent": true
}
```

### 7. Inspect database lineage

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT observation.company_inn, observation.report_year,
       observation.revenue, observation.income, observation.expenses,
       revenue_raw.checksum_sha256 AS revenue_checksum,
       income_raw.checksum_sha256 AS income_checksum,
       expenses_raw.checksum_sha256 AS expenses_checksum
FROM audience.financial_observations observation
JOIN audience.financial_evidence revenue_evidence ON revenue_evidence.id = observation.revenue_evidence_id
JOIN audience.source_fetches revenue_raw ON revenue_raw.id = revenue_evidence.source_fetch_id
JOIN audience.financial_evidence income_evidence ON income_evidence.id = observation.income_evidence_id
JOIN audience.source_fetches income_raw ON income_raw.id = income_evidence.source_fetch_id
JOIN audience.financial_evidence expenses_evidence ON expenses_evidence.id = observation.expenses_evidence_id
JOIN audience.source_fetches expenses_raw ON expenses_raw.id = expenses_evidence.source_fetch_id
WHERE observation.company_inn = '7707083893' AND observation.report_year = 2025;
"
```

Expected: revenue `125000.00`, income `150000.00`, expenses `0.00`, and three non-empty checksums.

## Cleanup

Stop services without deleting data:

```bash
docker compose down
```

For a destructive clean reset, resolve the exact project and volumes first:

```bash
docker compose ls
docker volume ls --filter label=com.docker.compose.project=okved-parser
docker compose config --volumes
```

Proceed only when the output names this worktree project and its `postgres_data` and
`minio_data` volumes. Then remove only that scoped Compose project:

```bash
docker compose -p okved-parser down -v
```

This does not authorize stopping or deleting any unrelated native PostgreSQL service.

## Troubleshooting

### PostgreSQL port 5432 is already in use

Symptom: Compose reports `Bind for 127.0.0.1:5432 failed: port is already allocated`.

Solution: leave the other PostgreSQL process untouched. Create an ignored temporary overlay:

```bash
mkdir -p .superpowers
cat > .superpowers/postgres-5433.compose.yaml <<'YAML'
services:
  postgres:
    ports: !override
      - "127.0.0.1:5433:5432"
YAML

export DATABASE_URL='postgresql://okved:okved-local-password@127.0.0.1:5433/okved'
export TEST_DATABASE_ADMIN_URL='postgresql://okved:okved-local-password@127.0.0.1:5433/postgres'
docker compose -f compose.yaml -f .superpowers/postgres-5433.compose.yaml up -d postgres minio
```

Use both `-f` arguments for later Compose startup, shutdown, and volume cleanup commands.
Do not commit the overlay.

### Chromium executable is missing

Symptom: Playwright reports that the browser executable does not exist.

Solution:

```bash
npx playwright install chromium
```

### Selected OKVED fixture must be imported

Symptom: discovery returns `selected OKVED fixture must be imported before discovery`.

Solution: repeat step 2 and confirm the import prints `{"imported":1}`.

### MinIO bucket does not exist

Symptom: raw persistence returns `NoSuchBucket`.

Solution: repeat the bucket-upload command in step 2 before discovery.

### A run is blocked

Symptom: status is `blocked` with `captcha`, `http_403`, `soft_block`, `policy_block`,
or `contract_drift`.

Solution: preserve raw and database evidence, stop processing, and review the source policy.
Never resume a blocked run. Never rotate an IP or add a proxy. Create a new run only after the
cause is resolved within the fixture policy.

### Reconciliation fails

Symptom: the public CLI returns `{"ok":false,"error":"operation failed"}`, or the acceptance
test reports `reconciliation failed` and names an invariant.

Solution: do not mark the run successful. Inspect the named task, occurrence, evidence, raw,
projection, or unexplained-fetch count. Correct the fixture pipeline and create a fresh run when
the existing run is blocked.
