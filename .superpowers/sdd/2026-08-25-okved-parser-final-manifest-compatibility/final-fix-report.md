# Final whole-branch fix report

Date: 2026-08-25  
Branch: `codex/okved-parser`  
Starting HEAD: `b6365fe9c11578fea5d82d2ae6ae5688601b2a04`

## Commits

- Implementation: `7eaf32da39ecc97784239d2530bf412abcb43d0d` (`fix: close final parser review findings`).
- Report: this file is committed separately after it is written; the containing commit hash is supplied in the final handoff because a commit cannot include its own hash without a later metadata commit.

## Changes and design decisions

### Retained browser URLs

- `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts` now strips fragments, usernames, and passwords at the shared URL sanitizer, preserves existing sensitive-query filtering, and rejects any of those components at checksum/replay verification.
- Serialized DOM `href` values are structurally parsed (including relative values and basic/numeric HTML entities) and rejected if a checksum-consistent hostile artifact retains a fragment, userinfo, or sensitive query parameter.
- Fragment-, userinfo-, and sensitive-query-derived values are accumulated as redaction terms before DOM and screenshot capture. A materialized candidate website is sanitized before candidate evidence/staging, while its visible source field is masked in DOM and screenshot evidence so the original unsafe URL text cannot survive elsewhere in the same bundle.
- The manifest version remains unchanged. Canonical UUID-v4 and compact-phone behavior remains covered and green.

### Atomic OKVED release

- `src/modules/audience/application/import-selected-okveds.ts` exports exact CSV parsing, rejects header-only data, and verifies every row against the requested `source_version`.
- `src/modules/audience/application/release-selected-okveds.ts` performs fatal UTF-8 decoding and complete parsing before the conditional S3 write.
- `src/modules/audience/infrastructure/postgres/okved-release-repository.ts` publishes release provenance and imports rows inside one outer database transaction using transaction-scoped release and OKVED repositories. The executable no longer performs a second, non-atomic import.
- The existing checksum-addressed S3 write may precede the database transaction as permitted by the brief. Successful fixed-version reuse semantics remain unchanged.

### Blocked/conflicted discovery reconciliation

- Partial-page occurrences are retained when a blocker is reached after completed cards. Occurrence state is reset at the beginning of every page so a blocker on a new page cannot copy the prior page's occurrences.
- `DiscoveryAudit.blockedOrConflicted` accounts only source keys backed by an explicit `duplicate_conflict` blocker and removed from candidates/rejects. It does not infer conflicts from arbitrary missing materialization, so reconciliation still exposes unexplained occurrences.
- Reconciliation now enforces:

  `occurrences = acceptedCompanies + duplicates + rejected + blockedOrConflicted`

- Database-backed tests cover accepted-then-rejected, rejected-then-accepted, conflicting reject reasons, and mid-page HTTP 403, including persisted task JSON and successful reconciliation.

### Documentation and changed files

- Policy/spec/runbook: `docs/architecture/audience-ingestion-source-policy.md`, `docs/runbooks/audience-parser-canary.md`, and `docs/superpowers/specs/2026-08-24-okved-parser-final-blockers-follow-up-design.md` document `duplicate_conflict`, no-resume/new-run handling, partial pages, and the audit equation.
- Production/fixture code: `src/apps/browser-runner/list-org-fixture-server.ts`, `src/apps/okved-release/main.ts`, the four changed application/port files, the two PostgreSQL repositories, and the two List-Org browser source/sanitizer files.
- Tests: `test/e2e/audience-parser.e2e.test.ts`, five audience integration files, and `test/unit/audience/browser-raw-sanitizer.test.ts`.
- No migration, compose, fixture-gate, or protected-file change was required.

## RED evidence

All commands ran from `/Users/vvv/Проекты/АСТ Форум/.worktrees/okved-parser`. Database commands used only owned PostgreSQL `127.0.0.1:5433`; object-storage tests used owned MinIO `127.0.0.1:9000`.

### Finding 1: fragment/userinfo leaks

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
```

Expected RED: 12 failures / 124 passes. Three sanitizer expectations retained userinfo/hash, browser capture retained an unsafe candidate website, and eight checksum-consistent final/action/candidate/DOM replay cases were accepted instead of rejected.

Supplemental capture RED for fragment-derived redaction terms:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/integration/audience/list-org-browser-source.test.ts -t "strips URL userinfo and fragments"
```

