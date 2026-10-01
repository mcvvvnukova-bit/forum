# Sber ID backend

The landing already links to `/auth/sber-id/start?intent=register&subject=individual`
and `/auth/sber-id/start?intent=login`. Implement these routes in `apps/api` using
the approved Node.js 24, NestJS/Fastify and PostgreSQL/pg stack. The existing
Python dev password gateway is infrastructure, not the user identity store.

## Flow

- Persist a ten-minute authorization attempt with state hash, browser-cookie
  hash, nonce and PKCE verifier. Only one matching, unexpired callback may consume it.
- Exchange the code using mTLS and form parameters, validate the ID token claims,
  obtain userinfo and verify that its subject matches the ID token.
- Match by Sber subject and documented alternate subjects, never by email.
  Reject conflicting identities rather than merging accounts automatically.
- In one PostgreSQL transaction create the user, external identity, individual
  provider participant, role, registration outbox event and hashed session token.
  A login for an unknown subject asks the user to register. Registration for a
  known subject signs in without making a duplicate account.
- Send the documented completion event after commit on the production contour.
- Return to the same-origin landing. Expose `/api/auth/session` and
  `POST /api/auth/logout`; logout requires same-origin validation.
- Keep Sber access/ID tokens out of browser storage, cookies, logs and database.
  Session cookies contain only an opaque random token, with HttpOnly, SameSite=Lax,
  Secure on HTTPS. Authentication failure creates no account or session.

## Configuration And Delivery

Provider credentials, registered callback, issuer and authorization URL are
server configuration. mTLS accepts PEM certificate/key and an optional CA bundle.
No TLS validation bypass. No guessed test authorization URL: it must be supplied
from the application's Sber settings. Without credentials, return a controlled
unavailable response. Supply Docker configuration and a Vite API proxy; do not
apply production migrations or deploy during implementation.

## Verification

Use a real isolated PostgreSQL database and a local HTTPS provider with a client
certificate requirement. Cover registration, returning login, unknown login,
replay, browser binding, expiry, token/userinfo mismatch, provider denial/failure,
alternate subjects, concurrent registration, session expiry/deactivation/logout,
CSRF, and absence of credentials. Run frontend tests and build after connecting
the existing landing entry points.

## Approved Dev Callback Relay (2026-09-11)

The user approved forwarding `https://astforum.ru/authorization` to dev.
Only GET on this exact path redirects, with HTTP 303, to the fixed destination
`https://dev.astforum.ru/authorization`, preserving the original query encoding.
The response uses `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
The main homepage and all unrelated routes remain unchanged.

`SBER_ID_CALLBACK_RELAY_ORIGIN=https://astforum.ru` explicitly permits that
registered HTTPS callback for `PUBLIC_ORIGIN=https://dev.astforum.ru`. Cross-origin
callbacks remain rejected without the option. Relay mode permits only
`/authorization`; same-origin callback behavior is unchanged. Authorization and
token exchange continue to use the original registered main-domain URI.
State, nonce, PKCE, one-use attempts and dev host-only cookies remain mandatory.
The relay does not establish a session or consume a code itself.

Deploy the backend and hot-reload only the callback route in Caddy. Keep Sber
disabled while the expected issuer remains unconfirmed. Do not change database
schemas, gateway password protection, main-domain static files or other services.

## Approved Issuer Diagnostic (2026-09-11)

The user approved one diagnostic Sber login to observe `iss` without creating an
account or platform session. Use a separate operator-only command in the existing
API container, not a public endpoint or an authentication-mode change.
Keep runtime authentication disabled and leave both sites, Caddy and the database unchanged.

Reuse the configured Sandbox credentials, registered main callback, strict mTLS,
authorization URL builder, nonce and S256 PKCE. Store only a ten-minute one-use
attempt under a private temporary directory. Ask the user to complete Sber's
authentication in the browser. The disabled dev callback may display 404; capture
its URL from that same browser and exchange the code immediately through the
operator command. Check state, nonce, audience and token lifetime. Output only
the observed issuer and a diagnostic-only label; never return or persist tokens
or personal data, and never infer a platform session from this result.
Issuer equality is intentionally not checked in this diagnostic, because observing
that field is its sole purpose. Authentication's issuer check remains unchanged.

## Sources

- https://developers.sber.ru/docs/ru/sberid/service/reqdescription/authcodereq/web/overview
- https://developers.sber.ru/docs/ru/sberid/service/reqdescription/accessidtokens/overview
- https://developers.sber.ru/docs/ru/sberid/service/reqdescription/datareq/overview
- https://developers.sber.ru/docs/ru/sberid/service/analytics
- https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
