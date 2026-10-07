# Outline Mailpit Authentication Implementation Plan

Исторический технический план от 2026-08-20. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Происхождение: `docs/superpowers/plans/2026-08-20-outline-mailpit-auth.md`, SHA-256 `b77e794259f8727c10e03de2a8444d72d7dadd477ca9efb75973c9df006d2365`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google OAuth in the local Outline installation with email magic-link authentication delivered to an ephemeral local Mailpit inbox.

**Architecture:** Keep Outline 1.9.2 behind the existing local Caddy HTTPS proxy. Add Mailpit as an internal SMTP service on Docker port 1025 and expose only its web inbox on `127.0.0.1:8025`; remove all Google credentials from Outline and its local environment.

**Tech Stack:** Docker Desktop, Docker Compose, Outline 1.9.2, Caddy 2, Mailpit 1.30, PostgreSQL 18, Redis 8.

## Global Constraints

- Outline remains available at `https://localhost:3000`.
- Mailpit uses image `axllent/mailpit:v1.30`.
- Mailpit SMTP port 1025 is Docker-internal and is not published on the host.
- Mailpit web UI is published only as `127.0.0.1:8025:8025`.
- Mailpit has no persistent volume; messages may disappear after container recreation.
- Google OAuth variables are removed from Compose, `.env`, and `.env.example`.
- The Google Cloud OAuth client is not deleted.
- Real email delivery and production hardening are out of scope.
- `/path/to/local-outline` is intentionally outside the Git repository; do not initialize a repository there.

---

## File Map

- `/path/to/local-outline/docker-compose.yml`: defines Outline SMTP settings and the Mailpit service.
- `/path/to/local-outline/.env`: stores only runtime secrets still required by Outline, PostgreSQL, and Redis.
- `/path/to/local-outline/.env.example`: documents the remaining secret variables without Google credentials.
- `/path/to/local-outline/README.md`: documents email login, Mailpit access, and operational checks.

### Task 1: Replace Google OAuth configuration with Mailpit SMTP

**Files:**
- Modify: `/path/to/local-outline/docker-compose.yml`
- Modify: `/path/to/local-outline/.env`
- Modify: `/path/to/local-outline/.env.example`

**Interfaces:**
- Consumes: the existing Docker Compose network and Outline service.
- Produces: SMTP endpoint `mailpit:1025`, Mailpit web endpoint `http://127.0.0.1:8025`, and an Outline environment with no Google provider.

- [ ] **Step 1: Record the failing configuration assertions**

Run:

```bash
cd /path/to/local-outline
rg -n 'GOOGLE_CLIENT_(ID|SECRET)|SMTP_HOST|mailpit' docker-compose.yml .env.example
if rg -q '^GOOGLE_CLIENT_(ID|SECRET)=' .env; then
  echo 'Google credentials are still configured'
  exit 1
fi
```

Expected: the source search shows Google variables and no Mailpit service; the
second check fails because Google credentials are still present in `.env`.
Do not print the contents of `.env`.

- [ ] **Step 2: Replace the Outline authentication environment**

In `docker-compose.yml`, replace:

```yaml
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:?Set GOOGLE_CLIENT_ID in .env}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:?Set GOOGLE_CLIENT_SECRET in .env}
```

with:

```yaml
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
      SMTP_SECURE: "false"
      SMTP_FROM_EMAIL: "Outline Local <outline@local.test>"
      SMTP_REPLY_EMAIL: outline@local.test
```

Add Mailpit to the Outline dependencies:

```yaml
      mailpit:
        condition: service_started
```

- [ ] **Step 3: Add the isolated Mailpit service**

Add this service to `docker-compose.yml`:

```yaml
  mailpit:
    image: axllent/mailpit:v1.30
    ports:
      - "127.0.0.1:8025:8025"
    environment:
      MP_MAX_MESSAGES: "100"
    restart: unless-stopped
```

Do not add a Mailpit volume and do not publish port 1025.

- [ ] **Step 4: Remove Google credentials from local environment files**

Delete the assignments whose keys are listed below from `.env` without
displaying their values:

