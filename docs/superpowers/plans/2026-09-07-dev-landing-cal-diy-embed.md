# Cal.diy Demo Embed Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the implementation/review task. The site-owning controller performs VPS publication and browser verification. User has approved the design and written specification and explicitly requested deployment to the existing VPS.

**Goal:** Clicking «Выбрать время» on dev.astforum.ru opens the native Cal.diy booking popup for demo/60min.

**Architecture:** Keep the existing Primer link button and isolate the self-hosted embed initialization in a small React module. Use the official React embed wrapper with an explicit self-hosted script and origin; retain a public booking link for loading failures. Extend the auth gateway CSP only for the Cal.diy origin.

**Tech Stack:** React 19, TypeScript, Primer, Vite, Vitest, Python auth gateway, Caddy, VPS forum-prod.

**Spec:** `docs/superpowers/specs/2026-09-07-dev-landing-cal-diy-embed-design.md` (approved by user).

**Status:** Completed and deployed on 2026-09-07. Implementation commits: `c153162`, `29eb224`. All tasks below were completed; detailed execution evidence is recorded in the task ledger.

## Global Constraints

- Landing: `https://dev.astforum.ru`.
- Booking URL: `https://cal.astforum.ru/demo/60min`; `calLink: "demo/60min"`; namespace `60min`; eventId 3 is informational, not the embed URL.
- Embed script: `https://cal.astforum.ru/embed/embed.js`; origin: `https://cal.astforum.ru`.
- Native popup, no custom modal and no new UI system. Preserve the current Primer button classes and all landing layout/theme styles. Use Light for the embed.
- Header/hero demo links still point to `#demo`; only «Выбрать время» opens the booking popup.
- Load the script once, handle first click while loading, avoid duplicate initialization/popups, and leave a public-link fallback on failure. Modified link clicks retain normal browser navigation.
- Keep passwords, sessions, noindex, and other gateway security headers unchanged. No wildcards or unsafe-eval in CSP.
- Do not modify Cal.diy, event settings, SMTP, Bitrix/Yandex, other VPS services, or unrelated local edits. Do not create a real booking during verification.

## Task 1: Embed integration and tests

**Files:**
- Create: `deployment/dev-landing/src/landing/cal-diy-embed.ts` and focused tests.
- Modify: `deployment/dev-landing/src/landing/LandingApp.tsx`, `LandingApp.test.tsx`, `package.json`, `package-lock.json`.
- Modify: `deployment/dev-landing/auth-gateway/forum_dev_auth.py`, `tests/test_auth_gateway.py`, and README integration notes.

**Interfaces:** Export a small loader/open API consumed by the existing button. `@calcom/embed-react@1.5.3` was verified to support React 19. The wrapper's `getCalApi` can resolve to a queued API before the remote script loads: readiness/failure must not be inferred from that promise alone. Inspect the installed fork's embed source as the primary API reference.

- [x] Add focused failing tests for real landing-button behavior (correct fallback href, standard click intercepted, modified click preserved) and loader lifecycle (deduplicated script/init, correct namespace/origin/modal payload, actual script load/error or timeout). Mock only the external SDK/network boundary.

```tsx
const link = screen.getByRole('link', {name: 'Выбрать время'})
expect(link).toHaveAttribute('href', 'https://cal.astforum.ru/demo/60min')
fireEvent.click(link)
// Assert the consumer boundary receives modal + demo/60min + the self-hosted origin.
```

- [x] Add a failing gateway HTTP-response test asserting CSP permits this exact origin in script-src, frame-src, and connect-src while keeping default-src self, object-src none, and frame-ancestors none. Test the response, not source text.
- [x] Run focused tests and record expected RED failures before implementation.
- [x] Implement the scoped module/button wiring. Use the official API shape:

```ts
const cal = await getCalApi({namespace: '60min', embedJsUrl: 'https://cal.astforum.ru/embed/embed.js'})
cal('init', {origin: 'https://cal.astforum.ru'})
cal('ui', {theme: 'light', layout: 'month_view'})
cal('modal', {calLink: 'demo/60min', calOrigin: 'https://cal.astforum.ru', config: {layout: 'month_view'}})
```

Wait for script readiness (with bounded error handling) before treating the SDK as usable. The example specifies API arguments, not the complete error-handling implementation. Preserve the real href and use event handling rather than data-cal-link auto-click interception, to avoid duplicate dispatch.

- [x] Extend only the three CSP directives with `https://cal.astforum.ru`. Keep all other directives and auth behavior intact.
- [x] Run `npm run test:frontend`, `npm run test:gateway`, `npm run typecheck`, and `npm run build`; report exact results and any baseline warnings. Run the Primer validator; preserve existing styling and record pre-existing violations separately.
- [x] Review scoped changes for spec compliance and code quality. Retain a before/after package because the landing package is initially untracked in the outer repository. Commit only task files, never unrelated user changes or runtime secrets.

## Task 2: Owner verification and publication

**Files:** Built `deployment/dev-landing/dist/site/landing`; gateway script; a scoped temporary installation script and verification evidence under the task's artifacts directory.

- [x] Verify current VPS paths and compare the gateway hash to local baseline before overwriting. Current mounts are `/opt/outline/dev-astforum` and `/opt/outline/dev-landing-auth`; only `outline-dev_landing_auth-1` needs restart if gateway code changes. Avoid the broad existing deploy.sh because it rewrites shared Compose/Caddy configuration.
- [x] Run existing layout tests. Inspect the popup in a browser at desktop and mobile sizes; close/reopen it, check keyboard operation and no navigation away from the landing. Do not submit a booking.
- [x] Stage the exact validated landing output and gateway through a temporary directory on forum-prod. Make a recoverable backup of only the current dev landing and gateway; preserve authentication secrets and shared proxy configuration.
- [x] Copy static assets into the existing bind-mounted directories without changing directory identity, update only the gateway script, and restart only `outline-dev_landing_auth-1`.
- [x] Verify auth/noindex protections, new bundle and CSP over public HTTPS, popup behavior after normal dev-site login, and health of cal.astforum.ru and unrelated sites.
- [x] Report the working dev URL and the button behavior, with any genuinely unverified limitations.

## Deployment verification

- Public authenticated Chrome check: desktop 1440×1100, tablet 768×1024, mobile 390×844; slots load, native popup opens/closes/reopens, repeated Enter does not stack popups, no browser errors. No booking submitted.
- Final suite: frontend 10 tests, gateway 9 tests, two layout checks, typecheck and production build passed. Primer validation passed.
- Only dev landing HTML/assets and gateway script updated. Password/session secrets, Caddy and Compose hashes unchanged. Only dev gateway restarted; Cal.diy and neighboring services remained healthy.
- Recoverable server backup: `/opt/outline/backups/dev-cal-embed.QiFLku` (previous landing and gateway only).
- Final landing index SHA256: `260ad63f8c8d0ef92075c810eebfff14f6bd1ab3b4243b96db5acdacd42d48f7`.
- Final gateway SHA256: `661eeb2f4967314170cbd5496fef60c51458e5eecf75164f80210ff264633b41`.
