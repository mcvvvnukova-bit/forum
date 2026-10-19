# PROJ-213: Jitsi Admin at /admin

User-approved deployment: existing Beget VPS (31.128.45.109, 4 GiB RAM), public entry https://vks.mvpspace.ru/admin. This final address supersedes both proposed extra hostnames. No DNS or certificate changes are required.

## Result

A closed Keycloak realm owns staff identities. An operator creates/disables users and changes passwords in its web console. Users sign in to Jitsi Admin, create conferences, and join the existing Jitsi service with room-scoped JWTs. Self-registration is disabled. The existing Jitsi room URL namespace and Cal.diy customer URLs remain valid.

## Deployment boundaries

Use Jitsi Admin release 1.5.20 (vendor core/websocket images), Keycloak 26.8.1 and MariaDB 11.4, all pinned to resolved image digests. A separate Compose project contains the application, one queue worker, websocket service, database, Keycloak, and, if required by compatibility testing, a small staff host-login bridge. Bind HTTP listeners to loopback only. Reuse the current nginx/TLS listener; only /admin and its descendants route to this project. Configure trusted forwarded-prefix headers and test generated assets, callbacks and redirects under /admin.

Keycloak runs at /admin/auth. Its admin and ordinary-user privileges remain distinct. Limit new containers to approximately 1.5 GiB in total, disable development/debug services and avoid on-server application builds. The owner's choice to use this VPS does not establish a tested participant capacity. Observe actual memory and disk during startup; roll back the new services on sustained resource failure.

## Authorization and compatibility

Jitsi Admin signs HS256 JWTs for the existing service. Moderator rights are emitted in context.user.moderator and enforced by the bundled token_affiliation module; anonymous users never receive moderator rights. Enable the bundled wait-for-host policy and retain the organizer-before-guest admission behavior.

Switch Jitsi authorization only after the portal, identity service, roles and resource checks pass. Existing native credentials and Prosody state are backed up, while organizer access moves to the web identity flow. If Jitsi Admin cannot issue a host token for an existing arbitrary Cal.diy room, provide /admin/host?room=<room> as an authenticated OIDC redirect bridge. It must validate authorization-code state, PKCE, issuer, audience, expiry and the organizer role, then issue only a short-lived token for that exact room. It must reject invalid room names, non-organizer identities and replayed callbacks. The bridge adds no public registration or unauthenticated token generation.

## Persistence, operations and secrets

Persist the new database and application uploads independently from existing projects. Store generated credentials, signing keys and mail credentials in a root-only operational directory outside Git. Redact credentials, token query strings and authorization codes from logs and receipts. Back up the original Jitsi Compose configuration, env, Prosody state and nginx site before mutation; keep a runnable restoration procedure. No external invitation email is sent without an explicit user request. Check any configured SMTP transport without sending a message.

## Acceptance and rollback gates

1. HTTPS /admin redirects within the configured prefix and presents the portal login; CSS/JS and websocket endpoints work.
2. A test staff account created through Keycloak can sign in; its disabled state denies a fresh login. Ordinary staff cannot access the identity administration console.
3. A staff user creates a meeting in Jitsi Admin and enters as moderator. An invited user enters as participant and cannot gain moderator rights by editing URL/token claims.
4. Anonymous admission before the host waits or is denied; after the host starts the same room, guests can join using the unchanged room URL.
5. An arbitrary UUID room matching the Cal.diy URL pattern can be opened by an authorized host without changing the public customer link. If needed, use the OIDC bridge, never a wildcard public token.
6. Existing Jitsi homepage, videobridge health, ClearTopic and other existing endpoints remain healthy; actual call media is distinguished from signaling-only verification.
7. Failed startup, broken prefix/authentication, guest privilege escalation, or failed compatibility gate prevents the authorization switch or triggers restoration from the backup.
8. Configuration, checks and operator instructions are committed and pushed in a PR linked to OP#PROJ-213. Verify the PR appears in OpenProject.
