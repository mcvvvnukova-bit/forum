# Audit the consumed OKVED 43.11 live pilot — second attempt

## Status: consumed at `2026-08-27T08:39:58Z`

The sole v2 authorization terminated `blocked` with `policy_block` and command
exit code `1`. Run `8da208ea-2bff-44a6-a94f-431bbe5f97e7` is the only v2 run.
The active guard checksum was
`59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542`;
the consumed runtime checksum is
`87f9294a8c9175d754757bb55ad6bc470dae379575079fd60d851d4e3165adae`.
This runbook is now audit-only and does not authorize preflight, source access,
or another live command. There is explicitly no third attempt.

Credential-bearing values are never stored in this runbook. Historical command
references require `OKVED_AUDIT_DATABASE_URL` to be preconfigured for exactly
`127.0.0.1:5433/okved`, `OKVED_AUDIT_S3_ENDPOINT` for exactly
`http://127.0.0.1:9000`, `OKVED_AUDIT_S3_BUCKET` for exactly `okved-raw`, and
`OKVED_AUDIT_S3_ACCESS_KEY_ID` / `OKVED_AUDIT_S3_SECRET_ACCESS_KEY` from the
operator's local secret store. These references neither authorize the commands
nor renew the consumed authorization.

| Field | Bound value |
|---|---|
| Scope key | `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02` |
| Review instant | `2026-08-27T09:40:50+03:00` |
| Expiry instant | `2026-08-27T21:40:50+03:00` |
| Consumption instant | `2026-08-27T08:39:58Z` |
| Active guard checksum | `59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542` |
| Consumed runtime checksum | `87f9294a8c9175d754757bb55ad6bc470dae379575079fd60d851d4e3165adae` |
| Terminal result | `blocked` / `policy_block`; exit code `1` |
| Command | `audience live-pilot --okved 43.11 --year 2025 --max-companies 10` |
| Limits | 2 List-Org pages, 12 sequential organization cards, 10 accepted entities, 10 sequential BFO reports, 1 revexp archive, browser/archive concurrency 1 |

Do not use an API, export, hidden endpoint, proxy, IP rotation, automation that
solves CAPTCHA, a custom browser script, or a replacement entity. The approved
origins, routes, retention, and exact limits are those in the v2 policy table in
the [audience ingestion source policy](../architecture/audience-ingestion-source-policy.md).

## Historical non-public checks — do not execute

