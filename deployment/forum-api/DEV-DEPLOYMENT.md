# Dev Landing And Authentication Deployment

## Active Release: 2026-10-01 (Moscow)

Sber ID is enabled on `https://dev.astforum.ru`. The API release is
`/opt/forum-api/releases/20261001-sber-dns`, with image `astforum/forum-api:20261001-sber-dns`.
The `/opt/forum-api/current` symlink points to this release.

The previous runtime disabled Sber and omitted its token issuer. A live diagnostic
exchanged a browser authorization code using the registered callback, client certificate,
strict server TLS validation, PKCE, audience, nonce and token expiry checks.
It returned `issuer=id-sb.sber.ru` without creating an account or session.
The issuer is now pinned in runtime configuration; authentication still checks exact equality.

The server's Sandbox A record resolves, but its AAAA lookup times out.
Sandbox HTTPS agents now select IPv4, including the operator diagnostic.
No IP address is pinned and certificate verification remains enabled.

Verification: API typecheck/build, all 39 API tests in a separate PostgreSQL test
database, and all 8 issuer diagnostic tests passed. Live readiness returns
`sberConfigured=true`. A live unregistered login completed the token and userinfo
exchange, returning the expected `registration_required` message.

The subsequent user-authorized live registration succeeded. The session survived
a browser reload. Logout returned HTTP 204 and revoked the session; returning login
returned an authenticated HTTP 200 session without creating another account.
The Sandbox contains one user, one individual participant, one Sber identity and
one provider role. There are two sessions: one revoked and one active.
Audit events record one registration and one returning login.

Runtime still uses `forum_sber_sandbox`. This release does not migrate the
authentication store to the consolidated production schema.
Only the API container was recreated. The Caddyfile checksum matched its backup.
Backup: `/opt/forum-api/backups/20261001-sber-dns`.

To restore the preceding disabled runtime, recreate the API from the previous
release, then update the current symlink after readiness succeeds:

```sh
sudo docker compose --project-name forum-api \
  --project-directory /opt/forum-api/releases/20260911T185501Z/deployment/forum-api \
  up -d --no-build --no-deps --wait --wait-timeout 60 forum_api
sudo ln -s /opt/forum-api/releases/20260911T185501Z /opt/forum-api/.current-sber-rollback
sudo mv -Tf /opt/forum-api/.current-sber-rollback /opt/forum-api/current
```

The sections below record the historical September 11 deployment and its disabled
configuration. Its temporary diagnostic files disappeared when the container was recreated.

Deployed to `https://dev.astforum.ru` on 2026-09-11 at approximately 18:37 UTC.
The existing shared-password screen remains in place. The main domain,
`https://astforum.ru`, still serves its original placeholder.
The approved callback relay and updated API were deployed at approximately
18:58 UTC on the same day. Frontend files did not change in this second release.

## Historical State: 2026-09-11

- VPS: `forum-prod`.
- Release and current symlink: `/opt/forum-api/releases/20260911T185501Z`, `/opt/forum-api/current`.
- Image: `astforum/forum-api:20260911T185501Z`.
- API: `forum-api-forum_api-1`, healthy, private Docker port 3001.
- Runtime env: `/opt/forum-api/current/deployment/forum-api/.env`, root-owned mode `0600`.
- Secrets: existing `/opt/forum-api/secrets`, mounted read-only. No secret material is in the image or site.
- Database: existing `forum_sber_sandbox`, runtime role `forum_sber_sandbox_app`.
- Landing: `/opt/outline/dev-astforum`; gateway: `/opt/outline/dev-landing-auth/forum_dev_auth.py`.
- Gateway override: `/opt/outline/dev-landing-api.override.yaml`.
- Relay backup: `/opt/forum-api/backups/20260911T185501Z-relay`.
- Original dev deployment and backup: `/opt/forum-api/releases/20260911T183500Z`, `/opt/forum-api/backups/20260911T183500Z-dev`.

The original dev backup contains the previous dev site, gateway, Caddyfile, base Compose file,
previous API release path, and container IDs before and after deployment.
That release also contains `deploy.sh` and the deployed frontend build.
The relay backup contains the previous Caddyfile, API environment and release
path, and container IDs. The current release contains its deployment script,
the Caddy candidate, callback fragment and backend source.

