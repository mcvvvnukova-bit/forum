# Supplier browser comments — design

Apply the nine supplier-page comments on dev.astforum.ru. Continue PR #11 and the existing isolated branch; OpenProject PROJ-146 is verified as API work package 184 under Кузьмина (user 8). Keep OP#PROJ-145/146/147/29 in the PR description.

Use existing Primer Card and responsive two-columns layout for four directions: Поставка товаров, Выполнение проектных работ, Строительные и монтажные работы, Лизинг спецтехники. Buttons select goods/design/construction/leasing respectively. The selected direction is validated, stored and displayed in the registration handoff, and retained by the final generic CTA. Preserve old services intents for previously opened sessions. Reject unknown directions and external return URLs.

Remove the hero registration note and the paragraph beneath the cards. Replace steps 1/3 and the first sentence of step 4 with the user's wording. Align the FAQ answer about questions with the requested chat wording to avoid contradicting step 4; retain its existing contact-access condition. Use the homepage RulesSection and place the shared DemoSection immediately after comparison, passing Компания-исполнитель to the existing booking Dialog. Keep supplier final CTA composition.

Verify direction persistence with meaningful behavior tests; verify copy and layout in Codex iab at desktop/tablet/mobile widths. No tests mirroring copy or component structure. Publish only the owned audience routes/assets with the existing backup/deploy script; verify file hashes, homepage preservation, access gate and production hash. Commit, push, update PR, attach it, and verify OpenProject GitHub links. No bookings or registrations are created during checks.