The following commands preserve the consumed preflight record. Do not execute
them as a new preflight. The current policy is consumed and the policy check
must now reject.

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false node --input-type=module -e 'import("./src/modules/audience/domain/live-pilot-policy.ts").then(({ LIVE_PILOT_POLICY, assertLivePilotPolicyActive }) => { assertLivePilotPolicyActive(LIVE_PILOT_POLICY); console.log(LIVE_PILOT_POLICY.checksumSha256); })'
```

Before consumption this printed the active checksum and exited `0`. It now
rejects with `LIVE_PILOT_AUTHORIZATION_CONSUMED`, as required.

Audit and hash the preserved v1 history before migration. This query binds the
exact historical run and its sole task and inspects only migration-001 tables:

```bash
V1_RUN_ID='50b2909b-0171-45d6-ae17-7c805ff49be6'
canonical_v1() {
  docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
    psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v v1_run_id="$V1_RUN_ID" -At <<'SQL'
SELECT jsonb_build_object(
  'run', (
    SELECT jsonb_build_object(
      'id', id,
      'status', status,
      'terminal_reason', terminal_reason,
      'published', published_at IS NOT NULL,
      'scope_json', scope_json
    )
    FROM audience.crawl_runs
    WHERE id = :'v1_run_id'::uuid
  ),
  'tasks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'task_kind', task_kind,
      'status', status,
      'attempts', attempts,
      'fencing_token', fencing_token,
      'result_json', result_json,
      'error_json', error_json,
      'completed_at', completed_at
    ) ORDER BY id)
    FROM audience.crawl_tasks
    WHERE run_id = :'v1_run_id'::uuid
  ), '[]'::jsonb),
  'counts', jsonb_build_object(
    'runs', (SELECT count(*) FROM audience.crawl_runs WHERE id = :'v1_run_id'::uuid),
    'tasks', (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = :'v1_run_id'::uuid),
    'source_fetches', (SELECT count(*) FROM audience.source_fetches WHERE run_id = :'v1_run_id'::uuid),
    'companies', (SELECT count(DISTINCT company_inn) FROM audience.run_company_matches WHERE run_id = :'v1_run_id'::uuid),
    'relations', (SELECT count(*) FROM audience.run_company_matches WHERE run_id = :'v1_run_id'::uuid),
    'financial_outcomes', (
      SELECT count(*)
      FROM audience.financial_evidence AS evidence
      JOIN audience.source_fetches AS source_fetch ON source_fetch.id = evidence.source_fetch_id
      WHERE source_fetch.run_id = :'v1_run_id'::uuid
    )
  )
)::text;
SQL
}
V1_CANONICAL_BEFORE="$(canonical_v1)"
V1_CANONICAL_BEFORE_SHA256="$(printf '%s' "$V1_CANONICAL_BEFORE" | shasum -a 256 | awk '{print $1}')"
printf '%s\n%s\n' "$V1_CANONICAL_BEFORE" "$V1_CANONICAL_BEFORE_SHA256"
```

Expected preserved state: exactly run
`50b2909b-0171-45d6-ae17-7c805ff49be6` is `running`, has no terminal reason,
is unpublished, and has the preserved `43.11`/2025/2-page/10-company run scope.
It has exactly one `live_discovery` task in `running` state with `attempts=1`,
`fencing_token=1`, and no result, error, or completion time. Its run-scoped
source-fetch, company, relation, and financial-outcome counts are all zero.
Abort before migration if any row, count, state, scope, or nullability differs.
Do not alter the historical evidence report while investigating a mismatch.

The preserved database may only migrate upward from migration 001 to migrations
002 and 003. Never run a down migration against it:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false \
  DATABASE_URL="$OKVED_AUDIT_DATABASE_URL" npm run migrate:up
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT name
FROM public.pgmigrations
WHERE name IN ('002_live_pilot_attempt_guard', '003_raw_upload_intents')
ORDER BY name;
SELECT
  count(*) FILTER (
    WHERE scope_key = 'okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26'
  ) AS v1_guard_rows,
  count(*) FILTER (
    WHERE scope_key = 'okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02'
  ) AS v2_guard_rows
FROM audience.live_pilot_attempts;
SQL
V1_CANONICAL_AFTER="$(canonical_v1)"
V1_CANONICAL_AFTER_SHA256="$(printf '%s' "$V1_CANONICAL_AFTER" | shasum -a 256 | awk '{print $1}')"
printf '%s\n%s\n' "$V1_CANONICAL_AFTER" "$V1_CANONICAL_AFTER_SHA256"
test "$V1_CANONICAL_BEFORE" = "$V1_CANONICAL_AFTER"
test "$V1_CANONICAL_BEFORE_SHA256" = "$V1_CANONICAL_AFTER_SHA256"
```

The consumed preflight returned both migration names followed by `0|0`; the
before and after canonical JSON and SHA-256 were byte-identical. The terminal
audit now requires v1/v2 guard counts `0|1`.

## Historical headed browser and CAPTCHA procedure

The preflight confirmed a headed Chromium window could open `about:blank`:

```bash
node --input-type=module -e 'import { chromium } from "playwright"; const browser = await chromium.launch({ headless: false }); const page = await browser.newPage(); await page.goto("about:blank"); console.log("headed Chromium opened about:blank"); await new Promise((resolve) => setTimeout(resolve, 1500)); await browser.close();'
```

No CAPTCHA appeared. The historical same-session procedure would have required
explicit controller authorization before `continue`; it never allowed a
replacement browser or command.

## Historical header-only entry-point checks — do not execute

The preflight issued exactly one non-following HEAD request to each fixed entry
point and recorded status only:

