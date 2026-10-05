# PROJ-147: work examples slider and direct sign-in

Six comments from 5 October 2026 are implemented on https://dev.astforum.ru/work/. Both format buttons open the existing sign-in/registration dialog with an explicit individual intent. The skills/order and staffing/vacancy examples share one manual cyclic two-slide carousel with Primer controls and position announcement. Visible illustration captions and the first sentence of the skills intro were removed; current-slide native title/facts remain available to screen readers.

Source: frontend cfad06490fa72324291bc46aed8ceda27633e733; deploy preservation 1c74a2bebd6894bf1777e3079b32d1782c35eb2a. Existing branch/PR11 continued, real task PROJ-147 and parent PROJ-29 verified under Kuzmina8 before changes.

## Verification

- Baseline34 tests. RED5 expected failures for missing auth/slider behavior,32 passing. GREEN37/37 Vitest; typecheck/lint/build/package passed. No frontend source changed afterward.
- Deployment regression: RED missing preserve-homepage mode, then GREEN4/4 Python tests including rollback and byte-preserving publication. Default legacy deploy behavior retained.
- Primer validator0 errors43 warnings: existing literals plus heading-level/image-dimension false positives audited; new layout spacing uses existing tokens.
- IAB1608/768/390/320 px: no horizontal overflow;40x40 controls; Enter/Space cycle slides while preserving focus. Both auth contexts and return focus verified locally and on dev. Sliding does not change the remembered auth intent; integration tests cover opposite-choice switching/reload and legacy hashes.
- One fresh read-only reviewer found0 Critical/Important/Minor in frontend delta and deployment follow-up. Publication proof was pending in review and has since completed. Full VoiceOver and real Sber registration were outside this edit's verification.

## Dev publication

Preflight found the independently updated root uses public-auth assets and an empty legacy audience marker. The old deploy would inject another callback. The new explicit --preserve-homepage option keeps root bytes intact; no public-auth source changed.

Backed-up audience package at /opt/outline/backups/audience-pages-20261005T171635427782Z. All28 served audience files match staged/local SHA256 through authenticated HTTPS. Root SHA f507c9e60dbd83a543a2cc7fc23930401b8107cc17c4f3870e4648669dce10a9 and all123 unowned landing files unchanged;30 protected files, production, auth, Caddy and Compose unchanged. Exactly one legacy marker remains. Anonymous gate/noindex, robots, health and401 session response verified. Only per-process SSH BindInterface=en0 used.

PR11 pushed, updated and attached: https://github.com/mcvvvnukova-bit/forum/pull/11. Body preserves OP#PROJ-145/146/147/29. PR11 is visible in each task's GitHub tab under Ассистент Кузьмина; source local/remote/PR heads matched. Evidence-only completion commit follows the published source.

JSON evidence: work-slider-local, stage, before, after, deployment, served, published, openproject. Browser screenshots are local ignored artifacts work-slider-published.png and work-slider-published-vacancy.png.
