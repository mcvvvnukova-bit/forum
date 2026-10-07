# Legacy landing source and gateway history

This package retains the earlier landing build and gateway integration context.
The current dev UI is owned by [`apps/web`](../web/README.md); publication follows
[`deployment/release.md`](../../deployment/release.md).

The historical bootstrap used the `/opt/outline` Docker Compose project and Caddy origin:

- static files are copied to `/opt/outline/dev-astforum`;
- the auth gateway is copied to `/opt/outline/dev-landing-auth`;
- Docker Compose runs `dev_landing_auth` from the official Python image;
- the Caddyfile proxies `dev.astforum.ru` to the auth gateway before the final `404`;
- the gateway serves a Primer password screen until the shared password is accepted;
- successful login sets a signed `HttpOnly` cookie and then serves the landing page;
- `/_landing_health` returns `ok`;
- `/api/demo-request` is reserved for the future server-side Bitrix24 integration and currently returns `501`;
- the landing's «Выбрать время» link opens the self-hosted Cal.diy popup at `https://cal.astforum.ru/demo/60min` and remains a public-link fallback if the embed cannot load;
- the dev host is marked `noindex`.

## User Authentication

User registration/login is handled by the NestJS API in `apps/api`, separately
from the shared dev password. Set `FORUM_API_ORIGIN` for the gateway (the deploy
template uses `http://forum_api:3001`). The gateway forwards Sber start/callback,
session lookup and logout, preserving cookies and suppressing query strings in
its request logs. The API deployment and credential setup are documented in
[`apps/api/README.md`](../../apps/api/README.md).

For local Vite development, the landing root and `/landing.html` both open the
landing. `/auth/sber-id/*` and `/api/auth/*` proxy to `http://127.0.0.1:3001` by
default, configurable with `FORUM_API_ORIGIN`. Keep the API's `PUBLIC_ORIGIN`
equal to the browser origin, including the local port.

## Retired deployment entrypoint

`scripts/deployment/legacy-landing/deploy.sh` always exits with an error before
reading deployment state, prompting, creating backups or writing files. Ordinary
invocation, `--set-password`, environment-provided passwords and first bootstrap
are all disabled. It must not be used for publishing or password maintenance.

The old bootstrap/recovery source is preserved as inert text in that file for
review and isolated historical rollback tests. It deletes the mounted site parent
and its shared lock inode and cannot safely coexist with unified releases. There
is no force override or live recovery/password workflow through this entrypoint.
Use the unified release procedure linked above for current web publication.

## Historical gateway verification

```sh
scripts/verification/verify-legacy-public.sh
```

To include the successful-login check on the VPS, run the verifier as root so it
can read `/opt/outline/secrets/dev_landing_password`:

```sh
sudo scripts/verification/verify-legacy-public.sh
```

The same checks can be run manually:

```sh
curl -fsSIL https://dev.astforum.ru/ | sed -n '1,20p'
curl -fsS https://dev.astforum.ru/ | grep -F 'АСТ Форум — вход'
curl -fsS https://dev.astforum.ru/robots.txt
curl -fsS https://dev.astforum.ru/_landing_health
curl -sS -o /dev/null -w '%{http_code}\n' https://dev.astforum.ru/api/demo-request
```

Expected status for `/api/demo-request` is `501` until the Bitrix24 proxy service is implemented.