```env
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

Replace the Google section in `.env.example` so the complete file is:

```env
# Copy this file to .env. Never commit .env.
POSTGRES_PASSWORD=
OUTLINE_SECRET_KEY=
OUTLINE_UTILS_SECRET=
```

Preserve mode `600` on `.env`.

- [ ] **Step 5: Validate the static configuration**

Run:

```bash
cd /path/to/local-outline
docker compose config --quiet
rg -n 'SMTP_HOST: mailpit|127\.0\.0\.1:8025:8025|axllent/mailpit:v1\.30' docker-compose.yml
if rg -q 'GOOGLE_CLIENT_(ID|SECRET)' docker-compose.yml .env .env.example; then
  echo 'Google configuration remains'
  exit 1
fi
test "$(stat -f '%Lp' .env)" = "600"
```

Expected: Compose validation succeeds, all three Mailpit assertions are found,
no Google variables are found, and `.env` remains mode 600.

### Task 2: Document and verify the complete login flow

**Files:**
- Modify: `/path/to/local-outline/README.md`

**Interfaces:**
- Consumes: Outline at `https://localhost:3000` and Mailpit at `http://localhost:8025`.
- Produces: a documented and verified magic-link login flow for a local test user.

- [ ] **Step 1: Replace Google instructions in README**

Replace the `Google OAuth` section with:

````markdown
## Вход через email и Mailpit

Введите любой тестовый email на странице входа Outline. Письмо не отправляется
в интернет, а появляется в локальном Mailpit:

```text
http://localhost:8025
```

Откройте последнее письмо от Outline и перейдите по magic link. Письма Mailpit
не сохраняются при пересоздании контейнера.
````

Add these operational commands:

````markdown
Логи Mailpit:

```bash
docker compose logs --tail=100 mailpit
```

Проверка веб-интерфейса Mailpit:

```bash
curl -fsS http://localhost:8025/api/v1/info
```
````

- [ ] **Step 2: Start the revised stack**

Run:

```bash
cd /path/to/local-outline
docker compose up -d --remove-orphans
docker compose ps
```

Expected: `outline`, `caddy`, `postgres`, `redis`, and `mailpit` are
running. Services with healthchecks become healthy.

- [ ] **Step 3: Verify HTTP endpoints and logs**

Run:

```bash
curl -kfsS -o /dev/null -w 'outline=%{http_code}\n' https://localhost:3000
curl -fsS -o /dev/null -w 'mailpit=%{http_code}\n' http://localhost:8025/api/v1/info
docker compose logs --tail=100 outline
docker compose logs --tail=100 mailpit
```

Expected: both HTTP checks return 200; logs contain no environment-validation,
SMTP-connection, migration, or startup errors.

- [ ] **Step 4: Verify the login page**

Open `https://localhost:3000` in Chrome and inspect the rendered page.

Expected:

- there is an email input and a button to request a sign-in link;
- there is no `Continue with Google` button;
- the page has no visible 500 error.

- [ ] **Step 5: Request and inspect a magic link**

Enter `outline-test@local.test` in Outline and request a sign-in link. Open
`http://localhost:8025`, then open the newest message.

Expected: exactly one new Outline login email appears for
`outline-test@local.test`, and it contains a link beginning with
`https://localhost:3000/`.

- [ ] **Step 6: Complete end-to-end authentication**

Open the magic link from Mailpit in the same Chrome profile.

Expected: Outline opens without an authentication error and shows either the
new-workspace onboarding screen or the authenticated workspace. Reopening
`https://localhost:3000` keeps the authenticated session.

- [ ] **Step 7: Run final configuration checks**

Run:

```bash
cd /path/to/local-outline
docker compose config --quiet
docker compose ps
if rg -q 'GOOGLE_CLIENT_(ID|SECRET)' docker-compose.yml .env .env.example; then
  echo 'Google configuration remains'
  exit 1
fi
curl -kfsS -o /dev/null -w 'outline=%{http_code}\n' https://localhost:3000
curl -fsS -o /dev/null -w 'mailpit=%{http_code}\n' http://localhost:8025/api/v1/info
```

Expected: Compose validation succeeds, the stack is running, Google
configuration is absent, and both endpoints return 200.

No Git commit is created for `/path/to/local-outline` because that directory
is intentionally outside the project repository.
