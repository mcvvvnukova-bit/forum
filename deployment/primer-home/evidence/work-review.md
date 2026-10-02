# Consistent chrome after audience-page review

OP#PROJ-144 / OP#PROJ-29, PR12. Related audience review: PR11 / PROJ-146/147.

The requested nav item is «О платформе» with the same /#rules destination. Footer logo now uses the same already measured21.04px transparent-padding correction as the header. No brand-token or authentication change.

Typecheck/lint,13tests,build:dev,2deployment-script tests passed. Existing nav assertion updated while retaining its route assertion. Primer validator0errors/22existing allowed warnings. IAB1679/768/390/320 showed no overflow and visible logo/text left coordinates matching within0.001px. No new token mappings or dependencies; existing Forum Light layer reused. Full VoiceOver/external Sber flow not exercised.

The separate audience app retains its routes/assets and new work-intent callback contract. Before publishing this homepage build, the existing audience resume marker is added to staged dist/index.html, preserving the owned callback integration. Unchanged deployment script compares every served homepage asset and protected production/customer/auth/gateway/config fingerprints with the backup. Publication and final integration proof are recorded below.

## Final review and release status

Independent final review of both deltas:0 severe,0 moderate,0 minor findings. Audience source commit2e33680db482609e8aa8a5e8eb9ed2dc63f7a4f6; homepage source96bfee47afa6794b1a55ade3dbffd39a08ee9a15. Both branches were pushed to their existing GitHub PRs.

Published and verified on dev.astforum.ru. The initial default-route SSH timeout was resolved for this release with per-process BindInterface=en0 using the same configured host/key. No persistent network setting was changed. Audience backup: /opt/outline/backups/audience-pages-20261002T174952198518Z. Homepage backup: /opt/outline/backups/primer-home-20261002T175037071771Z.

All28 audience files and root HTML+18 homepage resources served over HTTPS match the staged build bytes/SHA-256. The homepage deploy independently passed origin and HTTPS checks, gateway health, robots policy, anonymous session API401 and31 protected-file comparisons (including the already updated customer route). Comparing before the entire two-build release to after it confirms30 protected files unchanged, including production index SHA-256 `afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a`. Root now has exactly one audience resume marker and matches the new staged index.

Fresh IAB tabs show both generated illustrations loaded, corrected FAQs, common5 work steps, one primary final action, shared «О платформе» nav and footer visible-logo/text alignment within0.001px. The general CTA opens «Поиск работы и подработки»; selected vacancies opens «Поиск вакансий» and closing returns focus. Live screenshots and published JSON saved. OpenProject under Ассистент Кузьмина confirmed PR11 on PROJ-146/147, PR12 on PROJ-144, both on PROJ-29, and PR12 on PROJ-1. See work-review-deployment.json, work-review-served.json, work-review-published.json and audience final-openproject JSON. Existing external-auth/VoiceOver/backend limitations above remain.
