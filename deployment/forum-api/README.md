# Forum API Deployment

Current API release: `20261001-sber-dns` on `https://dev.astforum.ru`.
Sber ID is enabled against the isolated Sandbox database. A live certificate-authenticated
code exchange confirmed `issuer=id-sb.sber.ru`. Sandbox requests use IPv4 because
the endpoint's AAAA lookup times out on this server. TLS verification remains enabled.
The registered `/authorization` callback uses the existing main-domain relay to dev.
See [the current dev deployment and rollback](DEV-DEPLOYMENT.md).

Everything below records the earlier main-domain deployment and its rollback.
Do not use its historical rollback commands to manage the current dev deployment.

## Previous Main-Domain Deployment

Status: rolled back on 2026-09-11 at the user's request. https://astforum.ru
serves the previous static site again. The authentication API is stopped and
its public routes have been removed. Local source code and deployment backups
are retained. The release record below describes the withdrawn deployment.

Rollback verification: the public homepage matched the backup byte for byte
(HTTP 200), and the static tree matched except for the untouched `.well-known`
directory. Caddy matched the previous configuration. New public assets were
moved to `backups/20260911T172652Z/withdrawn-public-assets`, not deleted.
The isolated Sandbox database and protected secrets remain for future work;
the main database was not restored or modified by the rollback.

## Release

- Deployed: 2026-09-11, approximately 17:36 UTC.
- Release: `/opt/forum-api/releases/20260911T172652Z`.
- Last-release symlink: `/opt/forum-api/current` (not an active deployment).
- Image: `astforum/forum-api:20260911T172652Z`.
- Compose project: `forum-api`; container: `forum-api-forum_api-1`.
- Runtime configuration: `/opt/forum-api/runtime.env`, root-owned mode `0600`.
- Secrets: `/opt/forum-api/secrets`, directory `0750`, files `0640`, owner `root:1000`.
- Backup: `/opt/forum-api/backups/20260911T172652Z` (Caddyfile, old site, main database dump).

The API runs as the image's non-root `node` user. Its filesystem is read-only,
Linux capabilities are dropped, and port 3001 is exposed only to Docker networks.
Secret files are mounted read-only outside the website and are not in the image.
The original PKCS#12 file was not published or copied into the image.

## Database And Routing

Sandbox identities use the separate `forum_sber_sandbox` database and
`forum_sber_sandbox_app` role. The runtime role can create identities and sessions
but cannot change audit events, delete outbox events or create tables.
Access to the main `forum` database is denied. Its existing tables were unchanged.

The tested migration ran twice to verify idempotency. At this historical Sandbox
release, the then-current `grant-runtime.sql` was applied with its `forum_app_role`
identifier replaced by the dedicated Sandbox role. The current file targets the
main database after public-schema consolidation (migration 003); it must not be
reused for this legacy Sandbox by substituting the role name.

Only the `astforum.ru` host block in `/opt/outline/Caddyfile` was replaced with
`astforum.caddy`. Caddy was hot-reloaded without recreating other containers.
Routes `/authorization`, `/auth/sber-id/*` and `/api/auth/*` reach `forum_api:3001`.
The static landing is under `/opt/outline/astforum`; `.well-known` was preserved.
The dev site's password protection and all other host blocks remain unchanged.

## Verification

- Backend: 35 tests passed; frontend: 15 tests passed; landing build/layout passed.
- API readiness: HTTP 200, `status=ok`, `sberConfigured=false`.
- Public landing: HTTP 200 with no-cache HTML and the required script/frame CSP.
- Session without cookies: HTTP 401 JSON with `Cache-Control: no-store`.
- Logout with another Origin: HTTP 403 `invalid_origin`.
- Sber start: HTTP 303 to the landing's controlled `sber_unavailable` message.
- `/authorization` reaches the API; an unsolicited callback returns 404 while disabled.
- `.env`, client secret and private-key web paths: HTTP 404.
- Browser checks: three account choices, provider links, keyboard selection,
  1440px desktop and 390px mobile layouts, and the unavailable-provider message.
- Main database backup was readable with `pg_restore --list`.
- Docs, dev, calendar, mail, pgAdmin, webmail and campaigns still respond.

The browser's unauthenticated session request correctly produces HTTP 401.
An unrelated missing `/favicon.ico` also produced HTTP 404 during the initial visit.
Diadoc buttons select separate URLs, but its backend is not implemented by this release.
No real bank account, registration, token exchange or authenticated session was verified.

## Sandbox Endpoint Correction

