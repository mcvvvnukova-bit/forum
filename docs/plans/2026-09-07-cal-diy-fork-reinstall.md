# Cal.diy Fork and Clean VPS Installation

Исторический технический план от 2026-09-07. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Происхождение: `docs/superpowers/plans/2026-09-07-cal-diy-fork-reinstall.md`, SHA-256 `073a47eccba42b862da2d0da7fb5246a1554bba0ce5c9bbf7a57e625e7b53c79`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution remains in this session; deployment, fork creation, and deletion of previous Cal installations and their backups are explicitly authorized by the user.

**Goal:** Create a dedicated GitHub fork of MIT-licensed Cal.diy, erase the previous Cal.com/Cal.diy server installations and their backups, and run the fork at https://cal.astforum.ru.

**Architecture:** A separate repository and Docker Compose project in `/opt/astforum-cal-diy`, using its own PostgreSQL and Redis volumes. The existing Caddy reverse proxy connects to the new web service over `outline_frontend`. Application source and migrations must come from the same pinned fork commit.

**Tech Stack:** Cal.diy, Node.js, Next.js, PostgreSQL 16, Redis 8, Docker Compose, Caddy, GitHub.

**Spec:** The user's 2026-09-07 request in this task: delete all current server versions of Cal.com/Cal.diy and their backups; create a separate GitHub fork of Cal.diy; install it on the astforum VPS.

## Global Constraints

- Host: SSH alias `forum-prod`; architecture `linux/amd64`; domain `cal.astforum.ru`.
- Repository: `mcvvvnukova-bit/astforum-cal-diy`, upstream `calcom/cal.diy`.
- Do not migrate old accounts, credentials, schedules, or demo settings into the new installation.
- Delete only positively identified Cal resources. Preserve Outline, PostgreSQL for Forum, pgAdmin, landing pages, and their unrelated backups.
- Never publish real environment files, credentials, database dumps, or server access data to GitHub.
- No Cal.com image or commercial EE code as fallback.
- Keep changes scoped to deployment; no manager-routing or integration feature development in this task.

## Task 1: Fork and reproducible deployment

- [x] Create the fork through `gh repo fork calcom/cal.diy --fork-name astforum-cal-diy --clone=false --default-branch-only`.
- [x] Clone into an independent local repository; retain an `upstream` remote and use a `codex/` deployment branch for changes.
- [x] Read the new repository's `AGENTS.md`, Dockerfile, startup script, and package commands.
- [x] Add a production Compose configuration for `web`, `database`, and `redis`, with a non-published database port, correct PostgreSQL data directory, health checks, external proxy network, and image revision labels.
- [x] Build the fork's Linux AMD64 image using its Dockerfile and throwaway build-only database credentials. Run deployment configuration checks and applicable type checks before publishing changes.
- [x] Commit only deployment files and publish the branch to the fork.

## Task 2: Remove previous Cal resources

- [x] Inventory old containers, named volumes, image IDs, source directories, individual backup files, shared backup archive entries, and build-cache records.
- [x] Stop and remove only `outline-calcom-1`, `outline-cal_postgres-1`, and `outline-cal_redis-1`; remove `astforum-cal-postgres` and `astforum-cal-redis`.
- [x] Remove the old Cal blocks from `/opt/outline/docker-compose.yml` and the old Cal environment files and marker.
- [x] Remove the verified old Cal source directory, diagnostic temporary files, Cal-only backup files/directories, and old Cal image. Shared Outline backups contain only Outline's database and storage, confirmed by its backup script.
- [x] Verify absent old resources and healthy unrelated services. Report the permanent deletion explicitly.

## Task 3: Install and verify the fork

- [x] Create new server-only credentials and a clean PostgreSQL database; run the fork's own migrations and app-store seed.
- [x] Run the pinned fork image in the new Compose project; update only the Cal upstream in Caddy and validate/reload its configuration.
- [x] Verify the installed image's source/revision, MIT license, schema compatibility, container health, HTTP availability, initial setup flow, and absence of Prisma errors.
- [x] Keep initial setup accessible only through an appropriate protected handoff if no account is initialized; do not leave an unclaimed public administrator setup indefinitely.
- [x] Verify `astforum.ru`, `dev.astforum.ru`, `docs.astforum.ru`, and `pg.astforum.ru` remain reachable.
- [x] Hand over the repository URL, application URL, setup/access details, exact deployed revision, and deletion status.

## Execution notes

- Deployment commit: `1cc628cb98e5882608997872d6101f78940e62eb` on `codex/astforum-deployment`.
- Local isolated clone: `/path/to/isolated-cal-diy-clone`.
- The first build stalled because `registry.yarnpkg.com` resolved to `104.16.11.34`, which did not complete TLS connections from this VPS. A reproducible `curl --resolve` check timed out against that IP and returned HTTP 200 against `104.16.8.34`. The build-only host mappings for npm/Yarn now select the working official CDN address; certificate validation remains enabled.
- After preserving the first build's package cache, the remaining 8 packages downloaded in 3.7 seconds. No application dependency versions were changed to fix the network issue.
- Old Cal build-history records and reclaimable cache were removed. Docker still reports some non-reclaimable shared layers; no old Cal image/container/volume or server backup remains.

## Verification and handoff

- Published branch: `codex/astforum-deployment` in `mcvvvnukova-bit/astforum-cal-diy`; the fork relationship to `calcom/cal.diy` was verified through GitHub.
- Image: `astforum/cal-diy:1cc628cb98e5`, architecture `amd64`, MIT/source/revision labels verified. No `packages/features/ee` directory in the image.
- Production Next.js build and its TypeScript check passed. Deployment shell syntax, Compose configuration, and Git whitespace checks passed. The upstream full unit/E2E suite was not run; verification was scoped to deployment and actual service/API smoke tests.
- All 595 migrations are applied; `prisma migrate diff` reports `No difference detected` and exits 0.
- Web, PostgreSQL, and Redis are healthy. Web restart count is 0.
- Administrative account creation and credential delivery evidence remain private; this plan does not publish user identity or passwords.
- Sign-in, authenticated session, event types, bookings, availability, bookings API, and availability API passed both internally and via public HTTPS. Bookings and schedules are empty, as expected for a clean install.
- Repeated administrator setup returns HTTP 400; public signup returns HTTP 403.
- Administrator privileges are temporarily limited to `INACTIVE_ADMIN` until the owner enables two-factor authentication; the password meets the required complexity.
- SMTP, external calendar/video integrations, demo types, and new automated backups are not configured by this installation task.
- All four unrelated sites return HTTP 200. The temporary build database, temporary 8 GiB swap file, source upload archive, bootstrap credential file, and installation helper files were removed. Runtime secrets remain in a server-only file with mode 0600.
