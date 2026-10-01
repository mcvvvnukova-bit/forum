# Audience pages implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline. Steps use checkbox tracking.

**Goal:** Publish /customers/, /suppliers/, /work/ on dev.astforum.ru from the accepted Primer homepage.
**Architecture:** Independent Vite app shares Primer header/footer/hero/cards/FAQ/demo. Verbatim content from Outline snapshots; actions preserve intent and lead to explicit account/context handoff.
**Tech Stack:** React 19.2.8, Primer React 38.37.0, Primitives 11.10.0, Octicons 19.33.0, TypeScript, Vite, Vitest.

## Global Constraints

- Spec: docs/superpowers/specs/2026-10-02-audience-pages.md; snapshots in deployment/audience-pages/requirements.
- Light only, semantic tokens, official Primer. Preserve homepage and dev access gate.
- PROJ-145, PROJ-146, PROJ-147; parent PROJ-29.

### Task 1: Audience content and interactions

Files: src/AudiencePage.tsx, WorkPage.tsx, audience-content.ts, App.tsx, SharedLayout.tsx, layout.css, audience.test.tsx.
Interfaces: AudiencePage({kind:'customers'|'suppliers',onAction:(intent:Intent)=>void,onDemo:(trigger:HTMLButtonElement,audience:string)=>void}); WorkPage({onAction}); Intent={audience,action,direction?,returnTo}.

- [x] Write tests for equal initial work branches, scenario filtering, soon state blocking vacancy CTA, direction passed to action; catches wrong default, stale branch or dropped direction.
- [x] Run `npm test`; Expected: fail because current App renders destination previews and has no branch controls.
- [x] Implement sections with existing Primer, state and explicit demo labels. Navigation to local steps.
- [x] Run `npm test`; Expected: pass.

### Task 2: Intent handoff and demo

Files: src/intent.ts, ParticipationPage.tsx, use-session.ts, DemoDialog.tsx, App.tsx, intent.test.ts, public/audience-assets/resume.js.
Interfaces: saveIntent(intent), readIntent():Intent|null; validate before local navigation; real session never grants roles.

- [x] Tests: specialization survives revisit, corrupt/external return URL rejected, company cannot silently enter personal work, callback resume only to safe route.
- [x] Run tests; Expected: fail contract assertions before implementation.
- [x] Implement validation, session fetch, honest next-step screen/Sber link/callback resume; keep intent on error. Demo audience in Cal.diy query.
- [x] Run `npm test`; Expected: green suite.

### Task 3: Verify and publish

Files: scripts/package-site.mjs, scripts/deploy.py, README.md, evidence/verification.md.
Interfaces: package-site copies build HTML to supported routes; deploy backs up those routes/assets and appends marker-delimited resume script to homepage.

- [x] Run typecheck, lint, tests, build, Primer validator; Expected: exit 0.
- [x] Codex iab: 320/390/768/1440, keyboard/focus, FAQ, branches, intent.
- [x] Review branch; commit intended paths; push and PR with OP#PROJ-145/146/147/29.
- [x] Deploy audience assets/routes with rollback; served build hashes/rendered pages behind existing dev access. Homepage differs only by resume marker; astforum.ru hash unchanged.
- [x] Verify four GitHub tabs, attach PR, record external workflow limitations.
