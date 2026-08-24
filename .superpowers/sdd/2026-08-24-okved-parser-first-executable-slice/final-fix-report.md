# OKVED parser final fix report

Date: 2026-08-24

Fix base: `766b47dd4528298f681ad86c1b05af2d5d90bf85`

Implementation commit: `d20a1ac` (`fix: close OKVED parser final review findings`)

Report commit: `docs: record OKVED final fix verification` (this document; exact hash is reported in the final handoff)

## Outcome

All seven Important findings and all four Minor findings from
`final-review-findings.md` are closed. No assertion was removed or weakened. The suite grew from
100 to 137 tests. Live sources remained disabled throughout.

The boundary suites used real PostgreSQL, MinIO, Chromium, and pg-boss. They ran under Compose
project `okved-parser` with the ignored `5433` overlay. The unrelated PostgreSQL process on port
`5432` was not stopped or modified.

Common test environment:

```text
APP_MODE=fixture
LIST_ORG_LIVE_ENABLED=false
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=okved-raw
S3_ACCESS_KEY_ID=okved-local
S3_SECRET_ACCESS_KEY=okved-local-secret
```

## Important findings

### 1. Stable task recovery and write-ahead browser actions

Implemented in:

- `src/modules/audience/application/task-lease.ts`
- `src/modules/audience/application/replay-run.ts`
- `src/modules/audience/application/run-fixture-discovery.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository-support.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/browser-action-recorder.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- `src/apps/browser-runner/main.ts`
- `src/apps/worker/main.ts`

The producer now creates/reuses one stable business `taskId`, and the pg-boss payload carries
`{runId, taskId}`. An expired lease is reacquired on that same task with a new fencing token; an
already completed task returns without rereading raw data. Active work renews its lease and aborts
if renewal fails. Discovery recovery starts a new ephemeral browser/context/session at page one.
Every browser action is written to the fenced audit ledger before its side effect. All recovery
paths finish in a terminal state, so reconciliation cannot retain a running orphan.

Focused regressions:

- `test/integration/audience/job-delivery.test.ts`
  - `reacquires one expired replay task and makes a completed delivery source-free`
  - `delivers one stable replay business task twice through pg-boss without rereading raw`
- `test/integration/audience/fixture-run.test.ts`
  - `recovers expired discovery from page one with lease renewal and write-ahead actions`
- `test/unit/audience/task-lease.test.ts`
  - `aborts work and propagates a lease-renewal failure`

RED evidence:

```text
focused replay/recovery: 2 failed
expected replay task count/attempt/nonterminal = 1/2/0
received                                  = 2/1/1
discovery recovery: duplicate task primary key followed by timeout

