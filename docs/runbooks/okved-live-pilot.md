# Audit the consumed OKVED 43.11 live pilot

## Status: authorization consumed

The one-shot authorization for this pilot was consumed on 2026-08-26. This
runbook is now an audit and historical command reference. It does not authorize
another live attempt.

Do not execute the public-source preflight or live command in this document. A
new live attempt requires new explicit authorization, a new reviewed policy
record and checksum, and a new one-shot scope. The durable guard rejects a
replacement for the consumed scope even when the prior run failed or remained
incomplete.

## Scope

The consumed exceptional workflow used the visible List-Org and FNS BFO browser
interfaces for the first 10 legal entities in the default List-Org order. Its
scope covered only OKVED `43.11` and financial outcomes for 2025.

Do not use this runbook for another OKVED, year, company limit, or run. Do not use
an export, API, hidden endpoint, report download, proxy, IP rotation, stealth mode,
browser script, or CAPTCHA solver. Do not replace a selected company because a
financial value is unavailable.

The historical fixed command identity was:

```text
audience live-pilot --okved 43.11 --year 2025 --max-companies 10
```

The historical command required all three gates:

```text
APP_MODE=live
LIST_ORG_LIVE_ENABLED=true
FNS_LIVE_ENABLED=true
```

These values document the consumed contract. They are not instructions to set
the gates or launch a browser now.

## Reviewed endpoints and origins

The consumed contract allowed only these owned local service endpoints:

- PostgreSQL: `127.0.0.1:5433`, database `okved`
- MinIO S3 API: `127.0.0.1:9000`, bucket `okved-raw`
- MinIO console: `127.0.0.1:9001`

It allowed only these public HTTPS source origins:

- `https://www.list-org.com/search`
- `https://bo.nalog.gov.ru/`
- `https://www.nalog.gov.ru/opendata/7707329152-revexp/`
- official `https://nalog.gov.ru`, `https://www.nalog.gov.ru`, and
  `https://file.nalog.ru` redirects required by the `revexp` release

Never connect the pilot to PostgreSQL 5432. Never stop a service bound to 5432.

## Failure and retry policy

The adapters may retry only a transient network error or source `5xx`. They make
at most two sequential retries with bounded delay. They do not blindly retry a
CAPTCHA, `403`, soft block, origin-policy failure, contract drift, invalid INN or
year, or malformed evidence.

Treat these states as terminal for the single attempt:

- `LIVE_PILOT_RECONCILED`: audit the successful run.
- `LIVE_PILOT_DISCOVERY_INCOMPLETE`: audit discovery-only evidence. Do not publish
  or replace companies.
- `blocked` or `failed`: audit all durable state. Do not create a replacement run.
- command exit code other than zero: recover the run ID from the owned database,
  audit the durable state, and do not run the command again.

The BFO adapter requires these exact visible labels:

- `Номер корректировки`
- `Дата представления отчетности`

Any changed or missing label is contract drift. Let the adapter fail closed. Do
not edit the contract or start another live attempt without new explicit approval.

## Historical CAPTCHA procedure

Do not close the browser or the command when the CLI prints the manual-verification
prompt. The adapter has already written `captcha_waiting` to the durable task
ledger.

1. Leave the same command, browser, and session open.
2. Tell the controller which source is waiting. Do not include challenge contents.
3. Let the user solve the visible challenge manually in that browser.
4. Wait for the controller's explicit `continue` or `abort` instruction.
5. Type only the full line `continue` after the controller authorizes it. The
   adapter revalidates the origin and page identity before it resumes.
6. Type `abort` only when the controller instructs it. EOF also aborts.

Do not type `continue` on the user's behalf before authorization. An abort,
closed browser, failed revalidation, returning CAPTCHA, `403`, soft block, or
contract drift ends the attempt. Do not run it again.

## 1. Historical owned-service preparation

