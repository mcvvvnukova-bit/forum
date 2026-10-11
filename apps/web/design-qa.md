# PROJ-170 — login variant 1 Design QA

final result: passed

## Comparison target and evidence

- Exact source: first displayed generated image from `codex://threads/01a1227a-f631-7ea2-b538-7632cb3021e9`, result `exec-8c16d00a-9921-4442-9f9b-b367a72b11c4.png`.
- Source raster: 1598 × 984. Source dialog crop: `(333, 270)–(1268, 748)`, normalized to 480 × 245 for the selected brief's 440–480 px desktop window.
- Implementation: actual `apps/web` public application, `http://127.0.0.1:5188/`, guest login modal, Primer Light. Desktop IAB viewport: 1312 × 808 CSS px; screenshots: 1312 × 808 pixels. Finished desktop dialog: 480 × 236 px, with no transform/opacity animation in the comparison capture.
- Combined full-page and focused comparisons were opened and reviewed. Full-page source was resized to the implementation viewport; focused crops normalized the dialog scale. Existing product landing content is intentionally retained: the request concerns the foreground window.
- Local capture directory: `/Users/vvv/.codex/visualizations/2026/10/11/01a12bf0-4d9c-77f3-8b71-c942eabd5004/login-option-1/evidence/`.
- Evidence: `comparison-full.jpg`, `comparison-dialog.jpg`, `desktop.jpg`, `desktop-cdp.png`, `mobile-320.jpg`, `viewport-320.jpg`, `viewport-390.jpg`, `viewport-768.jpg`, `viewport-1312.jpg`, `session-error-320.jpg`, `layout-checks.json`.

## Findings and iteration

Initial capture was blocked: Primer Stack's default `padding="none"` overrode the custom header padding, and the existing large title token rendered a 32 px heading. The title and button did not share a left edge. Fixed using Stack's documented `padding="spacious"`, `justify="space-between"` and `gap="normal"`, plus a title size composed from existing Primer tokens. New captures and combined comparisons show aligned 24 px edges and compact hierarchy. No P0/P1/P2 findings remain.

## Required fidelity surfaces

| Surface | Verified result |
| --- | --- |
| Fonts and typography | System Primer heading 24 px / 36 px on desktop; 20 px / 32.5 px at 320/390 px. Supporting paragraph 16 px / 24 px. Existing Noto Sans condensed bold 19 px Sber label retained. No clipping or truncation. |
| Spacing and layout | Header, button and paragraph share 24 px content edges. Desktop button fills 432 px inner width, height 56 px. No separate header band or divider. Primer surface, shadow and radius retained. |
| Colors and tokens | Neutral Primer Light dialog and muted paragraph. Existing provider tokens retained: computed button rest `rgb(33, 160, 56)`, hover `rgb(30, 144, 50)`, white label. No new Forum mappings. Generated gradients are intentionally not substituted for existing approved provider tokens. |
| Image quality and assets | Existing Sber SVG retains proportions at 28 × 28 px; Octicons close control and existing landing artwork are reused. No substitute assets or new generated artwork. |
| Copy and content | Exact selected heading and button labels. Exact shorter explanation below the button: «Нет аккаунта? Он будет создан автоматически после входа.» No additional providers or registration controls. |

## Responsive and interaction evidence

- IAB widths 320, 390, 768, 1312 px: no document horizontal overflow. Dialog width 288, 358, 480, 480 px respectively; full-width button remains usable.
- Desktop and narrow error states: unavailable session disables Sber and exposes Retry. Switching the local session fixture back to guest and pressing Retry restores the enabled button and removes the error.
- Callback `sber_unavailable` keeps Sber disabled and exposes the demo link. Callback `account_deactivated` displays the support dialog without a Sber action.
- Tab and Shift+Tab remain inside the dialog; Escape and close remove it and restore the public URL. Clicking the opener, then closing, restores focus to the same login link. Reload preserves the modal and public background; after reload the existing fallback focuses a public-header link.
- ARIA label and description ids resolve to rendered elements. Close has an accessible name; the alert/status output is present in browser DOM snapshots. Keyboard focus remains visible.
- Actual button click navigates to `/auth/sber-id/start?intent=login`. A local preview fixture confirms this URL; no real Sber login is claimed. Duplicate click protection, redirecting status, checking/authenticated/error states remain covered by existing behavioral tests.
- Browser developer logs before injected error fixtures contained no errors. The fixtures are outside the repository and are used only by local preview.

## Validation

- Web: 118/118 tests; public composition: 44/44 tests; Primer policy: 25/25 tests.
- Web typecheck, ESLint and production build pass.
- Ownership regressions: 222/222 pass. CI selection/cache/ownership regressions: 13/13 pass in the clean candidate checkout; its real-root check is affected by the ignored retired directory in the primary workspace.
- Repository Primer semantic validator passes. Upstream generic validator: default invocation reports three existing provider-color literals in `sber-tokens.css`; explicit accepted token bridges for the two Forum files and Sber file yield zero errors and 85 retained advisories. The policy snapshot is updated by four advisories from the compact composition; no detection rule or assertion was removed.
- Local operational validation encounters the existing ignored `apps/legacy-landing` directory. The exact candidate files pass operational validation in a clean managed checkout: 354 provenance entries and all Compose/Caddy/template/resource/syntax checks. The ignored local directory remains intact. A bounded PROJ-170 ownership successor preserves every historical receipt; its ten tampering cases pass.
- No new brand mapping was introduced. Live Figma branding verification and real Sber authentication are outside this presentation change.

## Follow-up polish

- P3: system font metrics produce a slightly different paragraph line break from the generated raster. Natural wrapping is retained for accessibility and responsive behavior.
- P3: Primer's standard close icon is visually smaller than the generated sketch, while retaining the existing accessible control and keyboard operation.

## Implementation checklist

- [x] Exact selected visual resolved and opened.
- [x] Final full-view and focused combined comparisons reviewed.
- [x] Initial layout mismatch fixed and recaptured.
- [x] Desktop, tablet, phone, keyboard and error states verified.
- [x] No actionable P0/P1/P2 findings remain.