The initial deployment changed only the API and dev gateway containers. The
relay deployment changed only the API container. Caddy was hot-reloaded without
recreation or restart; its bind-mounted configuration inode was preserved.
Only the main host's callback handler was added to Caddyfile. Other host blocks,
the main placeholder, dev gateway and base Outline Compose file stayed unchanged.
Bind-mounted root directories and old hashed frontend assets were preserved.
No database migrations or grant changes ran in this release.

## Sber Activation

The API uses `PUBLIC_ORIGIN=https://dev.astforum.ru` and `SBER_ID_ENABLED=false`.
The button currently returns the controlled unavailable message, not a fake login.
The registered callback is `https://astforum.ru/authorization`, not the dev origin.
The approved relay forwards GET requests from that exact path to
`https://dev.astforum.ru/authorization`, with the original query encoding.
It sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
The API explicitly permits this callback through
`SBER_ID_CALLBACK_RELAY_ORIGIN=https://astforum.ru`. Authentication cookies remain
host-only on dev; no cookie Domain attribute was introduced.

Before enabling Sber:

1. Confirm the expected ID-token issuer for this Sandbox application.
2. Enable the provider and complete registration, returning login, cancellation
   and logout with an authorized test user.

Do not simply set the enabled flag: the issuer is still missing. Cross-origin
callbacks without an explicit relay setting remain rejected. Do not share
session cookies across subdomains or disable TLS checks.
Legal-entity and entrepreneur buttons choose Diadoc links, but its backend is not implemented.

The corrected API origin is `https://oauth-sb.sber.ru:6443`. A diagnostic GET from
the deployed container, using its mounted client key/certificate and Ministry CA,
reported `tlsAuthorized=true`, TLS 1.3 and HTTP 400 JSON. HTTP 400 reflects the
missing OAuth parameters; no Client Secret or real authorization code was sent.
The certificate error observed on port 443 does not apply to this endpoint.

## Verification

- Backend: 37 tests, including relay configuration and dev cookie/code-exchange checks.
- Real local Caddy tests passed for exact query preservation, fixed destination,
  security headers, methods and isolation from unrelated hosts/routes.
- Initial frontend deployment: 15 frontend and 11 gateway tests passed.
- TypeScript checks, API build and landing build/layout checks passed.
- Local end-to-end tests with the certificate-authenticated fixture passed at 1440 and 390 px.
- Live dev browser checks passed at 1440 and 390 px: password gate, three account
  choices, single selection, arrow-key selection, provider URLs and disabled-provider feedback.
- Live session endpoint: HTTP 401 with `Cache-Control: no-store`; foreign-origin logout: HTTP 403.
- API readiness: HTTP 200, `status=ok`, `sberConfigured=false`.
- Main homepage returned HTTP 200 and matched its original SHA256:
  `afa3e70bb95ff75707972fdcdb17107ffa10231e945d581d2d77a8c0435ca93a`.
- Main GET `/authorization` returns HTTP 303 to dev; other methods do not redirect.
- Main `/api/auth/session` and `/auth/sber-id/start` remain HTTP 404.
- Dev `/authorization` reaches the API; it returns HTTP 404 while the provider is disabled.
- Live public checks verified the callback's query encoding and no-store/no-referrer headers.
- The new container passed strict TLS 1.3 to Sandbox on port 6443. A local config
  check used a synthetic issuer solely to exercise configuration loading, not OAuth
  validation or activation; the running provider flag remains false.

No real Sber account, successful code exchange or authenticated bank session was verified.

## Issuer Diagnostic

An operator-only probe is staged inside the current API container at
`/tmp/forum-issuer-probe-20260911/diagnostics/forum-issuer-probe-20260911.mjs`.
Its source and eight passing tests are in `apps/api/diagnostics/`.
It disappears when the container is recreated and is not an HTTP endpoint.
No API configuration, database, Caddy configuration or homepage was changed for this probe.

Run only when the user can safely open the Sandbox authorization page:

```sh
sudo docker exec forum-api-forum_api-1 node \
  /tmp/forum-issuer-probe-20260911/diagnostics/forum-issuer-probe-20260911.mjs \
  begin /tmp/forum-issuer-probe-20260911
```

The output contains an authorization URL, a private attempt directory and a ten-minute expiry.
Open that URL for the user. After authentication, capture the dev callback URL from the same browser.
The callback's HTTP 404 is expected while normal authentication remains disabled.
Pass that URL through standard input to the same command with `complete ATTEMPT_DIRECTORY`.
Do not put the callback code or full token in logs, shell history or documentation.
The exchange uses the original registered `https://astforum.ru/authorization` URI.