The consumed attempt used every Compose command with the project name and the
tracked 5433 overlay. These non-public service commands remain suitable for
local fixture verification:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps
```

Expected: `postgres` and `minio` are healthy. PostgreSQL publishes only
`127.0.0.1:5433->5432/tcp`. MinIO publishes `127.0.0.1:9000` and
`127.0.0.1:9001`.

## 2. Historical migration preflight — preserve the pilot database

The attempt snapshot the owned database before its down/up migration cycle. The
following SQL records that historical procedure. Do not now run a migration
cycle against the preserved pilot database; use a fresh isolated test database
for code verification.

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -c "
SELECT
  CASE WHEN to_regclass('audience.crawl_runs') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.crawl_runs) END AS crawl_runs,
  CASE WHEN to_regclass('audience.crawl_tasks') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.crawl_tasks) END AS crawl_tasks,
  CASE WHEN to_regclass('audience.source_fetches') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.source_fetches) END AS source_fetches,
  CASE WHEN to_regclass('audience.companies') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.companies) END AS companies,
  CASE WHEN to_regclass('audience.company_okveds') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.company_okveds) END AS company_okveds,
  CASE WHEN to_regclass('audience.financial_observations') IS NULL THEN NULL
       ELSE (SELECT count(*) FROM audience.financial_observations) END AS financial_observations;
"
```

The historical migration commands used only the explicit 5433 URL:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: both commands exit 0. Migration `001_audience_core` is applied after the
cycle.

## 3. Run the non-live gate

Tests run in fixture mode against loopback PostgreSQL and MinIO only. They must
make no request to a public origin.

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
git diff --check
git status --short
```

Expected: the full suite and build exit 0. Only this runbook and the README are
changed before live access.

## 4. Historical strict preflight — do not execute public checks

This section records the preflight contract used by the consumed attempt. Do not
repeat its public `curl` checks without new explicit authorization.

Resolve the exact Compose containers and verify their ownership labels and host
ports:

```bash
POSTGRES_CONTAINER="$(docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps -q postgres)"
MINIO_CONTAINER="$(docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps -q minio)"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }} {{ index .Config.Labels "com.docker.compose.service" }}' "$POSTGRES_CONTAINER" "$MINIO_CONTAINER"
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml port postgres 5432
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml port minio 9000
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml port minio 9001
```

Expected labels: `okved-parser postgres` and `okved-parser minio`. Expected ports:
`127.0.0.1:5433`, `127.0.0.1:9000`, and `127.0.0.1:9001`. Abort if any value differs.

Connect through the exact external 5433 URL and verify the isolated database:

```bash
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved node --input-type=module -e '
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query("SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address");
console.log(JSON.stringify({ clientHost: client.connectionParameters.host, clientPort: client.connectionParameters.port, ...result.rows[0] }));
await client.end();
'
```

Expected: `clientHost` is `127.0.0.1`, `clientPort` is `5433`, `database` is
`okved`, and `role` is `okved`.

Verify the owned bucket without reading an object:

```bash
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret node --input-type=module -e '
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
console.log(`bucket ${process.env.S3_BUCKET} accessible`);
client.destroy();
'
```

Expected: `bucket okved-raw accessible`. Abort if the bucket is missing or access
fails.

Verify a headed browser without opening a public URL:

```bash
node --input-type=module -e '
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto("about:blank");
console.log("headed Chromium opened about:blank");
await new Promise((resolve) => setTimeout(resolve, 1500));
await browser.close();
'
```

Expected: the operator sees the Chromium window and the command exits 0. Abort if
the window is not visible.

Verify the exact fail-closed BFO labels in the reviewed contract:

```bash
rg -n 'readLabeledText\("Номер корректировки"\)|readLabeledText\("Дата представления отчетности"\)' src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source.ts
rg -n 'dt:text-is\("Номер корректировки"\)|dt:text-is\("Дата представления отчетности"\)' src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-contract.ts
```

Expected: both exact labels appear in the source and the strict projection
selectors. The live browser performs the visible-label verification. Do not issue
a separate BFO report collection during preflight.

Record only HTTPS status and redirect metadata for the approved public entry
points. Do not download response bodies and do not follow a redirect during this
check:

```bash
curl --proto '=https' --head --max-redirs 0 --silent --show-error https://www.list-org.com/search
curl --proto '=https' --head --max-redirs 0 --silent --show-error https://bo.nalog.gov.ru/
curl --proto '=https' --head --max-redirs 0 --silent --show-error https://www.nalog.gov.ru/opendata/7707329152-revexp/
```

Expected: each endpoint resolves over HTTPS. A redirect is acceptable only when
its `Location` remains on the approved source-owned HTTPS allowlist. Abort on HTTP
downgrade, unknown origin, `403`, or source unavailability. Do not add an alternate
URL.

## 5. Historical command identity — do not execute

The consumed attempt used the following exact command. Do not run it again. A
new explicit authorization must define a new one-shot scope before any future
live command may be considered:

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

The operator record captured the command exit code and safe terminal JSON. It
excluded raw page text, query URLs, stack traces, session data, and CAPTCHA
contents.

Historical audits identify the consumed run by the returned UUID or the owned
database. They do not start another command:

```bash
RUN_ID='<uuid-from-terminal-or-owned-database>'
```

## 6. Audit SQL state

Confirm the run identity and terminal state:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
SELECT id, status, terminal_reason, scope_json, fixture_version, parser_version,
       published_at IS NOT NULL AS published
FROM audience.crawl_runs
WHERE id = :'run_id'::uuid;
"
```