Follow-up verification on 2026-09-11 identified the missing port in the initial
configuration. Sber's [testing guide](https://developers.sber.ru/docs/ru/sberid/service/how-to-test)
links an [official Postman collection](https://documenter.getpostman.com/view/10935182/2sA3Qqes13)
that explicitly requires `https://oauth-sb.sber.ru:6443` for the test API.
Its token URL is `https://oauth-sb.sber.ru:6443/ru/prod/tokens/v2/oidc`.
The collection uses the same origin for userinfo and completion requests.

Read-only verification from `forum-prod` succeeded using the existing client
certificate, encrypted key and Ministry CA. OpenSSL reported `Verification: OK`
and `Verified peername: oauth-sb.sber.ru`. A temporary Node 24 container reported
`tlsAuthorized=true`, TLS 1.3, and HTTP 400 JSON for a diagnostic GET without
OAuth parameters. No Client Secret or real authorization code was sent.
The diagnostic container was removed; the rolled-back API remains stopped.

The server's chain on port 6443 is:

```text
Leaf: CN=id-sb.sber.ru
SAN: id-sb.sber.ru, oauth-sb.sber.ru, bio.oauth-sb.sber.ru
Intermediate: Russian Trusted Sub CA
Root: Russian Trusted Root CA
Root SHA256: D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
```

The server sends the intermediate certificate. The root matches the existing
`sber-server-ca.pem`; no additional CA installation or TLS bypass was needed.
The application's client chain (`Sandbox Intermediate` -> `Sandbox RootCA`) is
separate and must not be confused with the server trust chain.

Only local documentation changed during that verification. The subsequent dev
release corrected the runtime origin with a regression test. The expected issuer
and end-to-end OAuth acceptance remain unverified.

### Historical Port-443 Failure

The deployed API container checked both endpoints with TLS verification enabled:

| Host | Result |
| --- | --- |
| `oauth-sb.sber.ru` | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` before HTTP authentication |
| `oauth-ift.sber.ru` | Connection timeout after 10 seconds |

The client certificate is valid through 2027-07-29 and matches the encrypted key.
A separate certificate inspection from the VPS observed:

```text
SNI: oauth-sb.sber.ru
Server SAN: DNS:pslsg-idsb00006.cloud.sigma.sbrf.ru
Issuer: C=RU, O=Sberbank of Russia, CN=SberCA Ext
Hostname matches: false
SHA256: 09:CA:6B:AF:70:95:DF:50:CF:94:DF:57:0C:BD:F9:9C:6F:8C:A8:23:D3:BD:E9:2C:CF:EF:CE:03:F7:78:77:AD
```

The missing port explains the initial TLS failure; it is not evidence that the
certificate on the required port 6443 is broken. Sber's text guides remain
inconsistent with the official collection. Confirm any unresolved application
settings and the expected ID-token issuer with support. The registered redirect is
`https://astforum.ru/authorization`. Do not include secrets or private keys in the request.
Adding a trusted CA alone cannot resolve a hostname mismatch.

Keep `SBER_ID_ENABLED=false` until the callback and issuer are configured for dev
and end-to-end acceptance can proceed.
Do not disable certificate validation or substitute the internal certificate hostname.
Before public production acceptance, provision production credentials and a separate
production configuration; this deployment uses test credentials and an isolated database.
Configure verified proxy addresses or edge rate limiting before opening general access;
the current conservative limit is shared by requests arriving through the proxy.

## Inspect And Roll Back

Run these commands on the VPS:

```sh
sudo docker compose --project-name forum-api --project-directory /opt/forum-api/current/deployment/forum-api ps
sudo docker exec forum-api-forum_api-1 node -e "fetch('http://127.0.0.1:3001/health/ready').then(async r=>console.log(r.status,await r.json()))"
```

To restore the previous site, first verify that Caddy has not changed since this
release. If the comparison fails, merge only the old `astforum.ru` block instead
of overwriting newer changes to other domains. Do not replace the bind-mounted
Caddyfile inode or the site's root directory.

```sh
sudo -i
set -eu
release=/opt/forum-api/releases/20260911T172652Z
backup=/opt/forum-api/backups/20260911T172652Z
cmp /opt/outline/Caddyfile "$release/Caddyfile.candidate"
for entry in "$backup/site"/*; do
    if [ "$(basename "$entry")" != index.html ]; then
        cp -a "$entry" /opt/outline/astforum/
    fi
done
install -m 0644 "$backup/site/index.html" /opt/outline/astforum/.index-rollback.html
mv /opt/outline/astforum/.index-rollback.html /opt/outline/astforum/index.html
cp "$backup/Caddyfile" /opt/outline/Caddyfile
docker exec outline-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --project-name forum-api --project-directory "$release/deployment/forum-api" stop
```

This rollback leaves `.well-known`, the Sandbox database, secrets and backups intact.
Do not restore the main database dump or drop any database as part of a site rollback.