task-lease rejection regression: 1 failed
timeout plus unhandled rejection: lease renewal transport failed
```

GREEN evidence:

```text
replay/recovery focus: 2 passed, 7 skipped
stable real pg-boss delivery: 1 passed, 4 skipped
task-lease unit regression: 1 passed
affected job/fixture boundary group: passed
```

### 2. Monotonic organization projection and run-scoped publication counts

Implemented in:

- `src/modules/audience/infrastructure/postgres/organization-publication.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository-support.ts`
- `src/modules/audience/application/ports/audience-repository.ts`

Shared organization projections choose evidence deterministically by
`(captured_at, created_at, id)` and update both company fields and OKVED roles only when the
candidate wins. Replaying old evidence after new evidence therefore cannot roll the projection
back. Run publication totals count only exact `(company_inn, matched_okved_code)` tuples belonging
to the run.

Focused regression:

- `test/e2e/audience-parser.e2e.test.ts`
  - `reconciles overlapping runs from only their own match tuples and evidence`
  - covers changed organization fields, new-then-old replay, OKVED role monotonicity, and exact
    run summary/task result counts.

RED/GREEN evidence:

```text
RED: secondReplay companyOkveds expected 3, received 4
GREEN: 1 passed, 9 skipped
```

### 3. Strict raw identity and source ownership

Implemented in:

- `src/modules/audience/infrastructure/storage/raw-bundle.ts`
- `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts`
- `src/modules/audience/application/run-fixture-discovery.ts`
- `src/modules/audience/application/replay-run.ts`
- `src/modules/audience/domain/discovery.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository.ts`

`StoredRawObject` and manifest verification now bind run ID, source kind, source record key,
parser version, checksum, and checksum-addressed key prefix. Verification also binds the expected
adapter/source independently of a self-consistent but foreign manifest. Discovery rejects raw
identity outside its command run. Financial evidence lookup is exact: revenue uses `fns_bfo`,
while income and expenses use `fns_revexp`; each metric must match its own declared `sourceKind`.

Focused regressions:

- `test/integration/audience/s3-raw-object-storage.test.ts`
  - manifest mutation/cross-run swap rejection
  - `rejects a self-consistent object owned by a different source adapter`
- `test/integration/audience/fixture-run.test.ts`
  - `fails discovery before persistence when raw identity belongs to another run`
- `test/integration/audience/financial-publication.test.ts`
  - exact per-metric raw source and rollback on invalid provenance

RED/GREEN evidence:

```text
RED initial strict-identity group: 8 failed
RED self-consistent cross-source object: resolved instead of rejecting
GREEN strict-identity focus: 8 passed, 11 skipped
GREEN complete S3 integration file: 15 passed
```

### 4. Typed browser rejects and blocker evidence

Implemented in:

- `src/modules/audience/domain/discovery.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/browser-record-policy.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- `src/modules/audience/application/run-fixture-discovery.ts`
- `src/apps/browser-runner/list-org-fixture-server.ts`
- `src/modules/audience/infrastructure/postgres/audience-repository.ts`

Invalid records are returned as typed rejects rather than failing the run. Scope mismatch,
ambiguous/mismatched OKVED, unknown role, duplicate-record conflicts, policy blocks, soft blocks,
CAPTCHA, and HTTP failures are typed distinctly. Conflicts and blockers cannot publish. Each
reject/blocker retains sanitized, checksummed raw evidence, and browser transitions retain their
response status. Discovery reconciliation now derives accepted/duplicate/rejected counts rather
than hard-coding rejects to zero.

Focused regressions:

- `test/integration/audience/list-org-browser-source.test.ts`
  - invalid, ambiguous, scope mismatch, conflicting duplicate, and `403` after click scenarios
  - checksums and response status on blocker artifacts
- `test/integration/audience/fixture-run.test.ts`
  - `reconciles an invalid browser record as one reject and publishes only accepted rows`
  - external-resource fixture block is terminal and fenced

RED/GREEN evidence:

```text
RED typed reject/blocker group: 13 failed
GREEN same focused group: 13 passed, 20 skipped
GREEN affected browser + fixture group: 33 passed
```

### 5. Fail-closed raw redaction and scanning

Implemented in:

- `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/browser-action-recorder.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`

Raw DOM is rebuilt from an explicit safe tag/attribute allowlist. Comments, metadata, scripts,
unsafe attributes, contact-derived URLs, and unapproved values are removed; every occurrence is
redacted. Screenshots mask every matching node. Candidate manifests, serialized DOM, action
metadata, final URLs, and screenshot inputs are post-scanned before immutable persistence. Both
configured secrets and generic secret query parameters (including `client_secret`) are sanitized
before the write-ahead ledger, and any residue fails closed. Contact hashes remain available in
the normalized record; plaintext contacts do not enter raw evidence.

Focused regressions:

- `test/integration/audience/list-org-browser-source.test.ts`
  - mailto links, metadata, aria labels, comments, duplicated text, actions, screenshots,
    configured/default secrets, candidate company name/website, and generic secret query params
- `test/integration/audience/fixture-run.test.ts`
  - production `tsx` CLI transform executes real Chromium discovery

RED/GREEN evidence:

