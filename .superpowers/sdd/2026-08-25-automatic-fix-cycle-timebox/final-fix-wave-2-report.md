# Final automatic fix wave 2 report

## Status and control

- Status: **DONE**.
- Review base: `11d619a05cd7bfdaac2c61c328c3c18f5336d5f1`.
- Implementation commit: `f318bc7` (`fix(audience): close wave-two parser review gaps`).
- Immutable deadline: `2026-08-26T08:07:58.657Z`.
- Start check: `date -u +%Y-%m-%dT%H:%M:%SZ` returned `2026-08-25T22:18:55Z`, before the deadline. The deadline was not changed.
- Execution remained fixture-only. Only the owned PostgreSQL binding on `127.0.0.1:5433` and MinIO bindings on `127.0.0.1:9000-9001` were used. No live List-Org/FNS access or host PostgreSQL `5432` access occurred.

## RED evidence

### 1. Catchable service-worker rejection

Command (the browser RED run also covered the screenshot and pagination findings):

```text
npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Result before production edits: 2 files failed, 8 tests failed and 131 passed. The `service-worker-caught` Chromium fixture caught `navigator.serviceWorker.register()` rejection and the collector returned `succeeded`; there was no controller policy marker or durable blocker evidence. This isolated the registration attempt and did not perform a fallback external fetch.

### 2. Mutation-safe inert screenshot and exact proof binding

The same RED run rejected neither incomplete/reordered/duplicate/unmatched visual histories nor a proof bound to another page fingerprint. The mutation and remaining declarative/CSS cases were then isolated with:

```text
npm test -- test/integration/audience/list-org-browser-source.test.ts -t "sanitized snapshot|declarative shadow"
```

Result before production edits: 2 tests failed. The live-page screenshot painted the late mutation red, and the declarative/CSS fixture painted the red masked surface. These are real Chromium screenshots, not mocked page objects.

### 3. Expected pagination identity and rejected-page durability

In the first browser RED run, the skip-to-later-terminal fixture returned `succeeded`. The zero-occurrence skipped page was also absent from the discovery page audit because blocker capture only materialized pages after an occurrence.

The PostgreSQL durability assertion was additionally run in the combined database RED command below and failed because page 2's ordered IDs, fingerprint, and page number were missing.

### 4. Immutable per-metric finance outcomes

Command (with the standard fixture environment pointing only at PostgreSQL 5433 and MinIO 9000):

```text
npm test -- test/integration/audience/financial-publication.test.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/fixture-run.test.ts -t "mixed published|forged no-data|absent required|stale finance|visual proof history|rejected page identity"
```

Result before production edits: 3 files failed, 7 tests failed, 1 passed, and 96 were skipped. A mixed task could not persist `no_data`; forged `no_data` with evidence and an absent required outcome resolved successfully; malformed checksum-consistent S3 visual histories replayed; and the rejected page identity was not durable. The stale-token case passed as the pre-existing fencing control; the new no-data stale-token regression was retained in GREEN coverage.

## Smallest cohesive correction

### Browser policy and screenshot architecture

- `navigator.serviceWorker.register` first awaits a Playwright-exposed Node binding that records `service-worker-registration` in controller-owned policy state, then returns the rejection. Catching the rejection cannot remove the terminal marker. Normal collection turns it into `policy_block`; blocker capture and fixture publication make its evidence durable.
- The adversarial live page is never screenshotted. Capture produces and verifies the sanitized DOM bytes, computes their SHA-256 fingerprint, then loads those exact bytes into a separate Playwright context with JavaScript disabled, service workers blocked, downloads disabled, and all network requests aborted and audited. The PNG is produced only by that inert page.
- Each raw item carries exactly one ordered `intent`/`completed` `verify-visual-safety` pair with one canonical action ID. Both events target `sanitized-inert-render-policy/1;page-fingerprint-sha256=<exact fingerprint>`. Checksum validation and S3 replay reject missing, incomplete, duplicate, unmatched, reordered, or differently bound proof.
- The sanitizer removes scripts, styles, templates, SVG/media/canvas/image/object/embed surfaces, shadow content, generated/declarative content, unsafe attributes, and non-HTTP(S) links before inert rendering. Useful sanitized textual screenshots remain available.

### Pagination

- Every result page must expose the exact expected page marker. A skip from expected page 2 to rendered page 3 is contract drift even when the later page has new records and a terminal marker.
- Ordered source IDs and the sanitized-page fingerprint are reset and captured per page. Blocker materialization now persists a rejected page identity whenever its fingerprint was observed, including the zero-occurrence case.

### Finance contract

- Application and repository inputs now carry the immutable report year plus one explicit result for every required metric: `published` with an exact positive evidence cardinality, or `no_data` with zero evidence and an exact source-attempt record.
- The repository locks the run's immutable year/required-metric contract, validates exact outcome keys and evidence membership, validates `no_data` provenance against a run-owned raw source fetch, and persists every outcome with the fenced successful task in the same transaction.
- Reconciliation revalidates published counts and exact no-data source-attempt provenance. No-data attempts explain their audited raw fetches without creating financial evidence rows. Missing, forged, or stale results fail closed.

## GREEN evidence

### Focused browser/raw/pagination

```text
npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Fresh post-review-cleanup result: **2 files passed, 140 tests passed**, duration 39.74 s.

