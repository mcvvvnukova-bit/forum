# Remove the retired landing from the project

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the retired landing source and its obsolete tooling, while preserving the current public site, development password gateway, real API acceptance and repository source integrity checks.

**Architecture:** `apps/web` remains the public-site owner. `apps/dev-gateway` becomes the owner of the small existing password screen and its Python gateway tests. Remove the old npm workspace, old landing page/build inputs/assets and retired deployment entrypoint. Add a strictly scoped retirement receipt to the existing provenance chain instead of rewriting historical receipts or ignoring missing sources.

**Tech Stack:** Node.js 24.18.1, npm workspaces, Vite, React 19, Primer React, Python 3, PostgreSQL 18.6 test containers, Playwright, GitNexus 1.6.12.

## Global Constraints

- Task: [PROJ-165](https://roadmap.astforum.ru/work_packages/PROJ-165). Worktree: `/Users/vvv/.codex/worktrees/remove-legacy-landing/АСТ Форум`; branch: `codex/PROJ-165-remove-legacy-landing`. Start from `36277f1094a6514709b2bf5eb6c9737c9361a213`.
- Delete `apps/legacy-landing` completely. No old landing source, assets, npm dependency or executable CI/build references remain. Dated historical plans and immutable source receipts may retain historical paths.
- Preserve `apps/web`, `apps/profile-preview`, API auth behavior/schema, immutable release artifacts, active gateway Python runtime and deployed gateway service/configuration semantics. No production/dev deployment, merge, unrelated sibling branch changes or restoration of the cancelled organization parser.
- Historical `accepted-source-matrix.json`, Task5/6/7 and PROJ-154 receipts remain byte-identical. Every retired protected source must have an explicit predecessor hash/mode and tombstone or owner move; unrelated protected sources stay mandatory. No generic missing-file exemption or bypass flag.
- The password screen uses existing Primer components and Forum token mapping. This task does not redesign it. All browser UI interactions use the Codex in-app browser.
- API browser acceptance must run actual current `apps/web` with the real API/provider fixture and disposable PostgreSQL, preserving registration/session/reload/logout/cancellation coverage at desktop/mobile widths.
- Commit only this task's changes with PROJ-165 in commit messages. Controller handles push, PR creation, OP#PROJ-165 linkage, attachment and manual browser verification.
- Own GitNexus index: `forum-remove-legacy`, storage `/Users/vvv/.local/share/gitnexus/forum-remove-legacy`. Base graph reports LOW impact for LandingApp, AuthScreen and verify_provenance. Shell/CI/receipt dependencies require source searches too. Do not rebuild or modify the locked main `ast-forum` index.

## Task 1: Remove retired landing and preserve its active dependencies

**Files:**
- Delete: all tracked `apps/legacy-landing/**`, `tests/e2e/legacy-landing-layout.mjs`, `scripts/deployment/legacy-landing/deploy.sh`.
- Create/move: `apps/dev-gateway/{package.json,index.html,vite.config.ts,tsconfig.json,README.md}`, `apps/dev-gateway/src/{main.tsx,AuthScreen.tsx,AuthScreen.test.tsx,auth-screen.css,test-setup.ts,vite-env.d.ts}`, `apps/dev-gateway/public/auth-assets/forum-logo-square.svg`, `apps/dev-gateway/tests/{test_auth_gateway.py,test_origin_login_check.py}`.
- Modify: root `package.json`, `package-lock.json`, `README.md`, `.github/workflows/quality.yml`, `apps/api/Dockerfile`, `apps/api/test/browser-smoke.mjs`, `apps/api/README.md`, `scripts/verification/{check-mail-resources.py,repository-layout.json,check-operational-sources.py,checks.test.mjs}`, `deployment/mail/templates/README.md`.
- Create: `artifacts/repository-audits/proj-165-legacy-retirement-ownership.json`.
- Update additional **active** references discovered by focused search, if necessary. Historical plans/receipts remain historical. Active gateway verification `verify-legacy-public.sh` may retain its existing path if renaming has unnecessary contract cost; clarify its purpose in current documentation. No source/runtime changes to Python gateway unless required by an actual preserved behavior failure.

**Interfaces:**
- Replace npm workspace `@astforum/legacy-landing` with `@astforum/dev-gateway`. Pin the same supported React/Primer/Vite/testing versions as current workspaces; omit Calcom and old landing-specific dependencies.
- Gateway build output remains `dist/site/auth/index.html` plus `/auth-assets/*`. Use the moved square SVG as `public/auth-assets/forum-logo-square.svg` and change only its screen URL to `/auth-assets/forum-logo-square.svg`; the existing Python route serves it relative to `login_index.parent`.
- Gateway imports the existing Forum token mapping from `../../web/src/home/forum-tokens.css`, preserving its existing AuthScreen styles/behavior. Keep `dev`, `build`, `typecheck`, `test:frontend`, `test:gateway`, `test` scripts; `test` covers frontend and preserved Python tests, not retired layout/deployment tests.
- CI frontend matrix becomes `[dev-gateway, web]`; typecheck/test/build run for both, existing web lint/Primer checks stay on web, remove retired layout Chromium step. Keep all nine required quality jobs.
- API Dockerfile copies the replacement workspace manifest before root-lock installation. Mail `logo.webp` remains byte-identical; compare against its pinned accepted SHA-256/validated provenance instead of depending on the deleted webp source. The current site's PNG is a different format and must not replace the accepted mail resource.

- [ ] **Step 1: Add meaningful red regressions.** Extend existing verification fixtures to exercise explicit retirement source handling: omitted tombstone/move, changed predecessor hash/mode, wrong base/task, duplicated/out-of-scope entry, resurrected deleted source, missing/tampered moved destination, changed current owner bytes, and an unrelated mandatory protected file missing. Save focused failing output before implementation. Existing fixture helpers and provenance checks should remain authoritative; avoid tests that merely mirror implementation syntax.

- [ ] **Step 2: Move only the live gateway screen and tests.** Adjust Python import paths after the move. Configure Vite/Vitest with the existing test setup. Check that the built SVG/CSS/JS paths match real gateway serving rather than proving only a React mock.

```ts
// apps/dev-gateway/vite.config.ts: existing auth output contract
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {outDir: 'dist/site/auth', emptyOutDir: true, assetsDir: 'auth-assets', chunkSizeWarningLimit: 900},
})
```

- [ ] **Step 3: Delete retired source and close active references.** Remove old package/page/assets/build helpers/test-only deployment checks and inert deployment script. Regenerate root lock with npm, remove Calcom only if no remaining workspace owns it. Update root layout/CI/Dockerfile/mail/docs references. `rg` hits in dated historical documents/receipts are permitted; no active reference may require the deleted directory. Keep the active password gateway and release publishers.

- [ ] **Step 4: Add strict additive retirement provenance.** Record predecessor source hashes/modes at the base commit, exact deletions, owner moves, changed/current owner hashes and new files in the PROJ-165 receipt. Integrate this layer after the existing Task7/PROJ154 chain, including paths currently verified directly as newFiles. Explicit retirement returns a tombstone only after exact predecessor/scope checks and physical absence; a move verifies destination bytes/mode. Verify all changed/new current owners, including the checker and regression suite. No rewriting earlier pins, no broad skip for `apps/legacy-landing`, no symlinks or escaping paths. Keep the receipt schema and validation in a focused existing checker implementation; split only if needed for a clearly defined responsibility and notify the controller first.

```python
# Required semantic distinction; choose a clear concrete representation.
resolved = resolve_current_source(path, pinned_hash, pinned_mode)
if resolved.is_retired:
    assert not (ROOT / path).exists(), 'Retired source resurrected'
else:
    verify_exact_file(resolved.path, resolved.sha256, resolved.mode)
```

- [ ] **Step 5: Migrate real API browser acceptance.** Resolve `apps/web/package.json` and `vite.config.ts`; assert the new owner rather than old landing files. Create Vite with explicit real API proxy routes `/api/auth`, `/auth/sber-id`, `/authorization`; enable real session integration for the run, restore process env afterward. Navigate `/register` and use the current Sber registration button. Check actual API session identity/persistence/DB/provider calls; use current `/login` authenticated status. Main has no logout UI, so call the real logout endpoint through the browser-context request with the required Origin header, verify cookie/session invalidation and zero active sessions, then reload `/login` and verify the guest login button. Preserve cancellation callback status/location, current error message, no issued token/user/attempt side effects, viewport overflow and page-error checks at widths 1440 and 390. No new personal-name or logout UI belongs to this removal task.

```js
const frontend = await createServer({
  root: webRoot,
  configFile: path.join(webRoot, 'vite.config.ts'),
  server: {host: '127.0.0.1', port: 0, proxy: {
    '/api/auth': apiTarget, '/auth/sber-id': apiTarget, '/authorization': apiTarget,
  }},
})
```

- [ ] **Step 6: Run focused gates, then complete relevant validation once.** Baseline: web78/78, composition28/28, gateway Python9/9 already passed; logs `/tmp/proj165-{web,composition,gateway}-baseline.log`. Node runtime `/Users/vvv/.local/lib/node-v24.18.1/bin`.

```bash
npm ci
npm run typecheck --workspace @astforum/dev-gateway
npm test --workspace @astforum/dev-gateway
npm run build --workspace @astforum/dev-gateway
npm run typecheck --workspace @astforum/web
npm run lint --workspace @astforum/web
npm test --workspace @astforum/web
npm run build --workspace @astforum/web
npm run test:composition
node scripts/verification/check-repository-layout.mjs
node --test scripts/verification/checks.test.mjs
npm run test:mail
python3 scripts/verification/check-operational-sources.py
bash scripts/verification/check-api.sh
```

Run only changed/full relevant checks; broad database/publisher/release suites unchanged need not be repeated without a concrete concern. Check mail browser acceptance as declared by test:mail. Validate the gateway built screen/assets with the actual Python handler using temporary local password/session files; report no secrets. Save per-command exit status/counts and important warnings in the implementer report. Run GitNexus detect_changes before committing and refresh the own index at final implementation HEAD, proving no deleted source definitions remain.

- [ ] **Step 7: Self-review and commit.** Verify no active source references/lock workspace remains, historical receipts unchanged, all required checks passed, and no unrelated changes. Commit with PROJ-165. Write detailed implementation/test/red-green evidence and concerns to the SDD report path supplied by the controller. Do not push/create PR/deploy. Controller performs independent task review and final branch review before publishing PR.

## Pre-flight review

- The removal includes non-UI consumers: root workspaces, Dockerfile, mail source pin, API real browser acceptance and CI/strict layout.
- A small replacement gateway workspace preserves the live password gate without retaining the old public landing.
- An additive receipt preserves historical audit evidence and keeps missing/resurrected/tampered sources detectable.
- The single implementation task is cohesive because lock/layout/provenance hashes depend on the final deletion and move set. Independent reviewer and final whole-branch reviewer follow it.
- Implementation scope is explicit; no pending product decision or external deployment approval is required.
