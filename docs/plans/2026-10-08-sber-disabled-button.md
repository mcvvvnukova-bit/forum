# Sber ID Disabled Button Implementation Plan

**Goal:** Keep the Sber ID button green with a white label when checking a session or awaiting provider navigation.

**Architecture:** Bind the four missing disabled Primer semantic tokens locally on `.public-auth-sber` to the existing approved Sber provider tokens. Preserve the Primer Button, its disabled behavior and the Forum token layer.

**Tech Stack:** Primer React 38.37.0, CSS custom properties, Playwright built-site regressions, Node.js 24.

## Scope and acceptance

- User approved this correction after the reported diagnosis; work package [PROJ-158](https://roadmap.astforum.ru/work_packages/PROJ-158/activity), parent OP#PROJ-35, actor Кузьмина (API user 8).
- Existing Sber token source approval is recorded in `scripts/verification/primer-ui/policy.json`; introduce no new visual literals or Forum mappings.
- Background and border stay `--sber-button-rest`; label and icon color stay `--sber-button-label`. Existing hover/active states remain.
- Keep session checking, one provider start, disabled semantics, authentication routes, API, database and production unchanged.
- Baseline browser reproduction: disabled background/border `rgb(255, 212, 178)`, text `rgb(74, 74, 74)`; expected green `rgb(33, 160, 56)` and white text.

## Implementation and verification

1. Modify `apps/web/src/auth/auth.css` with local disabled background/border/foreground/icon token bindings. Add a real built-site CSS cascade regression to `tests/e2e/public-site.spec.ts` at 320/390/1440 px: hold session check, release to guest, hover, click and hold provider navigation; assert green/white disabled state, one start and unchanged orange Forum primary action.
2. Preserve historical ownership receipts. Add an exact-path PROJ-158 successor receipt for the CSS, browser test and its verification tooling; cover malformed hashes, predecessor/base, path/scope/mode and duplicate tampering.
3. Run web tests/typecheck/lint/build, Primer gates, ownership/layout regressions and GitNexus staged change detection. Push a task branch, create/attach PR against the existing PROJ-157 branch and verify child/parent GitHub links.
4. Select the exact successful CI artifact for the reviewed commit. Verify its inputs and inventory, target/mount/runtime boundaries, backup and forced atomic rollback, then publish only the dev site through `web_release.py`. Preserve old hashes and independent files. Save release receipts and verify disabled green/white state in Codex iab, plus normal focus and mobile behavior.

This is a bounded correction; the authorized design needs no new product choice. Execute inline with GitNexus Work.
