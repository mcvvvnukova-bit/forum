# Shared Demo Section Implementation Plan

Исторический технический план от 2026-10-01. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-shared-demo-section-implementation-plan-375db5a0-EzCFuZvhnj).

Происхождение: `docs/superpowers/plans/2026-10-01-shared-demo.md`, SHA-256 `375db5a01dcd85299d801c8240fc57e13cd68f5a11cac801335a44008c17b5ea`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** Execute in this session. Preserve the existing dirty workspace; no subagents, commits, or broad cleanup.

**Goal:** Use the homepage demo section on the customer page through one reusable component.

**Architecture:** Extract the existing Primer composition into `src/shared/DemoSection.tsx` and its responsive rules into `demo-section.css`. Keep page-specific booking intent in `CustomerLanding` and preserve the homepage defaults.

**Tech Stack:** React 19, TypeScript, Primer React 38, Vite 8, Vitest, Codex IAB.

## Global Constraints

- Match the current `https://dev.astforum.ru/#demo` appearance and copy.
- Keep the customer audience, notes, fallback booking URL, and session intent.
- Reuse the existing brand tokens and Primer Light. Do not add dependencies.
- Use only IAB for browser checks. The existing layout script launches external Chromium and is replaced by equivalent IAB checks for this task.
- Publish static resources only, retain old hashed assets, and back up current HTML/resources.

### Task 1: Extract and reuse the demo section

**Files:** Create `deployment/dev-landing/src/shared/DemoSection.tsx`, `demo-section.css`; modify `src/landing/LandingApp.tsx`, `landing-screen.css`, `landing-screen.test.tsx`, `src/customers/CustomerLanding.tsx`, `customer-screen.css`, `CustomerLanding.test.tsx`.

**Interfaces:** `DemoSection({bookingUrl = BOOKING_URL, onBookingClick = onDemoBookingClick}: {bookingUrl?: string; onBookingClick?: MouseEventHandler<HTMLAnchorElement>})`. The customer handler continues to call `openDemoBooking({notes: customerDemoNotes, audience: 'Заказчик'})` and `preserveCustomerIntent()`.

- [x] Update the customer test to find the named public demo region and its `Выбрать время` link. Keep literal audience/notes assertions. Verify homepage public booking URL in its existing render test.

```tsx
const demo = screen.getByRole('region', {name: 'Посмотрите «Форум» в работе'})
const url = new URL(within(demo).getByRole('link', {name: 'Выбрать время'}).getAttribute('href')!)
expect(url.searchParams.get('audience')).toBe('Заказчик')
```

- [x] Run `npm run test:frontend`. Expected: customer demo region test fails because the compact row has no region.
- [x] Move original section JSX and CSS to shared files, including breakpoints 1180/640. Replace the homepage section with `<DemoSection />`. Replace the customer row with `<DemoSection bookingUrl={customerDemoUrl} onBookingClick={onCustomerDemoClick} />` after the final CTA. Share the existing customer click handler with dialog links.
- [x] Run `npm run test:frontend` and `npm run typecheck`. Expected: all tests pass and TypeScript exits 0.

### Task 2: Verify and publish

**Files:** `artifacts/frontend/2026-10-01-shared-demo/verification.md`, screenshots, validator JSON. Build outputs and deployed landing static files.

**Interfaces:** Generated `dist/site/landing/index.html`, `customers/index.html`, `landing-assets/`.

- [x] Run `npm run build` and the Primer validator. Expected: build exits 0; new shared/customer code has no findings, existing project findings reported separately.
- [x] Serve build locally and compare both demo sections at 1440/768/390 through IAB: same copy, card size, styles, and button; no horizontal overflow.
- [x] Check booking popup parameters and keyboard activation; do not create a booking.
- [x] Back up `/opt/outline/dev-astforum/landing`, copy new hashed assets and atomically replace both HTML entries through SSH `forum-prod`.
- [x] Reload live pages, verify styles and booking context, save desktop/mobile screenshots and verification report. Expected: requested public section is present on both routes.
