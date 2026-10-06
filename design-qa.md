# PROJ-147 — work carousel direction 2 QA

Source visual truth: `/Users/vvv/.codex/generated_images/01a0f97e-a15f-7b00-9a6b-7abd903cd5c4/exec-fc8a51a9-1ba6-4b75-aef8-2d0d19897e47.png` (2046×768 pixels).
Implementation: http://127.0.0.1:5191/work/#skills; `deployment/audience-pages/evidence/work-skills-local-desktop.png` (1608×749); normalized region `work-skills-local-orders.png` (1120×461).
Viewport: 1608×749 CSS px, deviceScaleFactor1; explicit CDP clip in CSS coordinates avoids the native Retina screenshot scaling. Source content crop (100,110)-(1910,720) normalized to1120px; implementation section cropped from viewport. White source canvas padding is excluded. Theme Light; current slide1 orders; no modal/hover/focus tooltip.

Full-view comparison evidence: `deployment/audience-pages/evidence/work-skills-design-comparison.png`, source and rendered implementation in one input. Both are opened and compared. Text hierarchy, left alignment, right illustration, controls below copy are present. No full-width heading remains.
Focused region: full normalized comparison makes all text, controls, tile illustration and interface details readable; no additional magnification required. Slide2 uses the same composition and exact approved jobs copy, original vacancy illustration.

## Findings

No remaining actionable P0/P1/P2 differences.

- Fonts/typography: current Primer system font stack, h2 large32px/48px, h3 medium20px/32.5px, text large16px/24px. Heading wraps into two lines on desktop without truncation. Mock uses a larger/tighter display scale; adapting it to existing Primer typography is an explicit project constraint. Keep current token scale.
- Spacing/layout: existing1120px container, equal548px columns,24px gap, centered cross-axis. Primer nested Stack normal16/spacious24 spacing. One column at390/320; two at768/1608. Whitespace differs from source canvas intentionally due existing section padding. All left-column text and controls aligned.
- Colors/tokens: existing Light fgColor-default/muted and bgColor-default; Primer buttons/Octicons. Orange is in existing illustration, unchanged. No hard-coded color/type rules introduced.
- Image quality: original1536×1024 order/vacancy assets loaded, sharp at548px. Subject and intended interface art match; asset bytes unchanged. Source generated variation has different window proportions; retaining approved existing artwork takes precedence. No visible caption, native facts remain accessible.
- Copy/content: exact shared heading/subtitle and both h3/body texts match approved spec. One current slide has five accessible facts. Both format buttons open the real existing registration dialog with matching context and return focus.

## Comparison history

1. Initial desktop composition matches direction2. At390px, controls measured40×32 because moving them inside .two-columns exposed the existing mobile button rule. [P2] Controls should retain Primer large40×40. Fix: scoped `.two-columns.example-layout button { min-height: var(--base-size-40); }`.
2. Post-fix at390/320: both controls40×40; no horizontal overflow. Keyboard Enter/Space cycles slide; focus remains on the same button. Desktop source/render comparison remains consistent. Evidence: `work-skills-browser-measures.json`, `work-skills-local-mobile.png`, `work-skills-design-comparison.png`.

A stale tooltip extended past mobile bounds when resizing a focused desktop control; fresh route and fresh mobile focus have no overflow. No page content/style fix is needed for that testing state.

## Implementation checklist

- [x] Shared left heading/subtitle; active h3/body; right original illustration.
- [x] Controls below text, stable focus and live counter.
- [x]1608/768/390/320 responsive dimensions; hashes; both auth dialog contexts.
- [x] Console error log checked: none.
- [x]37 existing behavior tests, typecheck/lint/build/package and4 deployment tests pass.
- [x] No actionable P0/P1/P2 issues remain.

Residual test gaps: full VoiceOver, actual Sber login and backend employment/search are outside this public layout/copy change.

## Published follow-up

Live URL: https://dev.astforum.ru/work/#skills. Evidence `deployment/audience-pages/evidence/work-skills-live-desktop.png` (1280×867), `work-skills-live-mobile.png` (375×812 pixels). Native IAB390×844 CSS viewport avoids CDP sticky-header capture artifacts; browser override reset afterward. Header bottom205px, heading top261px: full heading visible. The earlier local-mobile capture had a clipped heading due capture/scroll state and is superseded by this live capture; it does not represent accepted mobile composition. Mobile no overflow, both controls40×40. Live jobs copy and Enter/Space verified; original order image loaded1536px; console error log empty. All28 HTTPS file hashes match the local package, backed-up dev publication confirmed.

final result: passed