For a successful run, expect status `succeeded`, scope `43.11`/2025/10 with three
required metrics, source version `list-org-live/1.0.0`, and `published = true`.

Confirm task coverage and terminality:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
SELECT task_kind, status, count(*) AS tasks
FROM audience.crawl_tasks
WHERE run_id = :'run_id'::uuid
GROUP BY task_kind, status
ORDER BY task_kind, status;
SELECT count(*) FILTER (WHERE task_kind = 'live_finance' AND status = 'succeeded') AS successful_finance_tasks,
       count(*) FILTER (WHERE status IN ('pending', 'running')) AS non_terminal_tasks
FROM audience.crawl_tasks
WHERE run_id = :'run_id'::uuid;
"
```

For success, expect one successful `live_discovery`, one successful replay task,
10 successful `live_finance` tasks, and zero non-terminal tasks.

Confirm the ordered discovery selection and published relations:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
WITH discovery AS (
  SELECT result_json
  FROM audience.crawl_tasks
  WHERE run_id = :'run_id'::uuid AND task_kind = 'live_discovery'
), ordered AS (
  SELECT candidate.ordinality AS position, candidate.value->>'inn' AS inn
  FROM discovery
  CROSS JOIN LATERAL jsonb_array_elements(result_json->'candidates') WITH ORDINALITY AS candidate(value, ordinality)
)
SELECT position, inn FROM ordered ORDER BY position;
SELECT count(*) AS matches, count(DISTINCT match.company_inn) AS unique_companies,
       count(*) FILTER (WHERE match.matched_okved_code = '43.11' AND relation.okved_code = '43.11') AS okved_43_11_relations
FROM audience.run_company_matches match
JOIN audience.company_okveds relation
  ON relation.company_inn = match.company_inn
 AND relation.okved_code = match.matched_okved_code
WHERE match.run_id = :'run_id'::uuid;
"
```

For success, expect 10 ordered unique INNs, 10 matches, and 10 relations.

Confirm all 30 terminal outcomes and their visible values or `no_data` state:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
WITH finance AS (
  SELECT result_json->>'companyInn' AS inn, result_json->'metricOutcomes' AS outcomes
  FROM audience.crawl_tasks
  WHERE run_id = :'run_id'::uuid AND task_kind = 'live_finance'
), metrics AS (
  SELECT finance.inn, outcome.key AS metric, outcome.value AS outcome
  FROM finance CROSS JOIN LATERAL jsonb_each(finance.outcomes) AS outcome
)
SELECT metrics.inn, metrics.metric, metrics.outcome->>'outcome' AS source_attempt_status,
       CASE metrics.metric
         WHEN 'revenue' THEN observation.revenue::text
         WHEN 'income' THEN observation.income::text
         WHEN 'expenses' THEN observation.expenses::text
       END AS value
