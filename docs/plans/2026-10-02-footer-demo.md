# Footer Demo Implementation Plan

Исторический технический план от 2026-10-02. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Продуктовое содержание и точный исторический оригинал: [источник в Outline](https://docs.astforum.ru/doc/istochnik-06102026-2026-10-02-footer-demo-7069cb54-cx5f5V8zXf).

Действующие требования: [PUB.01.01: Главная страница и сценарии работы](https://docs.astforum.ru/doc/pub0101-glavnaya-stranica-i-scenarii-raboty-nL3XeqEBBB).

Происхождение: `docs/superpowers/plans/2026-10-02-footer-demo.md`, SHA-256 `7069cb54f9ef33109f06a4d282b71d881a0c435890bc5996082f303c130a815f`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Apply both customer comments and publish dev revision.
**Architecture:** Reuse Primer Link/button and existing App.openDemo/DemoDialog focus contract; conditionally remove the customer final secondary button. No new components.
**Tech Stack:** Existing React 19, Primer 38.37.0, Primitives 11.10.0, Vite/Vitest.

## Global Constraints

Spec: docs/superpowers/specs/2026-10-02-footer-demo-design.md. Primer and Forum Light only, no token-value/dependency changes. Footer action font uses existing BaseStyles/system semantic token. Existing isolated worktree/branch/PR reused. Main task OP#PROJ-145 verified under user 8. Publish audience routes/assets only with backup; preserve root homepage/gate/production.

### Task 1: UI and publication

Modify deployment/audience-pages/src/{AudiencePage.tsx,SharedLayout.tsx,App.tsx,layout.css}; create evidence/footer-demo.md and verification JSON.
Interface: SiteFooter({onDemo:(trigger:HTMLButtonElement)=>void}); App supplies its existing callback and path-derived company audience.

- [x] In AudiencePage wrap the final demo Button in `!isCustomer`; keep order CTA and standard demo.
- [x] In SiteFooter add Primer `Link as="button" type="button" muted onClick={event=>onDemo(event.currentTarget)}` after participant links; set footer nav Stack align=start.
- [x] App supplies `trigger=>openDemo(trigger,path==='/customers/'?'Заказчик':path==='/suppliers/'?'Компания-исполнитель':undefined)`.
- [x] Run typecheck/lint/25 existing tests/build/package, deployment tests, Primer validator. No new low-impact/mirror tests per developer instruction.
- [x] iab: final customer block has only order action; footer item opens demo on Enter/Space, Escape returns focus; contexts correct on customer/supplier, generic on work; widths1679/768/390/320 fit. One independent final review (0 findings); browser-detected font mismatch corrected with existing Primer token and manually rechecked.
- [x] Commit PROJ-145 changes; upload/deploy with backup; verify served hashes/root/gate/production and live iab screenshot.
- [x] Push, update/attach PR11, verify OP GitHub links and local/remote/PR head equality; commit evidence and complete checklist. Equality checked after final evidence push.
