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

Do not perform a public-source check outside the live command. First verify the
in-code authorization against the current clock; this makes no network call:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false node --input-type=module -e 'import("./src/modules/audience/domain/live-pilot-policy.ts").then(({ LIVE_PILOT_POLICY, assertLivePilotPolicyActive }) => { assertLivePilotPolicyActive(LIVE_PILOT_POLICY); console.log(LIVE_PILOT_POLICY.checksumSha256); })'
```

It must print the checksum above and exit 0. A consumed, expired, or checksum
mismatch error ends this workflow; do not edit the clock or policy to continue.

Audit the preserved v1 history before v2 access. These queries must show the
unchanged v1 run and no v1 attempt-guard row:

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -c "
SELECT id, status, scope_json
FROM audience.crawl_runs
WHERE scope_json = jsonb_build_object(
  'okved', '43.11', 'year', 2025, 'dryRun', true, 'maxPages', 2,
  'maxCompanies', 10, 'onlyActive', false,
  'requiredFinancialMetrics', jsonb_build_array('revenue', 'income', 'expenses')
);
SELECT scope_key, policy_checksum_sha256, acquired_at
FROM audience.live_pilot_attempts
WHERE scope_key = 'okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26';"
```

The preserved database may only migrate upward from migration 001 to migrations
002 and 003. Never run a down migration against it:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml exec -T postgres \
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -c "SELECT name FROM okved_migrations WHERE name IN ('002_live_pilot_attempt_guard', '003_raw_upload_intents') ORDER BY name;"
```

Both migration names must be present. Abort if migration state differs, the
database endpoint is not `127.0.0.1:5433/okved`, or the owned `okved-raw` bucket
is unavailable.

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
  psql -U okved -d okved -X -v ON_ERROR_STOP=1 -v run_id="$RUN_ID" -c "
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
ORDER BY source_kind, source_record_key, object_key;"
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
