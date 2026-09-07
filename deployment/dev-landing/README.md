# Dev landing deployment

This package prepares `dev.astforum.ru` on the existing AST Forum VPS.

It uses the current `/opt/outline` Docker Compose project and Caddy origin:

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

## Deploy

Upload the package without requiring `rsync` on the VPS:

```sh
ssh forum-prod 'rm -rf /home/testing-user/dev-astforum-deploy.tmp && mkdir -p /home/testing-user/dev-astforum-deploy.tmp'
COPYFILE_DISABLE=1 tar --no-xattrs --exclude './node_modules' -C deployment/dev-landing -cf - . \
  | ssh forum-prod 'tar -C /home/testing-user/dev-astforum-deploy.tmp -xf -'
ssh forum-prod 'chmod +x /home/testing-user/dev-astforum-deploy.tmp/deploy.sh /home/testing-user/dev-astforum-deploy.tmp/verify-public.sh && rm -rf /home/testing-user/dev-astforum-deploy && mv /home/testing-user/dev-astforum-deploy.tmp /home/testing-user/dev-astforum-deploy'
```

Apply on the VPS:

```sh
ssh -t forum-prod 'sudo /home/testing-user/dev-astforum-deploy/deploy.sh'
```

Set or replace the shared password during deploy:

```sh
ssh -t forum-prod 'sudo /home/testing-user/dev-astforum-deploy/deploy.sh --set-password'
```

If no password exists and `--set-password` or `DEV_LANDING_PASSWORD` is not
provided, the script generates one at
`/opt/outline/secrets/dev_landing_password`.

## Verify

```sh
deployment/dev-landing/verify-public.sh
```

To include the successful-login check on the VPS, run the verifier as root so it
can read `/opt/outline/secrets/dev_landing_password`:

```sh
ssh -t forum-prod 'sudo /home/testing-user/dev-astforum-deploy/verify-public.sh'
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

## Troubleshooting

### `sudo: a password is required`

The SSH alias works, but the current VPS user does not have passwordless sudo.
Run the apply command from an interactive terminal, or temporarily grant
passwordless sudo for this maintenance step.

Do not put the sudo password in the repository or chat history.
