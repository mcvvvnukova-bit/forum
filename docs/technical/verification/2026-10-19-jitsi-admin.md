# PROJ-213 — Jitsi Admin deployment receipt, 19 October 2026

Target: **https://vks.mvpspace.ru/admin**, existing Beget VPS `31.128.45.109`. No DNS/certificate changes. Separate Compose project `/opt/jitsi-admin`; existing Jitsi `/opt/jitsi-meet` remains the conference service. [Operator guide](../../../deployment/jitsi-admin/README.md).

## Observed acceptance

- Public HTTP suite: **5 passing checks** for unchanged Jitsi homepage, correct OIDC issuer, real JS/CSS content, closed staff login, unrelated OAuth callback state denied.
- Host-link suite: **24 passing checks** using real HS256/RS256 cryptography, signature tampering, issuer/audience/subject/expiry, exact organizer group, malformed/wildcard room rejection, unchanged Cal UUID, vendor room refresh and bounded host-token lifetime. Missing implementation and vendor-prefix case were observed failing first.
- Live public BOSH suite after Jitsi recreation: **12 passing checks**, `2026-10-19T15:34:30Z`. Empty, forged, expired, wrong issuer/audience and retired-key tokens rejected; anonymous/participant before host held; host owner/moderator; participant lacks owner; plain guest joins the same UUID room after host; a token cannot join another existing room. Test sessions terminated.
- IAB: organizer login; loaded CSS/JS and functioning create modal; saved permanent conference #1; entered a muted conference and observed **Модератор** badge. Test room remains clearly labelled `Проверка установки Jitsi Admin — PROJ-213`.
- IAB: Keycloak users list and create form available to owner. Ordinary `proj213-qa` signed into the portal and was denied the administration console; after disabling and terminating its Keycloak sessions a fresh login displayed **Учетная запись заблокирована**. Record retained disabled, not irreversibly deleted. No real user invited.
- IAB: actual `/admin/host` redirected a controlled UUID unchanged, with moderator claim and **120-second** JWT.
- Vendor meeting JWTs initially lacked `iat`/`exp`; the service decorator and PHP-FPM restart were verified through the actual browser-generated token: **3600-second** lifetime. CLI cache clear alone was insufficient because production OPcache has timestamp validation disabled.
- Database/Keycloak/WebSocket restarted; app/worker restarted or recreated independently. Saved owner, mapping and conference remained present. Final Compose wait succeeds with real HTTP app and CLI worker probes.
- Persistent lobby is present in the running main-host module list after Prosody recreation. Main realm uses token authentication with empty tokens forbidden. JVB was not recreated.

The initial signaling harness was corrected to use Jicofo conference allocation and a valid alphanumeric/underscore MUC resource, matching the installed protocol. Those harness failures are not recorded as production regressions.

## Secrets and operation

No secrets are committed. A diagnostic browser observation exposed a disposable room bearer token during testing. The shared signing key was rotated in the portal database and Jitsi; a token signed by the retired key was rejected in the live suite. The temporary retired-key fixture was removed; historical backups remain root-protected.

Before configuration changes, original env/Compose/nginx and actual Prosody mounts were archived privately. Subsequent archives include actual web configuration. Portal/identity DB dump saved before key rotation. Paths and restoration steps are in the operator guide.

Observed after other concurrent server work settled: approximately **1.4 GiB MemAvailable**, **6.8 GiB free disk**. New project idle resident/container usage was approximately **668 MiB**; total configured caps **1504 MiB**. This is an idle observation, not a load/capacity test. Other project containers/images were not stopped or pruned.

Email delivery is disabled. No SMTP receipt test or actual microphone/camera/media test was performed. Browser devices were unavailable; muted signaling, moderator role and entry screens were verified. Existing Cal.diy code/bookings were not changed.

## Implementation decisions