Expected RED: 1 failure / 42 skipped; visible `action-fragment` survived in sanitized DOM. After that fix, strengthening the same regression to cover the visible candidate URL produced 1 failure / 42 skipped because `userinfo-name:userinfo-pass@localhost/...#candidate-fragment` survived as DOM text. Both are now redacted before DOM and screenshot persistence.

### Finding 2: invalid/partial OKVED publication

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/okved-release.test.ts
```

Expected RED: 3 failures / 4 passes. Malformed input, mismatched row version, and an injected database-import failure each left `crawl_runs=1`, `source_fetches=1`, `dataset_releases=1`, `okveds=0` instead of four zeros.

Supplemental exact-validation RED used the same command after adding a header-only executable case. Expected RED: 1 failure / 6 passes; the command exited 0 and published an empty release with `imported: 0`.

### Finding 3: blocked/conflicted reconciliation

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/list-org-browser-source.test.ts test/integration/audience/fixture-run.test.ts
```

Expected RED: 8 failures / 48 passes. Conflict projections reported two rather than three occurrences and no conflict category; mid-page 403 returned no partial page/occurrence; persisted audits lacked the new field and could not reconcile.

Self-review RED proving the new category cannot mask unrelated gaps:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/fixture-run.test.ts
```

Expected RED: 1 failure / 14 passes; an orphan occurrence persisted as `blockedOrConflicted: 1` instead of remaining an `unaccounted discovery occurrences: 1` reconciliation error.

Self-review RED for cross-page occurrence carry-over:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/integration/audience/list-org-browser-source.test.ts
```

Expected RED: 1 failure / 42 passes; a soft block at the start of page 2 produced two pages because page 1 occurrences were copied into page 2.

## GREEN and acceptance evidence

Focused URL matrix after all URL fixes:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
```

Result: 3 files / 141 tests passed.

Focused OKVED release/import matrix:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/okved-release.test.ts test/integration/audience/import-selected-okveds.test.ts
```

Result: 2 files / 9 tests passed.

Focused discovery/reconciliation matrix:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/list-org-browser-source.test.ts test/integration/audience/fixture-run.test.ts
```

Result: 2 files / 58 tests passed.

Migration replay on the owned database:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Result: migration `001_audience_core` completed DOWN and UP successfully.

Fresh final full suite:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
```

Result: 18 files / 248 tests passed.

Fresh dedicated end-to-end suite:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts
```

Result: 1 file / 10 tests passed.

Build:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
```

Result: TypeScript compilation passed. Node was `v24.18.1`.

Repository/service audits:

- `git diff --check`: passed.
- Fixture gates remain `APP_MODE=fixture` and `LIST_ORG_LIVE_ENABLED=false`; their implementation and compose files have no diff.
- Protected `CONTEXT.md`, `.playwright-cli/console-2026-08-21T09-16-39-068Z.log`, and `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`: no diff from the starting HEAD.
- Before shutdown, compose showed healthy `127.0.0.1:5433->5432` PostgreSQL and `127.0.0.1:9000-9001` MinIO bindings. Host PostgreSQL 5432 was never used.
- Shutdown command (intentionally without `-v`):

  ```bash
  APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml down
  ```

  Compose subsequently reported no services. Volumes `okved-parser_postgres_data` and `okved-parser_minio_data` remain.

## Self-review

The final whole-diff review found and fixed four issues before handoff:

1. The first `blockedOrConflicted` projection inferred a conflict from every missing materialization and could conceal an unrelated accounting defect. It now requires explicit `duplicate_conflict` blocker evidence.
2. Page-local occurrence state was reset too late, allowing a blocker at the start of a later page to copy the previous page's occurrences. It is now reset immediately when the page begins.
3. Stripped navigation-fragment values were not included in DOM/screenshot redaction terms. URL-derived sensitive values now include fragment components and userinfo.
4. The original unsafe candidate website remained visible as DOM text even though the structured field and `href` were sanitized. The website source field and screenshot region are now masked when a website is present.

No open Critical, Important, Moderate, or Minor finding remains after the fresh focused/full/e2e/build verification and protected-boundary audit.

## Residual concerns

- A checksum-addressed S3 object can remain after a database import transaction fails. This is the explicitly permitted ordering in the brief; no release identity or database provenance is committed, and corrected bytes for the fixed source version can succeed.
- `blockedOrConflicted` is a new field in discovery task JSON without a schema migration or manifest-version bump, as directed. All in-repository producers, reconciliation consumers, tests, and operator examples were updated; any unknown external consumer must tolerate the additive field.
- No live FNS/List-Org request was made. The live gate remains disabled throughout this fix wave.
