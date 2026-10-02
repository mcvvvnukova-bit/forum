# Consistent chrome after audience-page review

OP#PROJ-144 / OP#PROJ-29, PR12. Related audience review: PR11 / PROJ-146/147.

The requested nav item is «О платформе» with the same /#rules destination. Footer logo now uses the same already measured21.04px transparent-padding correction as the header. No brand-token or authentication change.

Typecheck/lint,13tests,build:dev,2deployment-script tests passed. Existing nav assertion updated while retaining its route assertion. Primer validator0errors/22existing allowed warnings. IAB1679/768/390/320 showed no overflow and visible logo/text left coordinates matching within0.001px. No new token mappings or dependencies; existing Forum Light layer reused. Full VoiceOver/external Sber flow not exercised.

The separate audience app retains its routes/assets and new work-intent callback contract. Before publishing this homepage build, the existing audience resume marker is added to staged dist/index.html, preserving the owned callback integration. Unchanged deployment script compares every served homepage asset and protected production/customer/auth/gateway/config fingerprints with the backup. Publication and final integration proof will follow.
