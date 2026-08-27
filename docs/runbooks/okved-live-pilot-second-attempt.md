# Run the bounded OKVED 43.11 live pilot — second attempt

## Status: active until `2026-08-27T21:40:50+03:00`

This is the sole v2 authorization, not a retry of the consumed 2026-08-26
attempt. It may be used only once, only before its expiry, and only for the
reviewed command and scope below. The active runtime checksum is
`59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542`.

| Field | Bound value |
|---|---|
| Scope key | `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02` |
| Review instant | `2026-08-27T09:40:50+03:00` |
| Expiry instant | `2026-08-27T21:40:50+03:00` |
| Command | `audience live-pilot --okved 43.11 --year 2025 --max-companies 10` |
| Limits | 2 List-Org pages, 12 sequential organization cards, 10 accepted entities, 10 sequential BFO reports, 1 revexp archive, browser/archive concurrency 1 |

Do not use an API, export, hidden endpoint, proxy, IP rotation, automation that
solves CAPTCHA, a custom browser script, or a replacement entity. The approved
origins, routes, retention, and exact limits are those in the v2 policy table in
the [audience ingestion source policy](../architecture/audience-ingestion-source-policy.md).

## Required non-public checks

Except for the three fixed header-only entry-point checks below, do not perform
a public-source check outside the live command. First verify the in-code
authorization against the current clock; this makes no network call:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false node --input-type=module -e 'import("./src/modules/audience/domain/live-pilot-policy.ts").then(({ LIVE_PILOT_POLICY, assertLivePilotPolicyActive }) => { assertLivePilotPolicyActive(LIVE_PILOT_POLICY); console.log(LIVE_PILOT_POLICY.checksumSha256); })'
```

It must print the checksum above and exit 0. A consumed, expired, or checksum
mismatch error ends this workflow; do not edit the clock or policy to continue.

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

Both migration names followed by `0|0` must be present. The before and after
canonical JSON and SHA-256 must be byte-identical. Abort if migration state,
either guard count, or either v1 value differs, the database endpoint is not
`127.0.0.1:5433/okved`, or the owned `okved-raw` bucket is unavailable.

## Headed browser and CAPTCHA

Before the command, confirm a headed Chromium window can open `about:blank`:

```bash
node --input-type=module -e 'import { chromium } from "playwright"; const browser = await chromium.launch({ headless: false }); const page = await browser.newPage(); await page.goto("about:blank"); console.log("headed Chromium opened about:blank"); await new Promise((resolve) => setTimeout(resolve, 1500)); await browser.close();'
```

If the live command pauses for CAPTCHA, leave its browser, command, and session
open. The operator solves only the visible challenge manually, informs the
controller without copying challenge content, and types `continue` only after
explicit controller authorization. `abort`, EOF, a second CAPTCHA, a block, or
contract drift is terminal. Never launch another command after a terminal state.

## Header-only entry-point checks

After all non-public checks pass and while the policy remains unexpired, issue
exactly one non-following HEAD request to each fixed entry point. Do not record
headers or bodies, add query parameters, or inspect page contents:

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

The only expected status is `200`. Any redirect, other status, transport error,
contract drift, or expiry blocks the workflow. Do not follow a redirect or try a
different route. In particular, do not probe the unresolved file archive route.

## The one authorized command

Run this exact command once, and only while the expiry check passed:

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

Record the terminal JSON, exit code, and returned run UUID without raw page
contents, session state, cookies, headers, CAPTCHA content, or sensitive URLs.

## Run-scoped audit

Set the returned UUID once and audit only that v2 run and its guard row:

```bash
RUN_ID='<uuid-from-terminal-json>'
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" <<'SQL'
SELECT scope_key, command_contract, policy_checksum_sha256, acquired_at
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
checksums only; do not browse or disclose evidence payloads. The historical
runbook's [raw-evidence audit](okved-live-pilot.md#7-audit-raw-evidence-and-storage)
is the required checksum procedure with `RUN_ID` set to this v2 UUID.

## Mandatory consumption after the terminal outcome

Whether the command succeeds, fails, blocks, or exits unexpectedly:

1. Do not invoke the command again.
2. Preserve the v2 guard checksum, terminal JSON, run UUID, and run-scoped audit
   counts in the post-run evidence record; leave the v1 evidence byte-for-byte
   unchanged.
3. Complete the consumed-v2 policy update and commit before any handoff. It must
   retain v2 `reviewedAt`, add the exact terminal `consumedAt`, mark its runtime
   authorization consumed, and preserve both checksums in history.
4. Update this runbook and README to audit-only status. A new scope is not
   authorized: there is explicitly no third attempt.