```text
RED initial sanitizer group: 4 failed
RED candidate-manifest gap: 2 failed (contact name and secret website accepted)
RED generic client_secret: raw redaction scan failed after unsafe ledger content
RED production CLI: page.evaluate ReferenceError: __name is not defined
GREEN manifest sanitizer focus: 5 passed, 9 skipped
GREEN client_secret focus: 1 passed, 28 skipped
GREEN real tsx/Chromium CLI focus: 1 passed, 7 skipped
GREEN complete affected redaction/browser group: passed
```

The `__name` failure was an esbuild `keepNames` helper captured inside functions passed to
`page.evaluate`; browser-evaluated helpers were changed to object methods so no Node transform
helper crosses the browser boundary.

### 6. Multi-record streaming revexp parser

Implemented in:

- `src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser.ts`

The parser now maintains state per XML `Документ`, emits on the record close, and resets before
the next record. It incrementally decodes fixed-size byte chunks with a fatal UTF-8 decoder, so a
multi-byte code point split at the 16,384-byte boundary is reconstructed correctly and malformed
input is rejected.

Focused regressions in `test/unit/audience/revexp-parser.test.ts`:

- `keeps metrics inside each XML record when the first record omits a metric`
- `incrementally decodes a UTF-8 code point split across the parser chunk boundary`

RED/GREEN evidence:

```text
RED: expense from the second XML record was attributed to the first record
GREEN: complete revexp parser file, 14 passed
```

### 7. Immutable checksum-addressed OKVED release

Implemented in:

- `src/modules/audience/application/release-selected-okveds.ts`
- `src/modules/audience/infrastructure/postgres/okved-release-repository.ts`
- `src/modules/audience/infrastructure/storage/s3-immutable-object-storage.ts`
- `src/apps/okved-release/main.ts`
- `package.json`
- `docs/runbooks/audience-parser-canary.md`

The command hashes the exact CSV bytes and stores them under
`raw/okved-csv/<sha256>/selected-okveds.csv`. S3 uses conditional create; a retry compares exact
bytes. The key checksum segment must equal the uploaded bytes. Database reuse is serialized with
an advisory lock and accepted only when both checksum and object key match the existing release.

Focused regressions in `test/integration/audience/okved-release.test.ts`:

- exact immutable create/reuse
- different bytes at an existing key
- key checksum not matching bytes
- existing database release with mismatched checksum/key

RED/GREEN evidence:

```text
RED initial release group: required modules were absent
RED key-vs-bytes regression: direct put resolved instead of rejecting
GREEN complete release integration file: 4 passed
```

Manual release acceptance, repeated with the same fixture:

```text
first:  releaseId=2e1a110c-36a5-4efa-9a3a-e4c28280f00c reused=false imported=1
second: releaseId=2e1a110c-36a5-4efa-9a3a-e4c28280f00c reused=true  imported=1
sha256=f80e1b2c812508ac616157a46694fecefdd12a199cc3e4ae3c53cf4a57b7129c
objectKey=raw/okved-csv/f80e1b2c812508ac616157a46694fecefdd12a199cc3e4ae3c53cf4a57b7129c/selected-okveds.csv
```

## Minor findings

### 1. Exact migration contract

Files/tests:

- `migrations/sql/001_audience_core.up.sql`
- `test/integration/postgres/migration.test.ts`

The integration test now asserts the exact eleven owned tables; every required primary key,
unique constraint, foreign key, delete action, deferrability property, index, and composite
evidence constraint. Composite evidence foreign keys explicitly use `ON DELETE RESTRICT`.

```text
focused migration suite: 3 passed
npm run migrate:down: migration 001 reverted, exit 0
npm run migrate:up:   migration 001 applied, exit 0
```

The down/up was executed against only the `127.0.0.1:5433` worktree database.

### 2. Focused extraction of oversized concerns

Extracted modules:

