# OpenProject VPS Deployment Implementation Plan

Исторический технический план от 2026-09-18. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Происхождение: `docs/superpowers/plans/2026-09-18-openproject-vps.md`, SHA-256 `fe708d1ec9ff6272ca5e404bcddf639aafac06df87f090c3ac2226b480d983e9`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** Execute these deployment tasks sequentially in this session. The user has authorized installation on VPS forum and publication at roadmap.astforum.ru.

**Goal:** Install OpenProject Community at `https://roadmap.astforum.ru` on the existing forum VPS.

**Architecture:** A separate Compose project in `/opt/openproject` runs the official OpenProject slim image, PostgreSQL, Memcached, background worker, and collaborative editing server. Existing origin Caddy routes the hostname through `outline_frontend`; the existing external HTTPS gateway must route the hostname to `172.16.160.16:80` and terminate TLS.

**Tech Stack:** Debian 13, Docker Compose, OpenProject 17.8.0, PostgreSQL 17, Memcached 1.6, Caddy 2.10.

## Global Constraints

- VPS SSH alias: `forum-prod`, public IP `84.47.165.130`, origin VM `172.16.160.16`.
- Public URL: `https://roadmap.astforum.ru`.
- Preserve unrelated containers, data, and existing Caddy routes.
- Database and cache have no published ports. Application access is through Caddy only.
- Generate bootstrap credentials and application secrets on the VPS; keep them out of Git and command output.
- Fresh server installation; the local OpenProject remains separate.
- Verify public DNS and trusted HTTPS before claiming the requested public deployment is complete.

---

### Task 1: Inventory and deployment configuration

**Files:** `deployment/openproject/compose.yaml`, `deployment/openproject/Caddy.route`, remote `/opt/openproject/.env`.

**Interfaces:** Uses existing Docker Engine and external network `outline_frontend`; exposes internal network aliases `astforum-openproject-web:8080` and `astforum-openproject-collaboration:1234` to Caddy.

- [x] Verify SSH, sudo, memory/disk availability, existing routes, networks, and DNS.
- [x] Create the isolated Compose stack, persistent volumes, health checks, and generated passwords.
- [x] Run `docker compose -f /opt/openproject/compose.yaml config --quiet` and download official images.

### Task 2: Initialize and publish the origin

**Files:** Remote `/opt/outline/Caddyfile`, backed up under `/opt/openproject/backups/`.

**Interfaces:** Requires successful PostgreSQL initialization and seeder exit status 0; produces OpenProject login and WebSocket routes for the specified Host header.

- [x] Start PostgreSQL/cache, run the seeder, and start web/worker/collaboration services.
- [x] Verify `/health_checks/default`, Russian login form, bootstrap administrator, and persistent mounts.
- [x] Save the current Caddyfile; insert only the OpenProject route, validate with `caddy validate`, then hot-reload Caddy.
- [x] Verify existing origin sites still return their expected HTTP status.

### Task 3: Public DNS, HTTPS, backup, and handoff

**Files:** `deployment/openproject/README.md`, remote `/opt/openproject/backup.sh`, `/var/backups/openproject/`, DNS zone `astforum.ru`, external HTTPS gateway configuration.

**Interfaces:** DNS `A roadmap 84.47.165.130`; edge proxy preserves Host and supports WebSockets to origin port 80.

- [x] Add the single DNS record through REG.RU.
- [x] Verify publication on authoritative DNS and public resolvers.
- [ ] Configure or obtain configuration of the existing HTTPS gateway for the new hostname.
- [ ] Verify trusted public HTTPS, HTTP redirect, static assets, login page, and collaboration routing.
- [x] Create and verify an initial database/assets/configuration backup; document restore and credentials retrieval.
- [x] Record any remaining external dependency precisely and provide the working URL only after end-to-end verification.

## Verification and remaining dependency

The origin login form and static assets return HTTP 200. The generated administrator password reaches the mandatory password-change form; that page intentionally returns HTTP 422. The collaboration endpoint completes a WebSocket upgrade with HTTP 101. Existing eight origin hostnames retain their prior response codes. The database and web health checks pass.

Initial backup: `/var/backups/openproject/20260918T124145Z`. PostgreSQL archive listing, attachment archive listing, and SHA256 checks passed. Web, worker, and collaboration were restarted afterward.

The user completed REG.RU login. The `A roadmap → 84.47.165.130` record was added on 2026-09-18 and its publication was confirmed on ns1.reg.ru, ns2.reg.ru, 1.1.1.1, and 8.8.8.8. Direct HTTPS with the requested SNI to `84.47.165.130` still returns a TLS internal-error alert after DNS publication. Access to the external gateway remains the outstanding dependency. A gateway Caddy site example is prepared in `deployment/openproject/edge-Caddyfile.example`.