1. Use live Compose/nginx/HTTP checks for configuration, cryptographic tests for new PHP code; avoid static mirror tests. Cost if wrong: an unexercised configuration edge remains a deployment risk.
2. No GitNexus graph covers this upstream/runtime configuration; use pinned vendor source and running configuration. Cost: re-audit adapters on update.
3. Block the pinned vendor telemetry destination in container hosts instead of relying on its undocumented magic-hash opt-out. Cost: recheck destination on update.
4. Reuse the portal's confidential-client code/state flow and saved ID token for the host route, with signature/claim checks; no separate OIDC gateway. The pinned built-in client has no PKCE support; the previously drafted PKCE-specific requirement is replaced by the existing confidential-client flow. Cost: less defense against authorization-code interception than PKCE; callbacks are exact, state checked, client secret server-only and public transport TLS.
5. Add narrow `/build/` and `/ws/` routes because the pinned bundle hard-codes them. Cost: preserve non-conflicting namespaces on upgrade.
6. Adapt the pinned wait-for-host module and load persistent lobby on the main host only; retain a live role/guest/room gate. Cost: recheck upstream hooks/hash after version change.
7. Verify the QA identity via CLI creation and browser sign-in/denial; inspect web creation form without entering new credentials through computer automation. Cost: account-creation submit itself was not automated through the browser.
8. Combine shared portal/integration files in one verified runtime commit; publish acceptance/runbook separately. Cost: coarser git rollback, mitigated by private server snapshots.

## Publication

Branch: `codex/PROJ-213-jitsi-admin`, based on `origin/main`. OpenProject: [PROJ-213](https://roadmap.astforum.ru/work_packages/213), authored/updated under user 8 `kuzmina`. PR [#46](https://github.com/mcvvvnukova-bit/forum/pull/46) is attached to the chat. The native OpenProject GitHub collection for work package 213 contains this PR (verified as kuzmina).

The PR is ready for review and remains open; no merge was performed. GitHub Actions checks are queued, so successful CI is not claimed. The deployment task is marked **Сделано** with the live acceptance results and outstanding SMTP/media limits; the saved description and native PR relation were reopened and verified as kuzmina. All **19 managed deployment/test files** on `/opt/jitsi-admin` match the repository SHA-256 hashes; private runtime secrets are outside that comparison.

## Final review and fix

The fresh whole-branch reviewer found one Important issue: an already-open Symfony staff session could continue issuing new moderator tokens after Keycloak disable/logout. A callback listener now retains the OAuth access token server-side; a controller listener checks Keycloak userinfo before staff actions, with a 30-second cache and subject/group checks. Invalid identities clear local authentication, IdP failure fails closed, and public participant flows remain available. Nine focused tests cover callback lifecycle, active/disabled/legacy sessions, wrong subject/group, IdP outage, public guests and cache revalidation. Missing guard was observed RED before implementation. No other Critical/Important issues or deferred minors were reported.

Live retained-cookie acceptance: the ordinary QA user created permanent conference #2 and obtained a moderator link (3600-second JWT). The account was disabled and its Keycloak sessions terminated at `2026-10-19T15:50:56Z`. Without signing out of the portal or clearing browser cookies, after at least 35 seconds the same browser requested its own `/admin/room/join/b/2`; it reached the Keycloak login form instead of receiving a meeting token. The same credentials were then explicitly rejected as disabled. Owner login and admin users console were restored; the QA account remains visibly disabled. This verifies revocation of further issuance, separately from the one-hour maximum lifetime of previously issued tokens.

Final standard signaling suite after these changes: 11 passing checks; host-link cryptography 24; session guard 9; public HTTP 5; existing deployment checks 2. Existing ClearTopic and reconciliation endpoints return 200, DeepSeek Harness retains its expected 401 authentication challenge, Jitsi and JVB health return 200. GitNexus detected 21 staged files and zero indexed changed symbols before the initial runtime commit; that is an inventory result, not graph coverage of the adapters.
