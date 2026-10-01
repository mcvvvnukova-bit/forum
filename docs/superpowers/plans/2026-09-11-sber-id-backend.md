# Sber ID Backend Implementation Plan

**Goal:** Make the existing Sber registration/login links complete a server-side authorization flow.

**Architecture:** NestJS/Fastify API, PostgreSQL transactions and an mTLS Sber adapter.
The Python dev access gate remains a separate layer.

**Tech Stack:** Node.js 24, TypeScript, NestJS, Fastify, pg, jose, Node test runner.

## Tasks

- [x] Create the API package and failing HTTP flow tests against isolated PostgreSQL
  and a certificate-authenticated HTTPS provider.
- [x] Add SQL migration and IAM/participant repository; persist one-time attempts,
  identities, roles, sessions, audit and registration outbox atomically.
- [x] Implement Sber authorization URL, mTLS exchange, claims/profile validation,
  completion notification and controlled provider failures.
- [x] Connect start/callback/session/logout routes and existing landing feedback.
- [x] Add Vite proxy, Docker deployment configuration, credential template and runbook.
- [x] Run backend tests, frontend tests, typechecks, builds and browser smoke checks.

Use the behavior and security cases in the design as acceptance criteria. Keep
database setup and all provider fixtures local; no live customer credentials are
required for automated checks. Deployment and real Sber acceptance remain distinct
from implementation verification.

## Approved Dev Callback Relay

- [x] Add a failing `loadConfig` test for an explicitly permitted HTTPS relay
  origin and rejected unknown origins, callback paths and insecure origins.
- [x] Implement `SBER_ID_CALLBACK_RELAY_ORIGIN` in `apps/api/src/config.ts`;
  keep the registered redirect spelling and same-origin defaults unchanged.
- [x] Test the real Caddy fragment in an isolated local container: GET redirect,
  encoded code/state, denial parameters, no-store/no-referrer, fixed destination,
  and unchanged root, methods and other hosts. Watch the missing route fail first.
- [x] Add the fragment and verify backend registration/login with a different
  public origin, unchanged token-exchange URI, host-only cookies and replay rejection.
- [x] Build a new backend release on `forum-prod`, retaining secrets and the
  Sandbox database. Back up API configuration and Caddy before switching.
- [x] Validate the Caddy candidate and hot-reload it without recreating Caddy.
  Verify the public relay, dev endpoint, TLS, main page hash and unrelated hosts.
- [x] Record deployed configuration, remaining issuer requirement and targeted
  rollback steps. Do not enable Sber based on a guessed issuer.

## Approved Issuer Diagnostic

- [x] Test an operator-only `diagnostics/issuer-probe.mjs` against the local mTLS
  provider: state, nonce, audience, expiry, one-use code exchange, strict TLS and
  issuer-only output. No userinfo, completion request or database connection.
- [x] Implement the diagnostic CLI using the existing authorization URL builder
  and configured Sandbox credentials; keep normal authentication disabled.
- [x] Stage only the diagnostic files under the running container's private `/tmp`.
- [ ] Generate a ten-minute authorization attempt and open its URL for the user.
- [ ] After the user completes Sber authentication, capture the callback from the
  same browser, exchange the code and report only the actual issuer. Clean up the attempt.

Eight diagnostic tests pass. No live attempt has been generated: the in-app browser
rejects the authorization page's certificate, and Chrome automation is unavailable.
The user reports a certificate warning in Chrome; its details are still needed.
Normal authentication remains disabled. See the deployment runbook for the staged command.
