# Final automatic fix wave 3 report

## Status and control

- Status: **DONE**.
- Review base: `18ed1377d747f52e585febebda4b7300b7e7face`.
- Implementation commit: `5ee98eb` (`fix(audience): publish parser-derived finance outcomes`).
- Immutable deadline: `2026-08-26T08:07:58.657Z`.
- Start check: `date -u +%Y-%m-%dT%H:%M:%SZ` returned `2026-08-25T23:05:25Z`, before the deadline. The deadline was not changed.
- Execution remained fixture-only on owned PostgreSQL `127.0.0.1:5433` and MinIO `127.0.0.1:9000-9001`. No live List-Org/FNS or host PostgreSQL `5432` access occurred.

## Review verification

The re-review finding matched the current executable path. `fixture-finance` staged parser evidence and raw objects, then discarded parser absence semantics by rebuilding outcomes with `publishedMetricOutcomes()`. That helper threw before task creation whenever any required metric had zero evidence. The capable application/repository API was therefore unreachable for legitimate no-data parser results.

## Strict RED

The regression uses a parser-valid 2024 BFO report with an empty `lines` object, so `parseBfo()` returns `revenue: null` and zero revenue evidence. It creates and replays a real fixture discovery run, then spawns the production `fixture-finance` executable rather than calling `publishFinancialEvidence()` directly.

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/fixture-run.test.ts -t "publishes parser-derived no-data through the fixture-finance executable" --no-file-parallelism
```

Result before production edits: **1 file failed; 1 test failed and 21 skipped**. The spawned CLI exited 1 where the test expected 0. This was the intended failure: the valid missing revenue metric reached the published-only helper, which aborted before a successful finance task could be persisted.

## Correction

- Financial staging now keeps both staged raw objects as named provenance sources and constructs an exact outcome for every required metric from the actual combined parser evidence.
- A positive evidence count produces `{ outcome: "published", evidence: <exact count> }`, preserving the all-published path.
- Zero evidence produces `{ outcome: "no_data", evidence: 0, sourceAttempt }`. The attempt is derived from the corresponding run-owned staged BFO or Revexp raw object: source kind, source record key, capture instant, checksum, and parser version.
- The real `fixture-finance` branch passes `staged.metricOutcomes` unchanged to `publishFinancialEvidence()`. The published-only helper was removed.
- No repository, schema, migration, or manifest change was needed; existing transactional validation and fencing remain authoritative.

## GREEN evidence

### Executable regression

The exact RED command was rerun after the correction.

Result: **1 file passed; 1 test passed and 21 skipped**, duration 1.79 s. It proves:

- the real child process exits 0 with two published evidence rows;
- the `fixture_finance` task succeeds with fencing token `1`;
- task JSON contains exact revenue `no_data` provenance and published income/expenses counts;
- that provenance exactly identifies the run-owned BFO `source_fetches` row;
- no revenue evidence row exists; and
- reconciliation is consistent with revenue 0, income 1, and expenses 1.

### Focused CLI/fixture/finance/reconciliation/job matrix

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/apps/audience-cli.test.ts test/integration/audience/audience-cli.test.ts test/integration/audience/fixture-run.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/job-delivery.test.ts --no-file-parallelism
```

Result: **5 files passed, 56 tests passed**, duration 22.47 s. This retains all-published publication, lower-level mixed/no-data validation, rejection behavior, reconciliation, and stale fencing.

### Migration reversibility

```text
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Both commands exited 0 for `001_audience_core`. No migration changed.

### Full acceptance

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- --no-file-parallelism
```

Result: **19 files passed, 341 tests passed**, duration 69.18 s.

Dedicated e2e:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts --no-file-parallelism
```

Result: **1 file passed, 11 tests passed**, duration 3.52 s.

`npm run build` exited 0.

## Compatibility and boundary audits

- `RAW_MANIFEST_VERSION` remains `2`; no browser raw format or manifest field changed.
- Protected diffs were empty against both the complete protected baseline and wave-3 base for migrations, compose files, `CONTEXT.md`, the protected Playwright log, and the protected plan.
- No `progress.md` changed. `git diff --check` passed.
- The only new operational environment lines in the test explicitly set `APP_MODE=fixture` and `LIST_ORG_LIVE_ENABLED=false`. No live origin or host-5432 binding was added.
- Service inspection showed only owned host bindings `127.0.0.1:5433` and `127.0.0.1:9000-9001`.

## Files changed

- `src/apps/browser-runner/main.ts`: retain parser-derived staged outcomes and remove the published-only caller helper.
- `test/fixtures/fns-bfo/report-0710002.json`: add a valid 2024 missing-revenue report without changing the existing 2025 all-published data.
- `test/integration/audience/fixture-run.test.ts`: real executable no-data publication, exact fenced task/provenance/evidence/reconciliation assertions.

## Self-review

The wave diff was reviewed across type safety, error handling, fixture-only security, test validity/isolation, code quality, documentation, and performance. The regression asserts real executable and database behavior without mocking the orchestration. Exact task-result equality prevents omitted or extra outcome fields from passing the test. Final findings: **0 Severe, 0 Moderate, 0 Minor**. No unresolved concern remains.
