# Logout Homepage Implementation Plan

> **For agentic workers:** Execute this bounded fix in this session with TDD and gitnexus-work direct mode; the user's concrete transition is already specified.

**Goal:** Successful logout and confirmed guest cabinet visits return to `/`, where the existing login flow is available.

**Architecture:** Keep the shared session and public history contract. Change the cabinet's success and guest branches; preserve unknown-session and logout-failure handling. No API, gateway or database changes.

**Tech Stack:** React 19, TypeScript, Primer, Vitest, Playwright, existing immutable web publisher.

## Global Constraints

- Task: verified OpenProject PROJ-38 (API 75), parent PROJ-4 (API 41); work only on `codex/PROJ-38-logout-home`.
- Baseline: reviewed deployed `069932594b6c1b19c7e0d4e28f8fd821f717029e`; PR is based on the existing PROJ-158 branch.
- Preserve existing Sber tokens, `/login`, provider intent, account creation, blocked-user behavior and all historical audit receipts.
- Publish only dev; preserve API, gateway configuration, independent content, production and old immutable assets.

### Task 1: Cabinet transition and regression proof

**Files:** Modify `apps/web/src/home/Cabinet.tsx`, `apps/web/src/home/home.test.tsx`, `tests/e2e/public-site.spec.ts`. Extend `scripts/verification/check-operational-sources.py` and `scripts/verification/checks.test.mjs` with the exact successor ownership layer; create `artifacts/repository-audits/proj-38-logout-home-ownership.json`.

**Interfaces:** Consume shared `{session, loading, unavailable, retry}` and `POST /api/auth/logout` (204 success). Produce public route `/` via `history.replaceState(null, '', '/')` and `window.dispatchEvent(new PopStateEvent('popstate'))`.

- [ ] Update the existing unit regressions to expect the real homepage after a 401 cabinet response and after a successful logout; add logout-failure protection. Run `npm test --workspace @astforum/web -- src/home/home.test.tsx`: the homepage assertions must fail against the baseline.
- [ ] Confirm fresh graph impact for Cabinet; implement the minimal success transition and confirmed-guest guard. Remove the guest cabinet branch. A failed logout must retain the session and enable retry.
- [ ] Add built-site coverage at 320/390/1440: session 200 → click logout → 204 → session 401 → `/`, old identity absent; reload still `/`; homepage login opens `/login` and provider entry; Back to a stale cabinet returns home. Separately cover direct guest cabinet and unsuccessful logout.
- [ ] Add the exact five-file ownership successor and both design/plan files. Preserve historical receipt bytes; exercise hash, scope, mode, path, duplicate, baseline and source tampering against the checker.
- [ ] Run web tests/typecheck/lint/build, Primer gate, operational syntax and layout/ownership contracts. Stage only named files; detect_changes must be complete and expected; commit `fix(PROJ-38): return to homepage after logout`, push, create and attach PR with OP#PROJ-38 and OP#PROJ-4.
- [ ] Select the exact successful CI artifact; verify source inputs, artifact inventory, running target/container boundaries and independent files. Prove forced verifier rollback, then publish through the web publisher and compare all new/retained files at origin and HTTPS.
- [ ] In Codex iab verify the published guest cabinet redirect and standard homepage login; save a screenshot. Record truthful release receipts, verify PR in both OpenProject GitHub tabs, append the scoped result to PROJ-38, and verify local/remote/PR/release source equality.