The probe validates state, nonce, audience, expiry and strict back-channel TLS.
It reports only `issuer`, `purpose: diagnostic_only` and `sessionCreated: false`.
Issuer equality is deliberately not checked: this observes a value, it does not authenticate a user.
Each attempt permits one exchange, including failures. Remove its private directory after use.
Do not use the observed value to enable normal authentication without confirming provider configuration.

As of 2026-09-11, no live attempt or token exchange has occurred.
The in-app browser reports `ERR_CERT_AUTHORITY_INVALID`; Chrome automation fails before navigation.
The user also reports a Chrome certificate warning, whose details have not been inspected.
Separately, a VPS connection to `id-sb.sber.ru:443` passed Node's default public CA validation.
That connection presented a Let's Encrypt YR1 chain, distinct from the Russian CA chain on
`oauth-sb.sber.ru:6443`. Do not substitute these trust configurations or bypass browser warnings.

## Operate

Run on the VPS. Include the gateway override when recreating that service:

```sh
sudo docker compose --project-name forum-api --project-directory /opt/forum-api/current/deployment/forum-api ps
sudo docker compose --project-name outline --project-directory /opt/outline \
  -f /opt/outline/docker-compose.yml -f /opt/outline/dev-landing-api.override.yaml \
  up -d --no-deps dev_landing_auth
```

The older `/opt/forum-api/runtime.env` belongs to the withdrawn main-domain release.
It is not the current dev API configuration. Do not use the main-domain Caddy
template or the broad dev deploy script to update this release without reviewing their scope.

## Rollback

To withdraw only the callback relay and return to the previous dev API, use the
procedure below. It has been reviewed but not executed. Stop if a comparison
fails; reconcile newer changes instead of overwriting them.

```sh
sudo -i
set -eu
release=/opt/forum-api/releases/20260911T185501Z
previous=/opt/forum-api/releases/20260911T183500Z
backup=/opt/forum-api/backups/20260911T185501Z-relay
test "$(readlink /opt/forum-api/current)" = "$release"
cmp /opt/outline/Caddyfile "$release/Caddyfile.candidate"
cmp "$previous/deployment/forum-api/.env" "$backup/previous.env"
cp "$backup/Caddyfile" /opt/outline/Caddyfile
docker exec outline-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --project-name forum-api --project-directory "$previous/deployment/forum-api" \
  up -d --no-build --wait --wait-timeout 120 forum_api
ln -s "$previous" /opt/forum-api/.current-rollback
mv -Tf /opt/forum-api/.current-rollback /opt/forum-api/current
```

No frontend, shared-password secret or database changes are required.

### Original Dev Deployment Rollback

The historical procedure below applies only after the callback relay has been
withdrawn and the previous dev release restored using the procedure above.

Rollback must preserve the main placeholder, shared-password secrets and all databases.
The following procedure was reviewed, but has not been executed against this release.
Stop and reconcile changes if a comparison fails.

```sh
sudo -i
set -eu
release=/opt/forum-api/releases/20260911T183500Z
backup=/opt/forum-api/backups/20260911T183500Z-dev
cmp /opt/outline/Caddyfile "$backup/Caddyfile"
cmp /opt/outline/docker-compose.yml "$backup/docker-compose.yml"
cmp /opt/outline/dev-landing-api.override.yaml "$release/dev-landing-api.override.yaml"
cmp /opt/outline/dev-landing-auth/forum_dev_auth.py "$release/deployment/dev-landing/auth-gateway/forum_dev_auth.py"
cmp /opt/outline/dev-astforum/landing/index.html "$release/deployment/dev-landing/dist/site/landing/index.html"
cp -a "$backup/site/." /opt/outline/dev-astforum/
install -m 0644 "$backup/gateway/forum_dev_auth.py" /opt/outline/dev-landing-auth/.gateway-rollback.py
mv /opt/outline/dev-landing-auth/.gateway-rollback.py /opt/outline/dev-landing-auth/forum_dev_auth.py
mv /opt/outline/dev-landing-api.override.yaml "$backup/withdrawn-dev-landing-api.override.yaml"
docker compose --project-name outline --project-directory /opt/outline \
  -f /opt/outline/docker-compose.yml up -d --no-deps dev_landing_auth
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" stop
```

This restores the previous dev page and gateway, then stops the new API. Leave
the current symlink pointing at the stopped release for inspection; do not enable
the old main-domain API. Old and new hashed assets may coexist without being referenced.
No Caddy reload, main-site copy, database restore or database deletion is required.
