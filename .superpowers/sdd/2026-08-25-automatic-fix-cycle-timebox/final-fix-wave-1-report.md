# Final automatic fix wave 1 report

Status: **DONE**

- Fix base: `dbc854e54c7a5867e9cbbbaaff08f2ce3c9d95e2`
- Implementation/test commit: `9d4fc97538b153662f1c3a23b66d98c50af24013`
- Deadline: `2026-08-26T08:07:58.657Z`
- Final safe audit time: `2026-08-25T21:59:26Z`
- Live List-Org/FNS access: not used
- PostgreSQL: owned `127.0.0.1:5433` only
- MinIO: owned `127.0.0.1:9000/9001` only

## Result

All two Critical and four Important findings from the final whole-branch review are fixed together. The raw manifest remains version 2 and no migration/schema file changed. Browser screenshot proof is encoded as a versioned intent/completion action pair in the existing manifest-v2 `actions` array (`verify-visual-safety`, `painted-surface-policy/1`). Replay now rejects browser evidence whose terminal visual proof is absent or incomplete.

## Strict RED evidence

### 1. Browser service-worker/download/popup isolation

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npx vitest run test/integration/audience/list-org-browser-source.test.ts -t 'creates the browser context with service workers and downloads disabled|blocks service workers before navigation|blocks the (popup|download) browser side channel'
```

RED: exit 1; 69 tests discovered, 3 failed, 1 passed, 65 skipped. `newContext` had no isolation options, and popup/download fixtures returned `succeeded` rather than `blocked`. The local service-worker external probe received no connection under the existing route, but there was no explicit service-worker blocker contract/evidence.

### 2. Screenshot privacy on unprovable painted surfaces

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npx vitest run test/integration/audience/list-org-browser-source.test.ts test/unit/audience/browser-raw-sanitizer.test.ts -t 'masks a generic email split|fails closed before capture for an unprovable|visual-safety proof'
```

RED: exit 1; 10 failures. A generic email split across light-DOM descendants persisted, all eight SVG/shadow/generated/canvas/image/video/background fixtures completed successfully, and checksum validation accepted browser screenshot evidence without replay-verifiable visual proof.

### 3. DOM-only href secrets in the durable action ledger

Commands:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npx vitest run test/integration/audience/list-org-browser-source.test.ts -t 'collects DOM-only href secrets before'
```

RED: exit 1; 2 failures. Both success and failure raw action paths retained `dom-only-action-secret`.

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/integration/audience/fixture-run.test.ts -t 'keeps the durable PostgreSQL action ledger clean' --no-file-parallelism
```

RED: exit 1; 2 failures. PostgreSQL `crawl_tasks.result_json.actionLedger` contained the DOM-only secret on the successful click and HTTP-403 failure paths.

### 4. URL protocol allowlists

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts -t 'non-http retained URL protocol|serialized (javascript|data|file|encoded javascript) DOM href|non-http candidate website|removes non-http href schemes|blocks a non-http candidate website|checksum-consistent browser manifest with (javascript|data|file)|checksum-consistent serialized DOM href with (javascript|data|file|encoded javascript)' --no-file-parallelism
```

RED: exit 1; 200 tests discovered, 17 failed, 183 skipped. Capture, checksum validation, candidate publication, and S3 replay accepted prohibited schemes.

### 5. Pagination forward progress

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npx vitest run test/integration/audience/list-org-browser-source.test.ts -t 'blocks pagination contract drift'
```

RED: exit 1; 3 failures. A no-op Next link returned `limited`; repeated terminal and reordered-boundary pages returned `succeeded`.

### 6. Required finance enrichment and aggregate status

Commands:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/integration/audience/fixture-run.test.ts -t 'fails a required fixture-finance canary' --no-file-parallelism
```

RED: exit 1; reconciliation returned `consistent: true` with no finance task/evidence.

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/integration/audience/fixture-run.test.ts -t 'forced fixture_finance_failed' --no-file-parallelism
```

RED: exit 1; the run remained `succeeded/terminal_marker` after the finance task failed.

## Corrections and architecture decisions

