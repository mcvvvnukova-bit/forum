# Jitsi Admin /admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Install Jitsi Admin on the existing VPS and connect it to vks.mvpspace.ru, with web-managed staff accounts and intact meeting links.

**Architecture:** A resource-limited Compose project runs behind existing nginx at /admin. Keycloak provides staff identities; Jitsi Admin issues room-scoped moderator/participant JWTs. An authenticated OIDC host bridge covers existing arbitrary Cal.diy room URLs only if the vendor portal lacks that path.

**Tech Stack:** Jitsi Admin 1.5.20, Keycloak 26.8.1, MariaDB 11.4, Docker Compose, nginx, existing Jitsi stable-11248; Python for deployment/protocol verification and PHP for the in-app host bridge.

## Global Constraints

- Public entry: https://vks.mvpspace.ru/admin; no extra hostname or DNS changes.
- Current VPS only: 31.128.45.109, 4 GiB RAM, total new service limits approximately 1.5 GiB.
- Closed registration; administrators and organizers have separate privileges.
- Existing Cal.diy customer room URLs remain valid; guest-before-host behavior is preserved.
- Never store secrets in the repository or emit raw JWTs/authorization codes in logs.
- Use a fresh private backup before changing Jitsi authorization; do not restart an active conference.
- All changes use codex/PROJ-213-jitsi-admin and a PR containing OP#PROJ-213.

---

### Task 1: Isolated portal and identity deployment

**Files:** Create deployment/jitsi-admin/compose.yaml, deployment/jitsi-admin/nginx-locations.conf, deployment/jitsi-admin/framework-proxy.yaml, deployment/jitsi-admin/README.md; operational generated files live at /opt/jitsi-admin and in root-only secrets.

**Interfaces:** Consumes existing nginx/TLS and loopback port inventory. Produces a healthy portal at /admin, identity realm at /admin/auth, and private application/database/websocket services.

- [x] Verify live identity in OpenProject, create PROJ-213, and isolate the checkout.
- [x] Record the approved design and baseline: `python3 -m unittest discover -s scripts/deployment/primer-home -p 'test_*.py'` (2 passing tests).
- [x] Resolve the exact vendor image manifests for core/websocket 1.5.20, Keycloak 26.8.1 and MariaDB 11.4; record each digest in Compose and the operator guide.
- [x] Back up existing Jitsi configuration, Prosody data, nginx site and container identities in a private server directory.
- [x] Create generated secret env, separate database users, closed Keycloak realm, confidential OIDC clients, organizer/admin roles and the first operator account without printing credentials.
- [x] Start only the new Compose project on loopback with explicit memory limits and one queue worker; inspect health and actual memory before continuing.
- [x] Add /admin nginx locations; trust X-Forwarded-Prefix in Symfony; configure exact OIDC callbacks and cookie paths. Validate with `nginx -t` before reload.
- [x] In Codex IAB, verify login, CSS/JS, callback, dashboard and identity-admin pages under the prefix. Check HTTP statuses for generated asset URLs rather than only the homepage.
- [x] Commit the verified deployment configuration with PROJ-213 in the commit message.

### Task 2: Jitsi connection and existing-room compatibility

**Files:** Create deployment/jitsi-admin/jitsi.env.example and scripts/deployment/jitsi-admin/verify_signaling.py. If the vendor has no authenticated arbitrary-room launcher, create deployment/jitsi-admin/host-login/ForumHostLink.php, ForumHostController.php and ForumRoomService.php, with scripts/deployment/jitsi-admin/test_host_link.php.

**Interfaces:** Consumes the closed Keycloak realm and the private HS256 signing secret. Produces JWT-authorized conference joins, explicit moderator roles, anonymous wait-for-host behavior, and compatibility with existing UUID room URLs.

- [x] Verify the bundled token_affiliation and muc_wait_for_host behavior against the installed Jitsi version; configure context.user.moderator claims consistently in the portal and Jitsi.
- [x] Verify a vendor-supported arbitrary-room host path. If absent, implement only the documented /admin/host OIDC bridge; tests must cover wrong callback state via the vendor flow, wrong issuer/audience, expired token, missing organizer role, malformed room and room-scoped JWT expiry.
- [x] Keep `/admin/host` authenticated through the portal confidential-client authorization-code/state flow and reuse Keycloak SSO. Deny open redirects and never issue a wildcard JWT.
- [x] Check JVB/Colibri conference counts. Defer the Jitsi restart while a real conference is active.
- [x] Apply JWT settings and module configuration only after portal/identity/resource checks pass; restart only required Jitsi services.
- [x] Run an isolated BOSH test: anonymous before host, authorized host, participant token, modified/expired token, unchanged-room anonymous after host. Terminate all test sessions.
- [x] Verify an arbitrary UUID room and its authorized host link while preserving the original plain guest URL.
- [x] Verify creation and host/participant roles in IAB; report separately if microphone/camera or real media cannot be exercised.
- [x] Commit the verified integration and compatibility checks with PROJ-213 in the message.

### Task 3: Acceptance, persistence and publication

**Files:** Update deployment/jitsi-admin/README.md and create docs/technical/verification/2026-10-19-jitsi-admin.md with a sanitized release receipt.

**Interfaces:** Consumes completed portal/identity/Jitsi tests. Produces a usable operator handoff, backup/restore commands and an auditable PR/OpenProject connection.

- [x] Create a disposable staff fixture via Admin API and inspect the web creation form, verify login and lack of admin privileges, disable it, verify fresh login is denied, and clean up the test account through an approved recoverable path.
- [x] Verify service health, generated links, database persistence, configured timezone Europe/Moscow, memory limits and free disk after a controlled restart of only the new project.
- [x] Check existing Jitsi homepage, JVB health, ClearTopic and the other existing public endpoints.
- [x] Document the exact operator URL, how to create accounts, where private credentials are stored, which tests passed and any unverified media/email behavior.
- [x] Run applicable tests and configuration checks; inspect the final diff for secret material and unrelated changes.
- [ ] Push the branch, create a PR with OP#PROJ-213 in its body, attach it to this chat, and verify the OpenProject GitHub tab shows the PR.