```bash
header_status() {
  label="$1"
  entry_point="$2"
  status="$(curl --silent --show-error --head --output /dev/null \
    --write-out '%{http_code}' --max-redirs 0 --connect-timeout 15 --max-time 30 \
    "$entry_point")"
  printf '%s %s\n' "$label" "$status"
  test "$status" = '200'
}
header_status list-org-search 'https://www.list-org.com/search'
header_status bfo-root 'https://bo.nalog.gov.ru/'
header_status revexp-metadata 'https://www.nalog.gov.ru/opendata/7707329152-revexp/'
unset -f header_status
```

All three historical statuses were `200`; redirects followed and file-archive
route probes were both zero. These checks are consumed and must not be repeated.

## Historical one-shot command — do not execute

The consumed attempt executed this command exactly once:

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true \
  DATABASE_URL="$OKVED_AUDIT_DATABASE_URL" \
  S3_ENDPOINT="$OKVED_AUDIT_S3_ENDPOINT" \
  S3_BUCKET="$OKVED_AUDIT_S3_BUCKET" \
  S3_ACCESS_KEY_ID="$OKVED_AUDIT_S3_ACCESS_KEY_ID" \
  S3_SECRET_ACCESS_KEY="$OKVED_AUDIT_S3_SECRET_ACCESS_KEY" \
  npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

It returned the safe terminal message `live pilot discovery blocked`. Do not run
it again for any reason.

## Run-scoped audit

Audit only the frozen v2 run and its guard row. The run and scope identifiers
below are literals, not operator inputs. The transaction is explicitly
read-only, and every reported v2 database invariant is calculated from the
preserved rows:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 <<'SQL'
\set run_id '8da208ea-2bff-44a6-a94f-431bbe5f97e7'
\set scope_key 'okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02'
\pset pager off
BEGIN TRANSACTION READ ONLY;

SELECT scope_key, command_contract, policy_checksum_sha256, consumed_at IS NOT NULL AS consumed
FROM audience.live_pilot_attempts
WHERE scope_key = :'scope_key';

SELECT id, status, terminal_reason, scope_json, published_at IS NOT NULL AS published
FROM audience.crawl_runs
WHERE id = :'run_id'::uuid;

SELECT id, task_kind, status, attempts, fencing_token,
       result_json->>'reason' AS terminal_reason,
       completed_at IS NOT NULL AS completed
FROM audience.crawl_tasks
WHERE run_id = :'run_id'::uuid
ORDER BY created_at, id;

SELECT id, source_kind, source_record_key, object_key, checksum_sha256,
       parser_version, raw_upload_intent_id
FROM audience.source_fetches
WHERE run_id = :'run_id'::uuid
ORDER BY source_kind, source_record_key, object_key;

SELECT id, task_id, state, artifact_kind, source_kind, source_record_key,
       manifest_key, manifest_checksum_sha256, source_fetch_id,
       verified_at IS NOT NULL AS verified,
       committed_at IS NOT NULL AS committed
FROM audience.raw_upload_intents
WHERE run_id = :'run_id'::uuid
ORDER BY created_at, id;

