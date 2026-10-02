# Review comments 1–25: suppliers and work

Tasks: OP#PROJ-146 / OP#PROJ-147; shared homepage chrome OP#PROJ-144, parent OP#PROJ-29. Existing PR11/12 remain the delivery branches. User corrections supersede the previous vacancy “soon” copy; public landing scope is preserved.

| Comments | Result |
|---|---|
|1–3|Supplier FAQ qualifier removed; exact free-platform/tender-amendment answers.|
|4,21|Supplier and work final CTA reuse the customer's Primer Card/Stack composition; one primary action.|
|5–8|Work notes/soon label removed; hero «Найти работу»; both format choices active.|
|9–12|Skills/order merged; disclaimer and example label removed; generated order interface illustration.|
|13–16|«Официальное трудоустройство в штат», soon banner/example label removed; matching vacancy illustration.|
|17|One common five-step sequence.|
|18,22,23|Exact Sber ID/both-work-scenarios FAQ and «Платформа».|
|19–20|Final Sber note and proposal-conditions phrase removed.|
|24–25|Measured alpha offset also applies to footer; «О платформе» nav in all audience pages and homepage.|

The personal intent contract distinguishes orders/find-orders, jobs/find-jobs, general/find-work without direction. Validator and Sber callback resume guard use the same whitelist. Employment is not routed into procurement. Backend employment search and real authentication/submission were not exercised; this release changes the public landing and its existing sign-in handoff.

## Gates before publication

- Audience typecheck/lint: pass. Meaningful test change RED:6 expected failures /28 pass; GREEN:34/34. Existing supplier/customer behavior remains covered. No copy-mirror tests added.
- Audience build/package, Python deployment3tests and Primer validator: pass,0errors/41existing allowed token warnings.
- Homepage typecheck/lint,13tests, build:dev and2deploy-script tests: pass. Primer validator0errors/22existing allowed warnings. Obsolete nav assertion was updated to the requested label while retaining its destination assertion.
- Existing bundle-size and compiler directive build warnings remain; no new dependencies or Forum token values.
- IAB1679/768/390/320: no horizontal overflow or out-of-bounds buttons. CTA changes from row to column on narrow screens; paired format actions aligned. Both formats share5steps. Enter/Space, format reload and correct dialog route verified.
- Actual logo bitmap1600×600 has alpha left163. Existing contain geometry8px +163×48/600 is21.04px; extending the existing transform aligns visible logo and paragraph left within0.001px at all four widths.
- Image text/style inspected; genuine RGBA transparency confirmed. Built-in image_gen produced both1536×1024assets; two unsuccessful network calls were retried with one edit reference. Source assets and final prompt set are saved in the repository. Native captions and visually hidden fact lists provide equivalent screen-reader content; full VoiceOver was not run.
- OpenProject API/current browser account is Кузьмина8. Existing PR links present on PROJ-146/147 and PROJ-144, both on parentPROJ-29.

See work-review-local.json, work-review-images.json, work-review-openproject.json and work-image-prompts.md. Independent review/publication evidence follows in a separate commit. User browser tabs/comments are preserved; temporary viewport changes cleared.

## Final review and release status

Independent final review of both deltas:0 severe,0 moderate,0 minor findings. Audience source commit2e33680db482609e8aa8a5e8eb9ed2dc63f7a4f6; homepage source96bfee47afa6794b1a55ade3dbffd39a08ee9a15. Both branches were pushed to their existing GitHub PRs.

Publication is pending: repeated connections to configured forum-prod (84.47.165.130:15833) timed out before authentication. DNS still resolves to that host and HTTPS responds200 with the existing dev gate/noindex. Port22 also timed out. The active local route uses utun4; whether the failure is in the tunnel or server/network ACL is not established. No firewall, VPN, authentication or server files were changed to work around it. The staged homepage index locally contains exactly one existing audience resume marker. No deployment was attempted after the connection failed, and no new served-file or production-preservation claim is made.
