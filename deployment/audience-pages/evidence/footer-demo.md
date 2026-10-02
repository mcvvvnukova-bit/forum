# Footer demo corrections — 02.10.2026

OP#PROJ-145 verified under Кузьмина API user 8 (work package 183). Shared Primer footer gains Link as a native button, opening existing DemoDialog; customer's final Card retains only the order CTA. No token, dependency, storage or auth changes.

Typecheck, ESLint, 25 existing Vitest tests, production build/package, 3 deployment tests pass. Primer validator: 0 errors, 47 reviewed warnings on existing component/layout values. Existing build-size/compiler-directive warnings remain. No new mirror tests for these reversible low-impact changes, per developer instruction.

Codex iab: customer final buttons = «Разместить заказ». Footer Enter opens demo on customer/work/participate; Space works on suppliers. Customer/supplier iframe uses Заказчик/Компания-исполнитель; generic pages omit audience. Escape returns focus to the native footer button. At widths1679/768/390/320 no horizontal overflow, footer action fits, aligns to start and inherits the same semantic muted color as participant links. All temporary viewport overrides cleared. footer-demo-local.json records checks. No booking/registration created; full VoiceOver and external authentication unverified because unchanged.

Independent review/publication/PR verification pending.
