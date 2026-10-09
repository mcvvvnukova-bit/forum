# CI minute optimization implementation plan

> Execute inline using gitnexus-work. The owner approved the proposed design with “выполняй” on 2026-10-09.

**Goal:** Reduce duplicated CI work and repeated provenance validation without weakening the required quality check. Task: OP#PROJ-164, https://roadmap.astforum.ru/work_packages/PROJ-164.

**Architecture:** Keep `pull_request`, restrict `push` to `main`, and retain manual runs. A dependency-free change-selection job compares the PR merge base with the checked-out candidate and emits a complete Boolean job map. Non-PR events, unavailable history and unknown paths select all jobs. `layout` always runs. The final gate validates the map, requires selected jobs to succeed, and rejects missing results, failures and cancellations, including unselected jobs.

**Tech stack:** Node.js 24.18.1, Python 3, GitHub Actions on ubuntu-24.04; no new dependencies.

## Constraints and approved design

- Keep checks for stacked PRs targeting feature branches; do not restrict `pull_request` base branches.
- Preserve the candidate-head checkout expression, immutable action revisions, clean `npm ci` and all existing suites.
- Cache npm downloads by the root package-lock.json; do not cache node_modules or browser binaries.
- Split layout commands into visible steps. GitHub run 37932942502 spent 1196 seconds in checks.test.mjs, versus nine seconds installing npm packages.
- Cache parsed and validated ownership receipts only inside one `verify_provenance()` invocation. Every subsequent call, including after changing ROOT or after a failure, starts fresh. File hashes and historical pins remain checked.
- Existing Task5/6/7 and PROJ-154 receipts remain immutable. Add an exact-path PROJ-164 ownership layer with independently pinned predecessor bytes and new source files.
- Known component paths select their direct and integration consumers; shared scripts, packages, root configuration and unknown paths run all checks. Renames include both old and new paths. Documentation-only changes retain layout.
- Billing changes, repository visibility, deployment and merging are outside this task.

## Task 1: Select checks and preserve the final gate

Files: `.github/workflows/quality.yml`, `scripts/verification/ci-selection.mjs`, `scripts/verification/ci-optimization.test.mjs`, `scripts/verification/quality-gate.mjs`, `scripts/verification/checks.test.mjs`.

- [x] Write failing tests using literal job maps for intentional skips, selected-job failures, unselected failures/cancellations, malformed maps and missing selection results.
- [x] Implement `selectJobs({eventName, files, baseAvailable})` returning all nine prerequisite Boolean flags; layout is always true. Unknown paths and missing history return all true.
- [x] Implement the CLI using `GITHUB_EVENT_PATH`, an argument-safe Git merge-base diff with `--no-renames -z`, and `GITHUB_OUTPUT`. Pull requests use event base/head SHA; other events run the full suite.
- [x] Exercise the CLI with real temporary Git repositories, including rename/deletion, newline-containing names, unavailable base and output-file serialization.
- [x] Add the changes job and conditional needs to existing jobs. Keep `quality` under `always()` and validate changes plus all prerequisite results.
- [x] Add npm caching to jobs that install dependencies and split layout into install, source check, regression tests, browser install and mail checks. Run the new tests before and after implementation.

## Task 2: Remove repeated receipt work

Files: `scripts/verification/check-operational-sources.py`, `scripts/verification/repository-layout.json`, `artifacts/repository-audits/proj-164-ci-ownership.json`, existing/new verification tests.

- [x] Prove receipt rereading with a real verification call and count actual Path.read_text calls while delegating to the original method. Baseline: governance receipt is read 1147 times in one call.
- [x] Extract Task7 receipt loading/validation and cache receipt results for one verification scope. Clear the scope in finally; preserve independent content hashing.
- [x] Pin exact predecessor bytes for changed governance files and exact hashes/modes of the new selector and test. Register the new required sources in the layout manifest.
- [x] Test historical receipt mutations, byte/mode/symlink drift, out-of-scope receipt entries, a second verification after mutation, changed ROOT and cache cleanup after exceptions.
- [x] Run `node --test scripts/verification/ci-optimization.test.mjs` and timed `node --test scripts/verification/checks.test.mjs`, then layout, operational and mail validation. Compare the same checkout's full regression suite with the 44-test, 37.67-second baseline.
- [ ] Re-index the isolated checkout, run GitNexus detect_changes before commit, commit with PROJ-164, push and open a PR against main.
- [ ] Confirm remote commit/diff, attach the PR to this chat and verify its GitHub tab on PROJ-164. Report GitHub CI billing restrictions separately from local checks and measured runtime.

## Verified results before publication

- The same 44 regression tests passed before and after: 37.67 seconds to 28.76 seconds locally (about 24 percent faster). This is not a measurement on the GitHub runner or a comparison with the different 105-test historical branch.
- All 13 new selection/gate/provenance tests passed; the initial red run rejected intentional skips and measured 1147 reads for each of two receipts. After the fix, each is read at most twice per invocation.
- actionlint 1.7.12, strict repository layout, 354 operational provenance entries and all eight mail-template browser checks passed.
- GitHub billing restrictions prevent confirming runner performance until account usage is unblocked.
