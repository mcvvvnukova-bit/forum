# Footer demo corrections

User's two customer-page comments authorize this concrete design and dev publication. Remove only the secondary demo button in the customer's final Card; keep its order action and the standard demo section. Add «Записаться на демо» to the shared audience-page footer using Primer Link as a button, opening the existing DemoDialog directly. Footer item uses existing muted link styling, native button semantics and keyboard behavior. Footer Stack aligns items to start so the button matches the links.

Pass the trigger to existing focus handling. Customer/supplier pages use Заказчик/Компания-исполнитель; work and generic handoff have no preselected demo audience. No intent/storage/auth changes, bookings or registrations. Shared footer affects the owned audience routes; the separately published root homepage is preserved.

Continue branch codex/PROJ-145-audience-pages and PR #11. Primary OP#PROJ-145 confirmed as work package 183 under Кузьмина user 8; preserve all existing PR task references. Tokens/dependencies/Forum Light bindings unchanged. Existing checks and manual iab keyboard, focus, context and responsive verification cover these reversible changes; no mirror tests added.
