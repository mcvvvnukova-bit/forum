# Work and supplier review implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Apply25 review comments and publish both dev builds.
**Architecture:** Existing Primer Card/Stack composition, common FinalAction and shared personal intent contract; two generated static illustrations.
**Tech stack:** Existing React19/Primer38/Vite8/Vitest4; Python deployment scripts.

## Global constraints

Spec: docs/superpowers/specs/2026-10-02-work-review-design.md. Keep Forum Light mappings/dependencies/auth URLs; no production changes. Worktree audience-pages / PR11 taskPROJ-147/146; managed homepage-review continuing PROJ-144 / PR12. The user directly authorizes these corrections/publication. One fresh final reviewer across both deltas.

### Task 1: Audience changes and illustrations

Files: deployment/audience-pages/src/{WorkPage,PageSections,AudiencePage,SharedLayout,Participation}.tsx, audience-content.json, layout.css, intent.ts; existing audience/intent/resume tests and public/audience-assets/resume.js; media/work-{order,vacancy}-interface-v1.png.
Interfaces: Intent.action gains find-jobs/find-work; validIntent and callback guard agree on exact direction/action tuples. WorkPage forwards selected format. FinalAction(title,description,label,onAction) composes the existing customer CTA.

- [ ] Adapt obsolete vacancy/header tests and add individual-intent roundtrip/tampering and callback cases. RED: expected missing correct direction/new label.
- [ ] Implement three exact personal tuples; jobs participation label; general five work steps; exact FAQs/removals; merged skills/order section and active vacancy section; reused final CTA and shared chrome. Copy two built-in-generated PNGs into media, retain transparent alpha, add accessible text equivalents. Expected: both choices route correctly and old “soon” unavailable work copy disappears.
- [ ] npm run typecheck/lint/test/build; node scripts/package-site.mjs; Python deployment3tests; Primer validator. Expected all pass except documented existing allowed token warnings/build warnings. IAB responsive1679/768/390/320, keyboard actions and storage/reload, FAQ and images/footer/nav.
- [ ] Commit PROJ-147/146 with only intended files; record evidence.

### Task 2: Keep homepage chrome consistent

Files: clean homepage-review deployment/primer-home/src/{SharedLayout.tsx,layout.css}; evidence/work-review.md/JSON.
Interfaces: same /#rules nav label, same measured logo offset; staged dist/index retains the existing audience-pages resume marker before unchanged deploy-dev-home.py consumes it.

- [ ] Rename homepage nav and extend measured brand offset to footer. Run typecheck/lint/tests/build:dev and Primer validator; existing deploy tests. Expected no regression.
- [ ] Commit PROJ-144. One fresh final review of both current deltas and public intent integration; resolve important findings with meaningful tests.
- [ ] Stage unique release dirs. Publish audience routes/assets with backup; package homepage dist with existing callback marker and publish root/assets with backup. Verify actual hashes for all files, gateway/health, protected server fingerprints, production hash. IAB reopen and inspect live examples/FAQ/CTA/chrome; save screenshots.
- [ ] Commit evidence, push both branches, update/attach PR11/12 with all OP refs, verify OpenProject Github links underKuzmina and local/remote/PR heads. Mark plan complete and remove only this plan's scratch.
