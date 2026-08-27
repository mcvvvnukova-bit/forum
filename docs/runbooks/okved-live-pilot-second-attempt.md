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
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
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
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

It returned the safe terminal message `live pilot discovery blocked`. Do not run
it again for any reason.

## Run-scoped audit

Audit only the frozen v2 run and its guard row:

```bash
RUN_ID='8da208ea-2bff-44a6-a94f-431bbe5f97e7'
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" <<'SQL'
SELECT scope_key, command_contract, policy_checksum_sha256, consumed_at
FROM audience.live_pilot_attempts
WHERE scope_key = 'okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02';
SELECT id, status, terminal_reason, scope_json, published_at IS NOT NULL AS published
FROM audience.crawl_runs WHERE id = :'run_id'::uuid;
SELECT task_kind, status, count(*) AS tasks
FROM audience.crawl_tasks WHERE run_id = :'run_id'::uuid
GROUP BY task_kind, status ORDER BY task_kind, status;
SELECT source_kind, source_record_key, object_key, checksum_sha256
FROM audience.source_fetches WHERE run_id = :'run_id'::uuid
ORDER BY source_kind, source_record_key, object_key;
SQL
```

Use the returned `object_key` values to check MinIO object existence and
checksums only; do not browse or disclose evidence payloads. Attempt 02 retained
a projection manifest (`artifacts.sanitizedProjection`), not the historical
DOM/screenshot manifest shape. The terminal audit verified its manifest and
projection checksums and returned `verifiedObjects=1`.

## Completed mandatory consumption

The current policy is consumed, the exact active v2 snapshot remains in policy
history for guard audit, and the terminal evidence is recorded in
[`okved-live-pilot-2026-08-27-attempt-02.md`](evidence/okved-live-pilot-2026-08-27-attempt-02.md).
The v1 evidence remains byte-identical. Do not invoke the command again.
