# Supplier comments implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

Goal: apply and publish all nine comments. Spec: docs/superpowers/specs/2026-10-02-supplier-comments-design.md. Primer/Light only, existing tokens and dependencies. Continue codex/PROJ-145-audience-pages / PR #11, primary OP#PROJ-146.

## Task 1: Four directions and shared sections

Files: deployment/audience-pages/src/{audience-content.json,AudiencePage.tsx,intent.ts,Participation.tsx,intent.test.ts,audience.test.tsx}.
Contract: existing Intent adds design/construction/leasing; strict validation and labels retain legacy services. Existing onAction and onDemo interfaces stay intact.

- [x] RED: extend persistence tests for four supplier directions plus legacy services; verify each new card retains direction through handoff and final CTA, reject unknown directions.
- [x] Implement four cards and requested copy/removals; reuse RulesSection/DemoSection and company demo context.
- [x] GREEN: typecheck, lint, behavior suite, build/package, 3 deployment tests and Primer validation.
- [x] iab responsive and keyboard checks; compare standard sections with the live homepage.
- [x] Independent final review, fix material findings, commit PROJ-146 changes. Review: Critical 0 / Important 0 / Minor 0.

## Task 2: Publish and link

Files: evidence/supplier-comments.md and verification JSON. Interface: dist/site -> unchanged scripts/deploy.py.

- [ ] Upload and deploy with backup; verify every served file, homepage/gate and production hash.
- [ ] Verify published supplier page after reload in iab and save screenshot.
- [ ] Commit evidence, push all task commits, update/attach PR #11 and verify OpenProject GitHub links and remote head.
