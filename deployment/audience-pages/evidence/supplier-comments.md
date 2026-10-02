# Supplier comments verification — 02.10.2026

Primary task: OP#PROJ-146, API work package 184, checked under Ассистент Кузьмина user 8. Continue existing branch and PR #11.

Nine comments implemented: removed hero note; «Поставка товаров» heading; separate project, construction/installation and equipment leasing cards; removed directions note; replaced steps 1/3 and first sentence of step 4; shared homepage RulesSection; shared DemoSection immediately after comparison. FAQ chat answer aligned to step 4, with its existing contact-access condition preserved.

New design/construction/leasing intents and existing goods persist through the registration handoff and final generic action. Legacy services remains valid. Unknown values and external redirects are rejected. Tests initially failed in six expected cases, then all 25 behavior tests passed. TypeScript, ESLint, production build/package and 3 deployment Python tests pass. Primer validator: 0 errors; 47 PDS007 warnings reviewed as existing/allowed component props and layout values. No new tokens, dependencies or bespoke UI components. Existing large-bundle/compiler-directive build warnings remain.

Codex iab: rules and demo text match the live homepage; comparison's next section is demo. Design choice survives reload and final CTA; leasing choice displays correctly. Demo iframe has audience=Компания-исполнитель. Enter opens, Escape closes and focus returns to «Выбрать время». No booking or registration created.

Observed responsive widths: 1679/768 two columns, 390/320 one column, no horizontal document overflow. Long buttons shortened to «Хочу проектировать»/«Хочу предлагать лизинг» after checking clipping. All four button widths fit their card content area at 320 px (225 px available). Scoped temporary viewport overrides reset. Browser data: supplier-comments-local.json. Copy/layout checked manually, no mirror tests added.

Independent read-only review of the six source files from 82246d5: Critical 0 / Important 0 / Minor 0. Publication pending; no completion claim yet.
