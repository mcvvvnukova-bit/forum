# User profile implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Build the local read-only profile described by `docs/superpowers/specs/2026-10-05-user-profile-design.md`.

**Architecture:** A pure scope-aware adapter maps Sber userinfo into semantic read-only fields. Primer compositions render the profile; the app wrapper supplies fictional ready-state data. Component tests exercise the other page states. No backend calls or personal-data persistence.

**Tech Stack:** React 19.2.8, TypeScript 5.9.2, Primer React 38.37.0, Primitives 11.10.0, Octicons 19.33.0, Vite 8.2.2, Vitest 4.1.11.

## Global Constraints

- Work package PROJ-150, separate branch `codex/PROJ-150-user-profile`.
- Light-only Primer defaults; no inferred Forum branding.
- Local server binds 127.0.0.1:5190 with strictPort.
- All values are fictional; no real authentication or backend requests.
- Raw data cannot bypass approvedScopes.
- Ready/loading/error are distinct; no stale data in loading/error.
- GitHub draft PR and verified OpenProject link are required. The later explicit server-publication request authorizes the dev profile subtree described in Task 4.

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

### Task 2: browser comment refinements

**Files:** Modify `src/ProfilePage.tsx`, `src/App.tsx`, `src/layout.css`, `README.md`, `evidence/verification.md`, and the existing design specification.

**Interfaces:** Preserve the data adapter and ProfilePage props; reuse ProfileNavigation for desktop and mobile.

- [ ] Remove the seven annotated text/block targets; remove CSS and imports used only by the deleted preview controls and captions.
- [ ] Add a NavList divider followed by items «Настройки» (GearIcon) and «Добавить компанию» (OrganizationIcon). Use `inactiveText="Раздел пока недоступен"`; do not add routes or separate screens.
- [ ] Run the existing 12 tests, typecheck, lint, build and Primer validator. These reversible presentation changes require no new tests mirroring the markup.
- [ ] In iab verify all seven targets are absent, both new items appear on desktop and in the mobile menu, the profile anchors and Dialog focus still work, and no horizontal overflow appears at 320/768/1846 px. Capture the resulting page.
- [ ] Commit with PROJ-150, push, update PR №14 and verify its new head and persisted OpenProject relationship as user 8.

### Task 3: profile grouping and work page

**Files:** Modify `src/profile.ts`, `src/ProfilePage.tsx`, `src/ProfilePage.test.tsx`, `src/App.tsx`, `src/layout.css`, `README.md` and `evidence/verification.md`; create `src/App.test.tsx`.

**Interfaces:** `ProfilePage` gains optional `view: 'profile' | 'work'`, defaulting to profile. `App` selects work for exact pathname `/profile/work`. `ProfileSection` contains id, title and fields; the additional flag is removed because there is no collapsible group.

- [ ] Replace the obsolete disclosure test with initially visible document/address cards and the work link. Add behavior tests for previous name/marital status inside the personal card, and direct work URL displaying work data with a return link. Run npm test and observe the failures before implementation.
- [ ] Move previous_name and marital_status into personal; remove other. Preserve each field's scope and formatting.
- [ ] Render eight profile cards immediately. Remove showExtra, the toggle, enclosing extra-section and its unused CSS.
- [ ] Render only work on `/profile/work#main`; share the cabinet shell and data source notice. Add «Работа и образование» under «Мой профиль» in both navigation modes; use native links so reload and Back/Forward work.
- [ ] Run all tests, typecheck, lint, build and Primer validator. In iab verify direct work URL, return links, Back/Forward, title, keyboard/mobile menu, data placement and no horizontal overflow at 1626/768/320 px. Capture both pages.
- [ ] Commit with PROJ-150, push, update PR №14, attach it and verify the OpenProject relationship under user 8.

### Task 4: publish the approved profile to dev

**Files:** Modify `local-previews/user-profile/src/ProfilePage.tsx`, `src/App.test.tsx`, `README.md`, `evidence/verification.md` and the existing specification. Record public hashes in `evidence/server-release.json`.

**Interfaces:** Vite `import.meta.env.BASE_URL` controls profile-home links and the logo URL. The work route remains `/profile/work`. The existing gateway serves `/profile/` and `/profile/work` from the profile subtree, with its current dev-password protection.

- [ ] Add a failing component test with `vi.stubEnv('BASE_URL', '/profile/')`; on `/profile/work#main`, expect the personal link `/profile/#personal` and logo `/profile/assets/forum-logo.png`. Run `npm test` and observe the wrong root URL before implementation.
- [ ] Use BASE_URL for personal/header/logo URLs in ProfilePage and shared navigation. Run `npm test`, `npm run lint`, `npm run build -- --base=/profile/ --outDir=dist/server` and the Primer validator.
- [ ] Prepare the direct work entry: `mkdir -p dist/server/work` and `cp dist/server/index.html dist/server/work/index.html`. Hash the five static files and commit the source/docs before upload.
- [ ] Upload the built subtree through `ssh -o BindInterface=en0 forum-prod`; record protected-file hashes, preserve any existing profile directory in `/opt/outline/backups`, and replace only `/opt/outline/dev-astforum/landing/profile`. The existing gateway mount sees the new files without a restart. If verification fails, restore the profile backup or remove the newly created subtree.
- [ ] Authenticate with the existing dev password without printing secrets. Compare every static file with its local SHA-256 through origin and HTTPS; check the unauthenticated login screen and unchanged protected files. In iab verify both routes, direct reload, desktop/mobile navigation, logo and layout; capture the deployed pages.
- [ ] Record release evidence, commit with PROJ-150, push, update and attach PR №14, verify GitHub head and the OpenProject relationship under user 8.