FROM metrics
LEFT JOIN audience.financial_observations observation
  ON observation.company_inn = metrics.inn AND observation.report_year = 2025
ORDER BY metrics.inn, metrics.metric;
WITH finance AS (
  SELECT result_json->>'companyInn' AS inn, result_json->'metricOutcomes' AS outcomes
  FROM audience.crawl_tasks
  WHERE run_id = :'run_id'::uuid AND task_kind = 'live_finance'
), metrics AS (
  SELECT finance.inn, outcome.key AS metric, outcome.value AS outcome
  FROM finance CROSS JOIN LATERAL jsonb_each(finance.outcomes) AS outcome
)
SELECT count(*) AS terminal_outcomes,
       count(DISTINCT inn) AS companies,
       count(*) FILTER (WHERE outcome->>'outcome' = 'published') AS published,
       count(*) FILTER (WHERE outcome->>'outcome' = 'no_data') AS no_data
FROM metrics;
"
```

For success, expect 30 outcomes across 10 companies. A published outcome has a
value. A `no_data` outcome has no value and carries a source attempt; it is not
zero.

Confirm exact value and `no_data` provenance, one `revexp` archive, and no
out-of-scope evidence:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
SELECT evidence.company_inn, evidence.report_year, evidence.metric, evidence.amount,
       raw.source_kind, raw.source_record_key, raw.object_key, raw.checksum_sha256,
       evidence.parser_version
FROM audience.financial_evidence evidence
JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
WHERE raw.run_id = :'run_id'::uuid
ORDER BY evidence.company_inn, evidence.metric;
WITH finance AS (
  SELECT outcome.value->'sourceAttempt' AS attempt
  FROM audience.crawl_tasks task
  CROSS JOIN LATERAL jsonb_each(task.result_json->'metricOutcomes') AS outcome
  WHERE task.run_id = :'run_id'::uuid AND task.task_kind = 'live_finance'
    AND outcome.value->>'outcome' = 'no_data'
), attempts AS (
  SELECT finance.attempt, raw.id AS raw_id
  FROM finance
  LEFT JOIN audience.source_fetches raw
    ON raw.run_id = :'run_id'::uuid
   AND raw.source_kind = finance.attempt->>'rawSourceKind'
   AND raw.source_record_key = finance.attempt->>'sourceRecordKey'
   AND raw.parser_version = finance.attempt->>'parserVersion'
   AND raw.captured_at = (finance.attempt->>'capturedAt')::timestamptz
   AND (raw.object_key = finance.attempt->>'rawFetchKey' OR raw.checksum_sha256 = finance.attempt->>'rawFetchKey')
)
SELECT count(*) AS no_data_attempts,
       count(raw_id) AS attempts_with_exact_raw,
       count(*) FILTER (WHERE raw_id IS NULL) AS missing_raw
FROM attempts;
SELECT source_kind, count(*) AS raw_objects
FROM audience.source_fetches
WHERE run_id = :'run_id'::uuid
GROUP BY source_kind ORDER BY source_kind;
SELECT
  count(*) FILTER (WHERE source_kind = 'fns-revexp' AND source_record_key = '7707329152-revexp:2025') AS revexp_archives,
  count(*) FILTER (WHERE source_kind = 'fns-bfo-live') AS bfo_objects,
  count(*) FILTER (WHERE source_kind = 'list-org-live') AS list_org_objects,
  count(*) FILTER (WHERE source_kind NOT IN ('list-org-live', 'fns-bfo-live', 'fns-revexp')) AS unexpected_source_kinds
FROM audience.source_fetches
WHERE run_id = :'run_id'::uuid;
SELECT
  count(*) FILTER (WHERE evidence.report_year <> 2025) AS out_of_scope_year,
  count(*) FILTER (WHERE evidence.metric = 'revenue' AND raw.source_kind <> 'fns-bfo-live') AS wrong_revenue_source,
  count(*) FILTER (WHERE evidence.metric IN ('income', 'expenses') AND raw.source_kind <> 'fns-revexp') AS wrong_revexp_source
FROM audience.financial_evidence evidence
JOIN audience.source_fetches raw ON raw.id = evidence.source_fetch_id
WHERE raw.run_id = :'run_id'::uuid;
"
```