1. Browser contexts now use `serviceWorkers: "block"` and `acceptDownloads: false`. Service-worker registration is explicitly rejected before page scripts run; popup/secondary-page and download listeners are installed before navigation and turn attempts into durable `policy_block` evidence. The local external HTTP probe remained at zero connections.
2. Capture fails closed for SVG, open/closed shadow DOM, generated content, canvas, image/picture, video/audio, iframe/object/embed, background-image, and inline `url(...)` surfaces. Closed-shadow hosts are tracked from a non-replaceable `attachShadow` wrapper. Generic email/phone occurrences are matched across rendered light-DOM text segments. Unsafe pages are replaced with a safe synthetic blocker page before screenshot evidence is created.
3. Visual proof remains manifest-v2-compatible. The proof stays pending through DOM preparation, a second pre-shot surface check, screenshot capture, and a post-shot surface check; only then is the proof completed. Replay requires the terminal visual action to be a completed pair.
4. Every DOM-derived action first collects live href-sensitive values, then records its sanitized write-ahead intent. PostgreSQL success/failure ledger tests inspect the durable JSONB surface.
5. Final URLs and candidate websites require absolute `http:`/`https:` URLs. Action and serialized-DOM navigation may be relative/protocol-relative but resolve to `http:`/`https:`; all other schemes are removed or rejected at capture, checksum, and S3 verification boundaries.
6. Result-page accessible names expose stable numeric record IDs. Each page records its ordered IDs plus DOM fingerprint before card visits; the collector rejects repeated fingerprints, no-new-record pages, stale terminal pages, and reordered stale IDs. Page identities are persisted in the PostgreSQL discovery audit.
7. Fixture runs persist immutable `requiredFinancialMetrics`. Successful finance tasks persist per-metric `published` outcomes/evidence counts. Reconciliation rejects absent, failed, non-successful, missing-outcome, count-mismatched, and invalid no-data finance results. A non-stale `fixture_finance_failed` task now fails the aggregate run.

## GREEN verification

Focused browser/raw suite:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npx vitest run test/integration/audience/list-org-browser-source.test.ts test/unit/audience/browser-raw-sanitizer.test.ts --no-file-parallelism
```

Result: exit 0; 2 files, 130 tests passed.

Focused S3/finance/job delivery suite:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/job-delivery.test.ts --no-file-parallelism
```

Result: exit 0; 3 files, 84 tests passed.

Focused PostgreSQL fixture/action/reconciliation suite:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npx vitest run test/integration/audience/fixture-run.test.ts --no-file-parallelism
```

Result: exit 0; 1 file, 19 tests passed.

Migration reversibility on owned PostgreSQL 5433:

```text
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Result: both exit 0; migration `001_audience_core` DOWN then UP. No migration changed.

Post-review full fixture suite:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- --no-file-parallelism
```

Result: exit 0; 19 files, 320 tests passed.

Dedicated e2e:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts --no-file-parallelism
```

Result: exit 0; 1 file, 10 tests passed.

Build and audits:

```text
npm run build
git diff --check
git diff --exit-code dbc854e54c7a5867e9cbbbaaff08f2ce3c9d95e2 -- migrations compose.yaml .superpowers/postgres-5433.compose.yaml CONTEXT.md .playwright-cli/console-2026-08-21T09-16-39-068Z.log docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
```

Result: all exit 0. TypeScript is clean; protected files, migrations, compose files, and progress ledgers are unchanged.

Owned service shutdown used `docker compose ... down` without `-v`. No owned container remains; volumes `okved-parser_postgres_data` and `okved-parser_minio_data` remain.

## Files

Production/domain:

- `src/apps/browser-runner/list-org-fixture-server.ts`
- `src/modules/audience/application/ports/audience-repository.ts`
- `src/modules/audience/application/publish-financial-evidence.ts`
- `src/modules/audience/application/run-fixture-discovery.ts`
- `src/modules/audience/domain/discovery.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`

Tests/fixtures:

- `test/e2e/audience-parser.e2e.test.ts`
- `test/fixtures/list-org-browser/results-page-1.html`
- `test/fixtures/list-org-browser/results-page-2.html`
- `test/integration/audience/financial-publication.test.ts`
- `test/integration/audience/fixture-run.test.ts`
- `test/integration/audience/job-delivery.test.ts`
- `test/integration/audience/list-org-browser-source.test.ts`
- `test/integration/audience/s3-raw-object-storage.test.ts`
- `test/unit/audience/browser-raw-sanitizer.test.ts`

## Compatibility evidence

- Manifest version remains `2`.
- No manifest field or exact-shape parser change was required.
- Visual proof uses the existing `actions` field and canonical UUID-v4 action IDs.
- Existing non-browser/legacy manifest verification remains supported.
- Older browser v2 evidence without the new proof is intentionally quarantined at replay rather than silently accepted.
- No SQL migration or schema-version change was made.

## Self-review

The full type-safety, error-handling, security, testing, quality, documentation, and performance checklist found two issues during the wave:

1. Severe: visual proof initially completed before screenshot creation, leaving a mutation window. Fixed by holding proof open across pre-shot and post-shot checks.
2. Moderate: page identities initially existed only in memory. Fixed by persisting ordered IDs/fingerprints in discovery task JSONB and asserting the durable payload.

After those corrections, the post-review full suite, dedicated e2e, build, diff check, and protected audit all passed. No actionable self-review finding remains.

## Concerns

None open. The deliberately conservative painted-surface policy may block pages containing otherwise benign images, media, shadow DOM, or generated content; this is the accepted fail-closed privacy behavior and preserves useful screenshots for pages whose painted output is provable.