- browser policy: `browser-record-policy.ts`
- browser sanitization: `browser-raw-sanitizer.ts`
- browser write-ahead actions: `browser-action-recorder.ts`
- organization projection: `organization-publication.ts`
- release persistence: `okved-release-repository.ts`
- shared repository helpers: `audience-repository-support.ts`

This keeps policy, sanitization, browser-action, organization-publication, and release repository
logic independently testable without unrelated aesthetic refactoring.

### 3. Runbook correctness

File: `docs/runbooks/audience-parser-canary.md`

- startup uses `docker compose up -d --wait`;
- expected e2e count is ten;
- replay polling is bounded to 60 attempts and exits immediately on `failed`/`blocked`;
- the shell variable is `replay_status` (not zsh's read-only `status`);
- selected OKVED release uses the checksum-addressed CLI and documents exact reuse semantics.

The corrected walkthrough was executed after the `replay_status` fix.

### 4. Partial browser and owned S3 lifecycle

Implemented/tested in:

- `src/apps/browser-runner/main.ts`
- `src/apps/worker/main.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts`
- `test/integration/audience/list-org-browser-source.test.ts`
- `test/integration/audience/s3-raw-object-storage.test.ts`

Browser startup closes the browser if context creation fails and closes context plus browser if
page/session creation fails. `S3RawObjectStorage` tracks ownership and provides idempotent
`close()`/client destruction. Browser, worker, finance, release, and test entry points release only
resources they own.

```text
RED lifecycle focus: 3 failed
GREEN lifecycle focus: 3 passed, 38 skipped
```

## Final verification

### Focused and affected suites

All newly added regressions and all affected browser, S3, fixture, finance, job-delivery, release,
migration, parser, and e2e files passed with real boundary dependencies. No skipped assertion was
introduced to make a regression green.

### Full suite

Command:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false \
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved \
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw \
S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret \
npm test
```

Fresh final output:

```text
Test Files  17 passed (17)
Tests       137 passed (137)
Duration    11.94s
exit        0
```

Build and whitespace verification:

```text
npm run build
> tsc -p tsconfig.json
exit 0

git diff --check 766b47dd4528298f681ad86c1b05af2d5d90bf85..HEAD
(no output, exit 0)
```

### Corrected clean-fixture acceptance

Actual discovery CLI result after the production-transform regression was fixed:

```json
{"ok":true,"result":{"runId":"3921d9e9-d9e3-41bb-b3cb-40bb0ec7fb5c","status":"succeeded","reason":"terminal_marker","discoveredCompanies":3,"publishedCompanies":0,"rawObjects":6}}
```

The fixture worker reported `{"ok":true,"status":"ready"}`. Two replay deliveries for the same
run both reached `succeeded`; the second delivery preserved idempotent projections and left no
nonterminal task. Finance publication returned `publishedEvidence: 3`.

Final reconciliation:

```text
run status/reason: succeeded / terminal_marker
discovery: occurrences=4 uniqueSourceRecords=3 acceptedCompanies=3 duplicates=1 rejected=0
tasks: total=4 nonTerminal=0
financial: revenue=1 income=1 expenses=1
sourceFetches=8 stagedRecords=3 companies=3 companyOkveds=3 runMatches=3
unexplainedSourceFetches=0 published=true consistent=true
```

The worker was then stopped cleanly. Compose services were left available for handoff; the
unrelated host PostgreSQL on `5432` remained untouched.

## Self-review and protected paths

The entire range from the required base was reviewed after the focused fixes. Additional issues
found during that pass (lease-renewal rejection propagation, self-consistent foreign adapter raw,
candidate-manifest secret leakage, generic secret parameters, production `tsx` browser transform,
and checksum-key/byte mismatch) each received its own RED regression before the fix.

Review result: Severe 0, Moderate 0, Minor 0; recommendation: ship.

Neither protected external path appears in the fix range:

- `CONTEXT.md`
- `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`

## Residual concerns

No residual concern remains within the specified fixture-only first executable slice. Live source
traffic was intentionally not enabled or exercised; that is a binding scope boundary, not an open
review finding.
