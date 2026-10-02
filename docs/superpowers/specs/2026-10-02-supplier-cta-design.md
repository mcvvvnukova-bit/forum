# Supplier card actions

Apply the two browser comments to the four supplier direction cards: all labels become «Приступить к работе»; paired buttons align at the bottom of their respective equal-height grid row. Preserve the distinct goods/design/construction/leasing intent per card and generic final CTA persistence.

Reuse the existing audience-card layout convention: supplier Card gets its own audience-card class; two-columns shares the existing one-flexible-grid-row layout used by homepage cards. Primer's default first max-content row currently leaves shorter card content unexpanded, so Stack.Item grow cannot align the button. No fixed heights, typography, colors, token/dependency changes or Primer internal selectors.

Update existing behavior-test selectors to scope the identical labels by the card heading; add no mirror tests. Manual iab verifies actual button geometry in each row at1679/768 and fit at390/320. Continue existing isolated branch/PR11; OP#PROJ-146 confirmed as work package184 under Кузьмина user8. Publish owned routes/assets with backup, preserve root/gate/production, push commits, attach/update PR and verify task links.
