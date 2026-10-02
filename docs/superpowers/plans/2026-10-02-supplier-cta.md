# Supplier CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Rename four supplier card buttons and align them per row, then publish dev revision.
**Architecture:** Existing Primer Card/Stack composition; reuse the audience-card flexible row layout and existing intent contracts.
**Tech Stack:** Existing React/Primer/Vite/Vitest app.

## Global Constraints

Spec: docs/superpowers/specs/2026-10-02-supplier-cta-design.md. Primer/Forum Light only, no token-value or dependency changes, no fixed heights. Continue codex/PROJ-145-audience-pages / PR11; primary OP#PROJ-146. Existing tests adapted, no new mirror tests. Publish only owned audience package with backup; preserve root/gate/production.

### Task 1: Correct and publish card actions

Files: deployment/audience-pages/src/{AudiencePage.tsx,audience-content.json,layout.css,audience.test.tsx}; evidence/supplier-cta.md and JSON.
Interfaces: existing per-card direction/onAction, intent validation/storage and final CTA unchanged; dist/site consumed by unchanged deploy.py.

- [x] Adapt existing goods and three-direction tests to `within(card).getByRole('button',{name:'Приступить к работе'})`, finding each card through its heading; run and observe four expected failures.
- [x] All four JSON action strings become «Приступить к работе»; supplier Card className=audience-card; extend existing flexible row rule to `.two-columns > .audience-card`.
- [x] Run typecheck/lint/25tests/build/package, 3 deployment tests, Primer validator; iab compare paired button top coordinates at1679/768, no overflow at390/320, correct directions on keyboard handoff. One independent review.
- [x] Commit PROJ-146, stage/deploy with backup, verify all served hashes/root/gate/production; inspect fresh page and save live screenshot.
- [ ] Commit evidence, push/update/attach PR11, verify OP GitHub links and remote/local/PR HEAD equality.
