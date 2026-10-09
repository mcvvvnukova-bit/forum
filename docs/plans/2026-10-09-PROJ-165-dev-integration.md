# PROJ-165 dev integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Publish removal of the retired landing to dev while preserving the current main cabinet and public site.

**Architecture:** Merge current accepted main into the existing removal branch. Preserve the current publisher, CI optimization and ownership layers; append an integration receipt where predecessor bytes change. Parent publishes only an exact successful CI artifact with private rollback and served-byte evidence.

**Tech Stack:** React/Primer, Node 24.18.1, Python, GitHub Actions, atomic web publisher.

## Global Constraints

- Task is PROJ-165, OpenProject work package id 203; PR is #36.
- Work only in /Users/vvv/.codex/worktrees/remove-legacy-landing/АСТ Форум on codex/PROJ-165-remove-legacy-landing.
- Integrate main commit 1afee9fd9e1055b52ddcf607d26f57ffb115326a into removal head ad2243bc25ca6f48e983d7c333cf76d3102a0907.
- Preserve all main product behavior, cabinet/settings/logout, publisher route additions, CI selection/provenance and layered ownership checks.
- Keep apps/legacy-landing and retired legacy deployment/layout sources absent. Preserve active password gateway under apps/dev-gateway.
- Historical ownership receipts are immutable; do not repin or weaken them. Authenticate new layer's predecessors/actions and new files against real Git object bytes.
- Preserve independently owned fixtures and immutable hashed assets. Never clean other worktrees or reset unrelated state.
- Do not implement the cancelled organization parser or merge PR #34 as part of this task.
- Before code changes use GitNexus impact; before commits detect_changes for this exact worktree. If graph is unavailable, state the failure and use sources.
- Only parent performs push, GitHub/OP updates or live dev operations. Production, migrations, ACL or identity changes are outside scope.

### Task 1: integrate accepted main without restoring retired sources

**Files:**
- Merge conflicts in package.json/package-lock.json, .github/workflows/quality.yml, scripts/verification/check-operational-sources.py, scripts/verification/repository-layout.json and other actually conflicted paths.
- Update scripts/verification/ci-selection.mjs and tests if changed workspace names require it.
- Append artifacts/repository-audits/proj-165-main-integration-ownership.json and checker/test support only if needed to authenticate changed protected predecessors.
- Preserve main scripts/deployment/build-web-release.mjs, web_release.py, build config and current apps/web/profile/API changes except narrowly necessary gateway workspace references.

**Interfaces:**
- Consumes clean removal branch and accepted main commit, historical ownership layers, existing repository checks.
- Produces a clean committed combined candidate, passing relevant local gates and a detailed test/report file for independent review. No live deployment.

- [ ] Inspect actual merge conflicts and predecessor receipts before resolving.

```sh
git status --short --branch
git merge --no-commit --no-ff 1afee9fd9e1055b52ddcf607d26f57ffb115326a
git diff --name-only --diff-filter=U
```

- [ ] Resolve by preserving both accepted behaviors and retirement; do not choose an entire old checker/CI file over current main. Keep newer main API browser acceptance rather than regressing its public-main flow. Keep strict canonical retired-path tombstones and digest pin while adding an authenticated current override layer for legitimately changed integration files. Inspect main CI selection to add renamed gateway component if necessary, preserving change filtering.
- [ ] Run focused ownership/CI/retirement tests and discriminate every new regression against the unintegrated behavior. Use tests in scripts/verification/checks.test.mjs and ci-optimization.test.mjs for actual changed policy contracts; no tests mirroring implementation.

```sh
export PATH=/Users/vvv/.local/lib/node-v24.18.1/bin:$PATH
npm ci
npm run test:verification
npm run check:layout
npm run test:composition
npm run test:publishers
npm run test --workspace @astforum/dev-gateway
npm run build --workspace @astforum/dev-gateway
npm run test --workspace @astforum/web
npm run build --workspace @astforum/web
```

- [ ] Run exact available operational/API/mail checks declared by package.json/CI once; report commands, exit codes, counts and warnings. Check all current cabinet routes and gateway forwarders are preserved. If command names drift, use the actual declared equivalents and record them.
- [ ] Self-review the combined candidate against main: retired sources are the intended removals; there is no rollback of new product behavior or weakenings of protected predecessor/source checks.
- [ ] Refresh own GitNexus index, stage only this merge/task files, detect_changes, and commit with PROJ-165 in subject. Return full report and concise status; parent handles independent task and final reviews before push.

## Parent release gates

After Task 1 and independent task/final reviews: push and update PR #36 with OP#PROJ-165; require exact-head CI. Download its dev artifact by exact run/artifact ID and validate manifest/full bytes. Recheck live dev CAS, mounts/runtime and source evidence with forum-prod SSH -B en0. Deploy the exact artifact atomically to /opt/outline/dev-astforum/landing using its publisher; preserve old assets and profile preview. Verify origin plus public HTTPS and old cookies/late assets through a forced failure/rollback and final reapply, then test current routes in Codex iab. If live active gateway must receive its renamed auth-only build, preserve its password/runtime/session contract and deploy only that owner with backup. No API behavior change is requested; compare current deployed API before any image action. Save sanitized release evidence, update PR/task and verify persisted GitHub linkage. A green local build alone is not completion.