For success, expect one `revexp` archive, 10 BFO objects, no unexpected source
kinds, and zero for every out-of-scope or wrong-source count. Every `no_data`
attempt must match exact raw evidence.

Use the original live command's terminal reconciliation projection together with
the SQL counts above. For success, require `consistent: true`, 10 companies, 10
relations, three financial counts of 10, zero non-terminal tasks, and zero
unexplained source fetches. Do not invoke a second collection to obtain another
report.

## 7. Audit immutable object bytes

Verify every manifest and retained artifact checksum. The audit prints only safe
source kinds, object keys, and checksums. It never prints DOM, screenshots, URLs,
headers, cookies, or session data.

```bash
RUN_ID="$RUN_ID" DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
await database.connect();
const result = await database.query("SELECT source_kind, source_record_key, object_key, checksum_sha256 FROM audience.source_fetches WHERE run_id = $1 ORDER BY source_kind, source_record_key, object_key", [process.env.RUN_ID]);
for (const row of result.rows) {
  const manifestResponse = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.object_key }));
  const manifestBytes = await manifestResponse.Body.transformToByteArray();
  if (sha256(manifestBytes) !== row.checksum_sha256) throw new Error(`manifest checksum mismatch: ${row.object_key}`);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  if (manifest.sourceKind !== row.source_kind || manifest.identity.runId !== process.env.RUN_ID) throw new Error(`manifest identity mismatch: ${row.object_key}`);
  const prefix = row.object_key.slice(0, -"/manifest.json".length);
  const artifacts = manifest.artifact === undefined
    ? [[manifest.artifacts.sanitizedDom.file, manifest.artifacts.sanitizedDom.checksumSha256], [manifest.artifacts.redactedScreenshot.file, manifest.artifacts.redactedScreenshot.checksumSha256]]
    : [[manifest.artifact.file, manifest.artifact.checksumSha256]];
  for (const [file, expected] of artifacts) {
    const response = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `${prefix}/${file}` }));
    const bytes = await response.Body.transformToByteArray();
    if (sha256(bytes) !== expected) throw new Error(`artifact checksum mismatch: ${prefix}/${file}`);
  }
  console.log(JSON.stringify({ sourceKind: row.source_kind, objectKey: row.object_key, checksumSha256: row.checksum_sha256 }));
}
console.log(JSON.stringify({ verifiedObjects: result.rowCount }));
await database.end();
s3.destroy();
NODE
```

Expected: every object verifies and the final count equals the run-scoped
`source_fetches` count.

## 8. Audit the sanitized evidence report

The immutable historical facts are recorded in
`docs/runbooks/evidence/okved-live-pilot-2026-08-26.md`. Do not rewrite that
report to describe later code hardening. When auditing it, expect only:

- live-attempt count `1`, command exit code, run ID, status, and terminal reason;
- CAPTCHA interaction status without challenge data;
- ordered INNs and each 2025 metric value or `no_data` outcome;
- source-attempt status and safe object keys/checksums;
- task, company, relation, outcome, raw-object, provenance, reconciliation, and
  immutable-verification counts;
- migration, non-live gate, preflight, and shutdown exit states;
- concise concerns.

Exclude DOM or page text, query URLs, secrets, credentials, headers, cookies,
browser/session state, CAPTCHA content, screenshots, and stack traces.

## 9. Stop owned services

Stop only the scoped Compose project. Preserve both volumes:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml down
```

Expected: only the `okved-parser` containers and network stop. Do not pass `-v`.
Do not remove the PostgreSQL or MinIO volumes.