WITH target_run AS (
  SELECT * FROM audience.crawl_runs WHERE id = :'run_id'::uuid
), run_matches AS (
  SELECT * FROM audience.run_company_matches WHERE run_id = :'run_id'::uuid
), metric_outcomes AS (
  SELECT outcome.key AS metric, outcome.value AS outcome
  FROM audience.crawl_tasks AS task
  JOIN target_run AS run ON run.id = task.run_id
  CROSS JOIN LATERAL jsonb_each(
    COALESCE(task.result_json->'metricOutcomes', '{}'::jsonb)
  ) AS outcome
  WHERE task.task_kind = 'live_finance'
    AND run.scope_json->>'year' = '2025'
), unexplained_upload_intents AS (
  SELECT intent.id
  FROM audience.raw_upload_intents AS intent
  WHERE intent.run_id = :'run_id'::uuid
    AND NOT (
      (intent.state = 'committed' AND EXISTS (
        SELECT 1
        FROM audience.source_fetches AS source_fetch
        WHERE source_fetch.id = intent.source_fetch_id
          AND source_fetch.raw_upload_intent_id = intent.id
          AND source_fetch.run_id = intent.run_id
          AND source_fetch.source_kind = intent.source_kind
          AND source_fetch.source_record_key = intent.source_record_key
          AND source_fetch.parser_version = intent.parser_version
          AND source_fetch.object_key = intent.manifest_key
          AND source_fetch.checksum_sha256 = intent.manifest_checksum_sha256
      ))
      OR (intent.state = 'failed'
          AND intent.source_fetch_id IS NULL
          AND intent.failure_phase IS NOT NULL
          AND intent.failure_code IS NOT NULL
          AND intent.failed_at IS NOT NULL)
    )
), unexplained_source_fetches AS (
  SELECT source_fetch.id
  FROM audience.source_fetches AS source_fetch
  WHERE source_fetch.run_id = :'run_id'::uuid
    AND NOT EXISTS (
      SELECT 1 FROM audience.organization_evidence AS evidence
      WHERE evidence.source_fetch_id = source_fetch.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM audience.financial_evidence AS evidence
      WHERE evidence.source_fetch_id = source_fetch.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM audience.crawl_tasks AS task
      CROSS JOIN LATERAL jsonb_each(
        COALESCE(task.result_json->'metricOutcomes', '{}'::jsonb)
      ) AS outcome
      WHERE task.run_id = source_fetch.run_id
        AND task.task_kind = 'live_finance'
        AND task.status = 'succeeded'
        AND outcome.value->>'outcome' = 'no_data'
        AND outcome.value->'sourceAttempt'->>'rawSourceKind' = source_fetch.source_kind
        AND outcome.value->'sourceAttempt'->>'sourceRecordKey' = source_fetch.source_record_key
        AND outcome.value->'sourceAttempt'->>'parserVersion' = source_fetch.parser_version
        AND outcome.value->'sourceAttempt'->>'rawFetchKey'
          IN (source_fetch.object_key, source_fetch.checksum_sha256)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM audience.crawl_tasks AS task
      WHERE task.run_id = source_fetch.run_id
        AND task.task_kind = 'live_revexp_capture'
        AND task.status = 'succeeded'
        AND task.result_json->'rawCapture'->>'sourceKind' = source_fetch.source_kind
        AND task.result_json->'rawCapture'->>'sourceRecordKey' = source_fetch.source_record_key
        AND task.result_json->'rawCapture'->>'checksumSha256' = source_fetch.checksum_sha256
        AND task.result_json->'rawCapture'->>'parserVersion' = source_fetch.parser_version
    )
    AND NOT (
      source_fetch.source_kind = 'list-org-live'
      AND source_fetch.source_record_key ~ '^page:[1-9][0-9]*$'
    )
), invariant_counts AS (
  SELECT
    (SELECT count(*) FROM target_run) AS runs,
    (SELECT count(*) FROM audience.live_pilot_attempts WHERE scope_key = :'scope_key') AS guard_rows,
    (SELECT count(*) FROM audience.crawl_tasks WHERE run_id = :'run_id'::uuid) AS tasks,
    (SELECT count(*) FROM audience.crawl_tasks
      WHERE run_id = :'run_id'::uuid AND task_kind = 'live_discovery'
        AND status = 'succeeded') AS live_discovery_succeeded,
    (SELECT count(*) FROM audience.crawl_tasks
      WHERE run_id = :'run_id'::uuid AND task_kind = 'live_discovery'
        AND status = 'blocked' AND result_json->>'reason' = 'policy_block') AS live_discovery_policy_blocked,
    (SELECT count(*) FROM audience.crawl_tasks
      WHERE run_id = :'run_id'::uuid AND task_kind = 'live_revexp_capture'
        AND status = 'succeeded') AS live_revexp_capture_succeeded,
    (SELECT count(*) FROM audience.crawl_tasks
      WHERE run_id = :'run_id'::uuid AND task_kind = 'live_finance'
        AND status = 'succeeded') AS live_finance_succeeded,
    (SELECT count(*) FROM audience.crawl_tasks
      WHERE run_id = :'run_id'::uuid AND status IN ('pending', 'running')) AS nonterminal_tasks,
    (SELECT count(DISTINCT company_inn) FROM run_matches) AS companies,
    (SELECT count(*)
      FROM audience.company_okveds AS relation
      JOIN run_matches AS match
        ON match.company_inn = relation.company_inn
       AND match.matched_okved_code = relation.okved_code
      WHERE relation.okved_code = '43.11') AS company_okved_relations_43_11,
    (SELECT count(*) FROM metric_outcomes
      WHERE metric IN ('revenue', 'income', 'expenses')
        AND outcome->>'outcome' IN ('published', 'no_data')) AS terminal_metric_outcomes_2025,
    (SELECT count(*) FROM metric_outcomes
      WHERE metric = 'revenue'
        AND outcome->>'outcome' IN ('published', 'no_data')) AS revenue_outcomes_2025,
    (SELECT count(*) FROM metric_outcomes
      WHERE metric = 'income'
        AND outcome->>'outcome' IN ('published', 'no_data')) AS income_outcomes_2025,
    (SELECT count(*) FROM metric_outcomes
      WHERE metric = 'expenses'
        AND outcome->>'outcome' IN ('published', 'no_data')) AS expenses_outcomes_2025,
    (SELECT count(*) FROM audience.source_fetches WHERE run_id = :'run_id'::uuid) AS source_fetches,
    (SELECT count(*)
      FROM audience.financial_evidence AS evidence
      JOIN audience.source_fetches AS source_fetch ON source_fetch.id = evidence.source_fetch_id
      WHERE source_fetch.run_id = :'run_id'::uuid) AS financial_evidence_rows,
    (SELECT count(*) FROM audience.raw_upload_intents
      WHERE run_id = :'run_id'::uuid AND state = 'committed') AS committed_upload_intents,
    (SELECT count(*) FROM unexplained_upload_intents) AS unexplained_upload_intents,
    (SELECT count(*) FROM unexplained_source_fetches) AS unexplained_source_fetches
)
SELECT counts.*,
       run.status,
       run.terminal_reason,
       run.published_at IS NOT NULL AS published,
       CASE
         WHEN run.status = 'blocked'
          AND run.terminal_reason = 'policy_block'
          AND run.published_at IS NULL
          AND counts.live_revexp_capture_succeeded = 0
          AND counts.live_finance_succeeded = 0
         THEN 'not_reached'
         ELSE 'not_proven'
       END AS reconciliation
