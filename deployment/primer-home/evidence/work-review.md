# Consistent chrome after audience-page review

OP#PROJ-144 / OP#PROJ-29, PR12. Related audience review: PR11 / PROJ-146/147.

The requested nav item is «О платформе» with the same /#rules destination. Footer logo now uses the same already measured21.04px transparent-padding correction as the header. No brand-token or authentication change.

Typecheck/lint,13tests,build:dev,2deployment-script tests passed. Existing nav assertion updated while retaining its route assertion. Primer validator0errors/22existing allowed warnings. IAB1679/768/390/320 showed no overflow and visible logo/text left coordinates matching within0.001px. No new token mappings or dependencies; existing Forum Light layer reused. Full VoiceOver/external Sber flow not exercised.

The separate audience app retains its routes/assets and new work-intent callback contract. Before publishing this homepage build, the existing audience resume marker is added to staged dist/index.html, preserving the owned callback integration. Unchanged deployment script compares every served homepage asset and protected production/customer/auth/gateway/config fingerprints with the backup. Publication and final integration proof will follow.

## Final review and release status

Independent final review of both deltas:0 severe,0 moderate,0 minor findings. Audience source commit2e33680db482609e8aa8a5e8eb9ed2dc63f7a4f6; homepage source96bfee47afa6794b1a55ade3dbffd39a08ee9a15. Both branches were pushed to their existing GitHub PRs.

Publication is pending: repeated connections to configured forum-prod (84.47.165.130:15833) timed out before authentication. DNS still resolves to that host and HTTPS responds200 with the existing dev gate/noindex. Port22 also timed out. The active local route uses utun4; whether the failure is in the tunnel or server/network ACL is not established. No firewall, VPN, authentication or server files were changed to work around it. The staged homepage index locally contains exactly one existing audience resume marker. No deployment was attempted after the connection failed, and no new served-file or production-preservation claim is made.