### Focused PostgreSQL/S3/finance/reconciliation/job delivery

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/financial-publication.test.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/fixture-run.test.ts test/integration/audience/job-delivery.test.ts --no-file-parallelism
```

Fresh committed-tree result: **4 files passed, 112 tests passed**, duration 22.32 s. This includes mixed published/no-data, forged and absent outcomes, stale no-data fencing, malformed S3 proof replay, durable rejected-page identity, durable caught-service-worker policy evidence, failed fixture finance behavior, reconciliation, and job delivery.

### Migration reversibility on owned PostgreSQL

```text
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Both exited 0. Migration `001_audience_core` rolled down and up successfully. No migration file changed.

### Complete fixture acceptance

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- --no-file-parallelism
```

Fresh result: **19 files passed, 340 tests passed**, duration 68.68 s.

### Dedicated e2e and build

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts --no-file-parallelism
npm run build
```

Dedicated e2e: **1 file passed, 11 tests passed**, duration 3.54 s. TypeScript build exited 0.

## Compatibility and audits

- `src/modules/audience/infrastructure/storage/raw-bundle.ts` still declares `RAW_MANIFEST_VERSION = 2`.
- The manifest schema did not change. The existing action target string carries the policy/fingerprint binding, and the existing action list carries the exact pair. S3 round-trip/replay tests prove v2 compatibility.
- `git diff --exit-code` against both the complete protected baseline and the wave base was empty for `migrations`, `compose.yaml`, `.superpowers/postgres-5433.compose.yaml`, `CONTEXT.md`, the protected Playwright console log, and the protected plan.
- No `progress.md` file changed. `git diff --check` passed.
- Added-line audit found no live List-Org/FNS origin, `LIST_ORG_LIVE_ENABLED`, or host-5432 change. Service inspection showed only `127.0.0.1:5433` and `127.0.0.1:9000-9001` host bindings.

## Files changed

- Browser source/policy/storage: `browser-raw-sanitizer.ts`, `list-org-browser-source.ts`, `s3-raw-object-storage.ts`.
- Finance application/repository/CLI: `audience-repository.ts` port and PostgreSQL implementation, `publish-financial-evidence.ts`, `src/apps/browser-runner/main.ts`.
- Real-browser fixtures: `list-org-fixture-server.ts`, `results-page-1.html`, `results-page-2.html`.
- Tests: browser sanitizer/source, S3 replay, fixture durability, finance publication, job delivery, and full audience-parser e2e suites.

## Self-review

The final diff was reviewed against all four accepted findings and adjacent persistence/replay paths. One obsolete live painted-surface enumerator and its now-unused closed-shadow instrumentation were removed so the implementation has a single inert-render security model. Final review classification: **0 Critical, 0 High, 0 Medium, 0 Low** actionable findings. No unresolved concern remains in this wave.
