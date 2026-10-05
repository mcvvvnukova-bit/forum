# User profile implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Build the local read-only profile described by `docs/superpowers/specs/2026-10-05-user-profile-design.md`.

**Architecture:** A pure scope-aware adapter maps Sber userinfo into semantic read-only fields. Primer compositions render the profile; a separate demo wrapper selects fixtures and page states. No backend calls or personal-data persistence.

**Tech Stack:** React 19.2.8, TypeScript 5.9.2, Primer React 38.37.0, Primitives 11.10.0, Octicons 19.33.0, Vite 8.2.2, Vitest 4.1.11.

## Global Constraints

- Work package PROJ-150, separate branch `codex/PROJ-150-user-profile`.
- Light-only Primer defaults; no inferred Forum branding.
- Local server binds 127.0.0.1:5190 with strictPort.
- All values are fictional; no real authentication or backend requests.
- Raw data cannot bypass approvedScopes.
- Ready/loading/error are distinct; no stale data in loading/error.
- GitHub draft PR and verified OpenProject link are required; no web deployment.

### Task 1: data contract and profile UI

**Files:** Create `local-previews/user-profile/{package.json,package-lock.json,index.html,vite.config.ts,tsconfig.json,eslint.config.js,README.md}` and `src/{profile.ts,fixtures.ts,profile.test.ts,ProfilePage.tsx,ProfilePage.test.tsx,test-setup.ts,main.tsx,App.tsx,layout.css,vite-env.d.ts}`; copy the existing logo into `public/assets`.

**Interfaces:** `buildProfileSections(SberProfile, readonly string[]): ProfileSection[]`; `ProfilePage({profile,approvedScopes,state,onRetry})`.

- [ ] Write failing tests for absent fields, scope denial, false self-employment, priority document fallback, dates, and stale-data suppression. Run `npm test`; expect assertions to fail against empty adapter/UI shells.
- [ ] Implement optional userinfo keys from the official documentation, grouping them in the six main and four additional sections. Each field records its scope and its missing/not-requested state.
- [ ] Compose the page using Heading, Text, NavList, Label, Button, Link, Banner, Spinner and Dialog. CSS controls layout and semantic token roles only.
- [ ] Add ready/partial/loading/error fixtures in the demo wrapper and the separate preview controls.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the Primer validator. Expected: all pass.
- [ ] Inspect the local app in iab at desktop/tablet/mobile, test Dialog/Escape and section anchors; fix actual findings and record evidence in README.
- [ ] Commit only this application's files and the spec/plan with PROJ-150 in the message; push, create a draft PR, attach it, and verify the OpenProject GitHub relationship.
