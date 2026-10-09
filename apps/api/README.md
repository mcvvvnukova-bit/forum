# Forum API: Sber ID

Node.js 24, NestJS/Fastify, PostgreSQL and parameterized SQL through `pg`.
No ORM. User authentication is separate from the dev landing's shared password.

## Local Run

From the repository root, start an isolated database:

```sh
docker compose -f deployment/forum-api/compose.test.yaml up -d --wait
```

From `apps/api`:

```sh
npm ci --prefix ../..
npm run build
DATABASE_URL=postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test npm run migrate
DATABASE_URL=postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test npm start
```

The Vite landing proxies `/auth/sber-id/*` and `/api/auth/*` to port 3001.
Use `FORUM_API_ORIGIN` when running the API on a different local port.
`PUBLIC_ORIGIN` defaults to `http://127.0.0.1:4173`; use the same browser origin.
HTTP cookies are allowed only for local development. HTTPS uses `__Host-` cookies.

Without partner credentials the landing displays a controlled unavailable message.
There is no fake production login. The automated provider exists only under `test/`.

## Sber Configuration

Prepare an ignored `.env` using `.env.example`. Set `SBER_ID_ENABLED=true` only
after supplying Client ID, Client Secret, PEM client certificate/key, the exact
registered callback, authorization URL, issuer and approved scopes. File-based
secrets are supported through `*_FILE`; no secrets belong in the Vite environment.
If needed, supply the Sber CA chain via `SBER_ID_CA_FILE`. Certificate verification
and hostname verification are always enabled. Encrypted PEM keys can use
`SBER_ID_KEY_PASSPHRASE_FILE`. The SDK's iframe mode is not used.

`SBER_ID_ENVIRONMENT=test` selects the Cloud Sandbox `oauth-sb.sber.ru:6443`; `production` selects
`oauth.sber.ru`. Sandbox back-channel requests select IPv4 to avoid an AAAA DNS
timeout observed on the project server. Production uses the default address selection.
The test authorization URL and issuer must come from the activated
test application's settings; do not reuse production browser endpoints blindly.
Real production acceptance requires a real Sber account; there are no production
test accounts. Do not use the automated fixture credentials against Sber.

