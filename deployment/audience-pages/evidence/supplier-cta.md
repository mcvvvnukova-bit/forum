# Supplier direction card actions

Task: [OP#PROJ-146](https://roadmap.astforum.ru/work_packages/184), existing [PR #11](https://github.com/mcvvvnukova-bit/forum/pull/11).

User corrections: align action buttons within each two-column row and rename the four actions to **Приступить к работе**. Each button retains its own goods/design/construction/leasing intent.

The supplier cards now use the existing `audience-card` layout from the homepage: a flexible grid row lets `Stack.Item grow` fill the space above the button. No fixed height, internal Primer selector, token value, dependency or intent contract changed.

## Verification

- Adapted the existing four direction checks to locate the identical button labels within their heading's card. RED: four expected failures for the missing new label. GREEN: all 25 existing tests passed; no new tests added.
- Typecheck, lint, build and packaging passed. All three existing deploy-script tests passed.
- Primer validator: zero errors, 47 pre-existing allowed token warnings. Existing bundle-size/compiler-directive build warnings remain.
- In Codex IAB, the first-row button offset changed from 21px to 0px. Both rows have identical paired button top/bottom coordinates at widths 1679 and 768. At 390 and 320 the grid becomes a single column; document scroll width stays within the viewport and buttons stay inside the cards.
- Activated each action with Enter; each registration dialog displayed its corresponding direction. No registration or booking submitted.
- Browser measurements and dialog observations: `supplier-cta-local.json`. Temporary viewport emulation was cleared; the user's supplier tab and unsaved comment were preserved.

Independent review and dev publication evidence will be recorded after completion. Production and the root homepage remain outside the publication scope.