FROM invariant_counts AS counts
CROSS JOIN target_run AS run;

COMMIT;
SQL
```

Expected invariant row: `runs=1`, `guard_rows=1`, `tasks=1`,
`live_discovery_succeeded=0`, `live_discovery_policy_blocked=1`, both downstream
success counts `0`, `nonterminal_tasks=0`, `companies=0`,
`company_okved_relations_43_11=0`, `terminal_metric_outcomes_2025=0`,
each of the three per-metric 2025 outcome counts `0`,
`source_fetches=1`, `financial_evidence_rows=0`,
`committed_upload_intents=1`, both unexplained counts `0`, status/reason
`blocked`/`policy_block`, `published=false`, and `reconciliation=not_reached`.

Verify only the exact committed manifest and projection keys. The verifier
requires the five externally supplied `OKVED_AUDIT_*` values named at the top of
this runbook, rejects any other database/S3 coordinates, uses a read-only SQL
transaction plus exact S3 `GetObject` calls, and does not list, write, delete, or
print object payloads:

```bash
./node_modules/.bin/tsx src/apps/audit/second-live-pilot-object-audit.ts
```

Expected safe JSON: the exact run/source/record identity, upload-intent state
`committed`, manifest and projection keys/checksums, and `verifiedObjects: 1`.
Attempt 02 retained a projection manifest (`artifacts.sanitizedProjection`),
and the verifier validates its v3 manifest identity and projection digest.

## Completed mandatory consumption

The current policy is consumed, the exact active v2 snapshot remains in policy
history for guard audit, and the terminal evidence is recorded in
[`okved-live-pilot-2026-08-27-attempt-02.md`](evidence/okved-live-pilot-2026-08-27-attempt-02.md).
The v1 evidence remains byte-identical. Do not invoke the command again.