The token reference still shows `oauth-ift.sber.ru`, which timed out from both
the local machine and the project server during the Sandbox check. The official
[Cloud migration checklist](https://developers.sber.ru/docs/ru/sberid/faq/a4-switching-to-cloud)
specifies `oauth-sb.sber.ru` for the Sandbox back-channel and
`https://id-sb.sber.ru/CSAFront/oidc/authorize.do` for browser authorization.
There is no automatic fallback between environments or arbitrary API host override.

`openid` must be first in `SBER_ID_SCOPE`. Request only approved scopes, for example
`openid name email mobile`. Missing optional name/email/phone data is supported.
No offline access or refresh token is requested: provider tokens are used only
for the immediate login, while the platform session has its own lifetime.

Sber's token documentation includes an unsigned ID token. Set
`SBER_ID_TOKEN_SIGNING_ALG` to the algorithm registered for the application:

- `none`: only the token returned directly by the authenticated mTLS token endpoint
  is decoded, using OIDC Core 3.1.3.7(6). No route accepts an ID token from a browser.
- `RS256`: additionally verify the signature using the issuer's trusted PEM public
key in `SBER_ID_SIGNING_PUBLIC_KEY_FILE`; coordinate key rotation with Sber.

Both paths validate issuer, audience, authorized party, expiry, issuance, subject,
nonce and userinfo subject. Unknown or mismatching algorithms fail closed.

By default, the registered callback may be the same-origin `/authorization`,
`/auth/sber-id/callback` or the origin root. Its configured spelling is preserved exactly, including whether a
root URL has a trailing slash. For a root callback, route only `GET /` requests
with `state` and either `code` or `error` to the API; ordinary homepage requests
and `auth`/`auth_error` feedback stay with the frontend. Begin authentication on
the callback's own origin so its host-only attempt/session cookies are present.
Do not start on `dev.astforum.ru` and expect those cookies on `astforum.ru`.
The non-configured callback route returns 404 without consuming an attempt.

An approved relay can keep the registered main-domain URI while authentication
starts and finishes on dev. Set `SBER_ID_CALLBACK_RELAY_ORIGIN=https://astforum.ru`
with `PUBLIC_ORIGIN=https://dev.astforum.ru` and the registered
`SBER_ID_REDIRECT_URI=https://astforum.ru/authorization`. Both origins must use HTTPS.
Relay mode permits only `/authorization` on the explicitly configured origin.
The main reverse proxy returns a fixed HTTP 303 redirect to dev, retaining the
query and sending `no-store` and `no-referrer`. It never consumes a code or sets
an authentication cookie. The dev API still enforces browser-bound state, PKCE,
nonce, one-use attempts and host-only cookies. Token exchange uses the registered
main-domain URI, not the final dev callback URL.

The supplied partner-portal screenshot confirms `https://astforum.ru` as the
service address and `https://astforum.ru/authorization` as the registered callback.
These are different settings: use `/authorization` in the authorization request
and the code exchange, without a trailing slash. Both Vite and the dev gateway
proxy this callback. The approved public relay forwards it to dev, whose gateway
routes it to the API without requiring the separate shared-password cookie.

## HTTP Contract

| Route | Result |
| --- | --- |
| `GET /auth/sber-id/start?intent=register&subject=individual` | Persists a 10-minute browser-bound state/nonce/PKCE attempt and redirects to Sber. |
| `GET /auth/sber-id/start?intent=login` | Same unified flow: after verified Sber identity, create an unknown user with base IAM role `individual`, or reuse an active user. |
| `GET /authorization?code=...&state=...` | Registered Forum callback: consumes the attempt once, exchanges code, verifies identity, commits account/session, redirects to `/cabinet/?auth=success`. |
| `GET /auth/sber-id/callback?code=...&state=...` | Alternative callback, enabled only when selected in `SBER_ID_REDIRECT_URI`. |
| `GET /api/auth/session` | User, nullable informational participant, baseline `roles: ['individual']` and expiry; 401 without an active account session. |
| `GET /api/profile` | Current session owner's canonical person profile and `userId`; no source/provider metadata or query selectors. 401 for expired/revoked/deactivated account access, 503 when the canonical person is unavailable. Responses use `no-store`. |
| `POST /api/auth/logout` | Revokes the current session and clears its cookie; exact matching `Origin` required. |
| `GET /health/live` | Process liveness. |
| `GET /health/ready` | Required tables, migration006 marker, source INSERT/UPDATE, grant lifecycle column UPDATE and business-access function readiness; `sberConfigured` boolean. |

Browser errors return to `/?auth_error=<code>`; only an allowlisted human-readable
message is displayed. JSON callers receive 400/401/403/409/502/503 with a stable
code. Callback errors never include upstream data. User-controlled return URLs,
duplicate query fields, non-individual subjects and HEAD mutations are rejected.

Session tokens are random, persisted only as SHA-256 hashes and rotated on login.
Deactivated users cannot authenticate or use existing sessions. Participant or company membership/grant revocation affects business access independently of the account session.
After a verified blocked identity, any previous browser session is revoked and
its cookie cleared; the callback opens a support dialog through `account_deactivated`.
Login and registration intents are retained for compatibility/audit only and
cannot change account creation or bypass blocking. `individual` means Физлицо;
the optional participant's `provider` business characteristic is separate from baseline account access.
Identity matching uses `sub`, `sub_alt` and `alt_sub`, never email. Conflicting
identities/emails require support and are not auto-merged. An email is confirmed
only if Sber explicitly sends `email_verified: true`; email confirmation/profile
completion beyond those claims is a separate feature.

## Persistence And Operations

The API uses the main `forum` database and the consolidated `public` identity tables.
Migration006 separates canonical persons from provider snapshots, removes mandatory
personal participation, and adds independent corporate membership, authority and scoped
grant lifecycles. Original migrations001–005 stay immutable. Both owner entrypoints
apply001–003,005 and006 to a clean installation, upgrade consolidated public layouts,
and refuse a legacy installation. The completed historical transfer is documented in
[database operations](../../deployment/forum-db/README.md).

Registration atomically creates user, verified external identity, canonical person,
source snapshot, audit/outbox records and session. It creates no participant,
participant membership or scoped business grant. Every active account has baseline
`individual` access; a participant is nullable and informational in the session.
Provider aliases retain ownership; email/phone never link accounts. Initial validated
source values populate canonical data. Returning login refreshes the source snapshot
and recorded scope provenance separately, preserving independently edited canonical
values. The profile DTO explicitly allowlists canonical attributes and excludes
provider subjects, snapshots, tokens and source metadata.

A company starts pending independently of the creator's account. Corporate membership,
confirmed administrator authority and employee business-right assignment each have
separate states and recorded basis. Effective business access requires registered and
active corporate context, active corporate and participant memberships and an active
matching scoped grant; administrator access additionally requires confirmed matching
unexpired authority. Restricted context permits read-only checks; deactivated context
denies business access. No company creation or membership alone confirms authority.
The authenticated `/cabinet/` and `/cabinet/work/` use the approved profile
presentation with this DTO; missing values display «Не передано». The separate
`/profile/` preview retains its fictional-data banner and never supplies cabinet data.

Run migrations only with an explicitly selected schema-owner connection, never at
API startup. Runtime uses restricted `forum_app` and the allowlist in
`deployment/forum-api/grant-runtime.sql`. Readiness checks required tables, the006 marker (runtime SELECT(name) only), identity_profiles INSERT/UPDATE, role_assignments UPDATE(status,revoked_at), and business-access function execution.
The runtime cannot edit/delete audit events. Source transfer preserves every original
row/UUID/timestamp, builds profiles from recorded verified snapshots, and retains
session token hashes. Keep private restorable backups of both databases before
cutover; delete the source only after fresh runtime/database/browser verification.
The outbox delivery worker remains separate; do not mark pending events published.


Production completion notification runs after commit and retries once. Two failed
attempts emit `sber_completion_failed` without undoing the account or session.
Token exchange, userinfo and completion (including retries) share one `rquid`
per authentication, as required by the Cloud protocol.
Monitor that event and confirm the failure policy with Sber during acceptance.
Tokens are not persisted for indefinite delivery retries. Authorization attempts
are purged after expiry on the next start request. Schedule cleanup of expired/
revoked sessions according to the deployment's data retention policy.

All auth responses use `no-store` and `no-referrer`. Application request logging is
disabled; sanitized error events and the audit table are used instead. Reverse
proxy/access logs must exclude callback query strings, cookies and Authorization.
The updated Python gateway logs only URL paths and preserves separate Set-Cookie
headers. It forwards only the explicitly allowlisted auth routes; its dev password cookie
does not authenticate a Forum user.

Rate limiting defaults to 120 requests per minute per peer IP. Configure
`TRUSTED_PROXY_CIDRS` only with the actual proxy addresses/CIDRs when routing Caddy
directly to the API, or enforce client-IP limits at the edge. Never trust forwarded
headers from arbitrary peers. Through the dev Python gateway the limit applies
to the gateway peer; this is intentionally conservative.

Docker files are in this package and `deployment/forum-api`. Confirm the actual
existing Docker network names before deployment, provide the ignored `.env` and
readable secret files, run migrations/grants, then start the API. The existing dev
deployment config uses `FORUM_API_ORIGIN=http://forum_api:3001` on its frontend
network. Production deployment/migrations are not performed by local tests.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The browser runner is owned by this API package: its locked dev dependencies
include Playwright and Vite. The Fastify override keeps the adapter and direct
Fastify dependency on the same patched version rather than its older nested pin.
It composes the existing frontend in
`apps/legacy-landing`, which needs its separate locked install (React, Primer,
and its Vite config/plugin). From a clean checkout at the repository root:

```sh
npm ci
cd apps/api
npx --no-install playwright install chromium
TEST_DATABASE_URL=postgres://postgres:local-auth-tests@127.0.0.1:55432/forum_auth_test npm run test:browser
```

Provide a disposable PostgreSQL 18.6 instance before the last command. The browser
test accepts only a `postgres:`/`postgresql:` loopback URL with a valid decoded
ASCII database name ending in `_test` and no URL query options or fragments.
The destructive API auth suite uses the same test-only validation. The browser applies
the complete public identity migrations itself, so it can run independently of `npm test`.
Use a fresh empty database for each browser run. No deployed database, provider
credentials or production dump is needed. Missing frontend sources or dependencies
fail with the required install command before starting servers.

The test starts temporary real API/Vite servers and the local mTLS provider fixture.
At 1440 and 390 pixels it checks registration through the existing Sber link,
persisted identity/session across reload, logout revocation, provider cancellation
through the real callback, absence of page errors and horizontal overflow. Screenshots
are written to an OS temporary directory printed at completion, outside Git.

Tests use real PostgreSQL (set `TEST_DATABASE_URL` to a dedicated database whose
name ends in `_test`) and a local HTTPS provider that requires a client certificate.
They truncate only that test database's auth tables. OpenSSL is required for
ephemeral test certificates. No bank traffic or real personal data is used.

Local implementation verification (2026-09-11): backend, frontend and gateway
tests passed; TypeScript checks, landing layout/build, Docker build and container
readiness passed. Browser flow passed at 1440 and 390 pixels. The Primer static
validator still reports pre-existing literal colors/typography in the auth modal
CSS from the earlier implementation; the new feedback uses Primer's Banner and
the new logout control uses Primer's Button. No new Forum variable mapping was
introduced or independently checked against Figma in this backend task.

### Sandbox target and TLS boundary

The September11/October1 connection observations are historical; they do not prove the current deployment. Verify the selected database/schema, configured issuer, redirect origin, provider endpoint/port, certificate chain and runtime grants before an authorized release. The Sber provider can remain in test mode while the API persists to the main `forum.public` store; verify OAuth, persistence and account reuse separately.

Port6443 and hostname/certificate validation are part of the documented provider configuration. Keep private certificates, converted keys, passwords and session/provider payloads outside Git. Use the owned [deployment runbook](../../deployment/forum-api/README.md) and [release gates](../../deployment/release.md) for target/backup/served-origin/rollback evidence; raw delivery records remain private/history.

Official sources consulted:

- [Authorization code and PKCE](https://developers.sber.ru/docs/ru/sberid/service/reqdescription/authcodereq/web/overview)
- [Token exchange and alternate subjects](https://developers.sber.ru/docs/ru/sberid/service/reqdescription/accessidtokens/overview)
- [Userinfo](https://developers.sber.ru/docs/ru/sberid/service/reqdescription/datareq/overview)
- [Completion notification](https://developers.sber.ru/docs/ru/sberid/service/analytics)
- [Sber test environment](https://developers.sber.ru/docs/ru/sberid/service/how-to-test)
- [Official Sber ID Postman collection](https://documenter.getpostman.com/view/10935182/2sA3Qqes13)
- [OIDC ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)

Product decisions and their exact historical source provenance are in [the migration register](../../artifacts/repository-audits/document-migration-manifest.json); canonical requirements remain in Outline.
