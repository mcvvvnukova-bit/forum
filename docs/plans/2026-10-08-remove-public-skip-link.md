# Remove Public Skip Link Implementation Plan

**Goal:** Remove «Перейти к содержанию» from the shared public headers on dev.astforum.ru, as directly requested by the owner.

**Architecture:** Delete the single skip-link JSX line from both existing SiteHeader variants and their unused CSS selectors. Preserve the remaining Primer links, main landmark, navigation, single /login form and current Sber button tokens.

**Tech Stack:** React 19, Primer React 38.37.0, CSS, Vitest, Node 24.18.1, existing atomic web publisher.

## Scope and acceptance

- Work package [PROJ-159](https://roadmap.astforum.ru/work_packages/PROJ-159/activity); parent OP#PROJ-29; actor Кузьмина (OpenProject API user 8).
- Approved design is the owner's explicit request to remove this existing link. No new product decision is needed.
- Modify only apps/web/src/home/SharedLayout.tsx, apps/web/src/audience/SharedLayout.tsx and the two adjacent layout.css files, plus the required exact-path source ownership successor.
- Keep the separate profile-preview fixture and legacy/production content outside this public dev change.
- Start from the latest published PROJ-158 SHA 069932594b6c1b19c7e0d4e28f8fd821f717029e; preserve its Sber disabled-state fix.

## Implementation and verification

1. Verify clean baseline and current GitNexus graph; query/context/trace both SiteHeader paths and check upstream impact. Delete `<Link className="skip-link" href="#main">Перейти к содержанию</Link>` from both variants. Remove only `.skip-link` and `.skip-link:focus` CSS rules from their layout.css files.
2. Preserve all historical receipts. Add a PROJ-159 exact-path ownership layer for those four UI files and the ownership checker/test, pinning the exact previous SHA and file hashes. Extend existing meaningful tamper regressions for hash, predecessor, scope, path, duplicate, base, mode and source corruption.
3. Run existing web tests, composition tests, typecheck/lint/build, Primer gate, source/layout checks and ownership regressions. This small reversible removal needs no new UI test that merely mirrors deleted JSX; inspect actual focus/DOM behavior in Codex iab.
4. Review the diff, run GitNexus staged detection, commit with PROJ-159, push and create/attach a PR against codex/PROJ-158-sber-button-state with OP#PROJ-159 and OP#PROJ-29; verify both GitHub tab links.
5. Wait for successful exact-head CI. Publish its exact artifact only to dev using web_release.py, fresh private backup/runtime inventory and atomic rollback verification. Match artifact/deployed/origin/public HTTPS hashes; preserve old hashes and independent bytes.
6. Reload real public routes in Codex iab at desktop/mobile and check the link is absent even after Tab, navigation and /login remain functional. Save screenshot and release receipts, update/reopen the OpenProject task and report the dev result.

Execute inline with GitNexus Work. Review covers the narrow markup/CSS removal and exact-path provenance validation.
