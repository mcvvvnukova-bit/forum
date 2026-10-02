# Footer demo corrections — 02.10.2026

OP#PROJ-145 verified under Кузьмина API user 8 (work package 183). Shared Primer footer gains Link as a native button, opening existing DemoDialog; customer's final Card retains only the order CTA. No token, dependency, storage or auth changes.

Typecheck, ESLint, 25 existing Vitest tests, production build/package, 3 deployment tests pass. Primer validator: 0 errors, 47 reviewed warnings on existing component/layout values. Existing build-size/compiler-directive warnings remain. No new mirror tests for these reversible low-impact changes, per developer instruction.

Codex iab: customer final buttons = «Разместить заказ». Footer Enter opens demo on customer/work/participate; Space works on suppliers. Customer/supplier iframe uses Заказчик/Компания-исполнитель; generic pages omit audience. Escape returns focus to the native footer button. At widths1679/768/390/320 no horizontal overflow, footer action fits, aligns to start and inherits the same semantic muted color as participant links. All temporary viewport overrides cleared. footer-demo-local.json records checks. No booking/registration created; full VoiceOver and external authentication unverified because unchanged.

Independent review 167e076..306d4bf: Critical0/Important0/Minor0. During live verification, native Link/button default font was Arial while links used Primer system font. Added an own class bound to the identical BaseStyles-fontFamily/fontStack-system tokens used by Primer BaseStyles, without hard-coded font names or new Forum mapping. Manual before/after font check now matches; all four responsive widths rechecked. Typecheck/lint/25tests/build and Primer0errors re-run for the CSS correction.

PR11 updated/attached; OpenProject GitHub tabs PROJ-145/146/147/29 under Кузьмина each show its expected link. footer-demo-openproject.json records the observed titles/URLs.

Final font-corrected release backup `/opt/outline/backups/audience-pages-20261002T133735156227Z`. All26served files match package SHA-256; root/homepage and production hashes unchanged, password gate/noindex intact. footer-demo-deployment.json/footer-demo-served.json record checks. Reloaded iab version has one final customer button and new footer item; font/size/color equal participant links. Live Enter/Escape/context=Заказчик/focus verified. footer-demo-published.json and local footer-demo-published.png capture the result. Final evidence commit pushed and remote/local/PR head equality checked after push.
