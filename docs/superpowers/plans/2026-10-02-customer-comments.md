# Customer comments implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Apply and publish all ten customer-page comments, matching the live homepage header/rules/demo.
**Architecture:** Reuse Primer standard sections across local homepage and customer page; keep business intent handling and existing Dialog unchanged. Shared header/footer fixes apply to all audience routes.
**Tech Stack:** Existing React 19, Primer 38.37.0, Primitives 11.10.0, Octicons, Vite and Vitest.

## Global Constraints

- Spec: docs/superpowers/specs/2026-10-02-customer-comments-design.md; user-requested wording supersedes original snapshots.
- Primer only, Light only, existing Forum aliases unchanged; no dependency changes.
- Continue branch codex/PROJ-145-audience-pages / PR #11, OP#PROJ-145/146/147/29 verified under Кузьмина.
- Publish only audience routes/assets with backup; preserve current root homepage and access gate.

### Task 1: Copy and compose the requested UI

Files: src/SharedLayout.tsx, App.tsx, config.ts, audience-content.json, AudiencePage.tsx, PageSections.tsx, HomePage.tsx, layout.css; create src/StandardSections.tsx.
Interfaces: RulesSection(); DemoSection({onDemo:(trigger:HTMLButtonElement)=>void}); PageHero title accepts ReactNode. Existing Intent/onAction/onDemo signatures unchanged.

- [x] Reuse shared header without authorization label; config login becomes actual homepage URL, href explanation `/#rules`; footer links wrapped in Primer Text size small.
- [x] Update four exact customer strings; add desktop br before «для» through ReactNode title and breakpoint CSS.
- [x] Extract unchanged homepage rules and demo compositions into StandardSections; customer rules use RulesSection and DemoSection follows comparison.
- [x] Customer final Card uses semantic muted background and responsive horizontal/vertical Stack; keep both existing actions.
- [x] Run typecheck, lint, existing 18 tests, build, Primer validator. Expected: exit 0, no errors. Manual text/style checks in iab substitute new tests mirroring literals/layout, per developer instruction.
- [x] iab desktop/mobile/tablet: all ten comments, demo Dialog keyboard/return focus, no overflow, equal legal/copyright font. Constant header independence from session verified in source/review; current session anonymous, no new login created.
- [x] Independent review of delta from 2d089eb. Expected: no unresolved material findings; commit all intended files with PROJ IDs.

### Task 2: Publish and verify

Files: evidence/customer-comments.md and server result evidence; scripts/package-site.mjs/deploy.py used unchanged.
Interfaces: dist/site -> existing deployment script; release upload path unique for this revision.

- [x] Package, upload, deploy with backup. Expected: files served match build hashes, root differs only by resume marker if missing.
- [x] Inspect published customer page and shared header/footer on suppliers/work in iab; save screenshots. Expected: comments persist after reload.
- [x] Push code/evidence commits, update PR #11 body, attach and recheck four GitHub tabs. Four tabs and attachment verified; remote head verification is the final completion check.
