# Outline Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Outline Community Edition 1.9.2 at `https://docs.astforum.ru` on the Debian 13 production VM, with private PostgreSQL and Redis services, persistent attachments, HTTPS through the provider edge, and daily local backups.

**Architecture:** Docker Compose under `/opt/outline` runs Outline, PostgreSQL, Redis, and an HTTP-only Caddy origin. Only origin port 80 is published; the existing provider Caddy edge terminates HTTPS and forwards requests to the VM. Application and database secrets are generated on the VM, stored as root-readable Docker secret files, and never committed.

**Tech Stack:** Debian 13, Docker Engine and Compose v2, Outline 1.9.2, PostgreSQL 18, Redis 8, Caddy 2.10, systemd.

**Spec:** User request in the Codex task dated 2026-08-21.

## Global Constraints

- Public URL is exactly `https://docs.astforum.ru`.
- Use the official Outline Community Edition image pinned to `1.9.2`.
- Do not publish PostgreSQL, Redis, or Outline ports to the host.
- Preserve all existing workspace changes and unrelated server state.
- Do not print or commit SSH, database, or application secrets.
- Authentication uses SMTP magic-link through the REG.RU mailbox `docs@astforum.ru`.
- DNS requires an external `A` record for `docs.astforum.ru` pointing to `84.47.165.130`.

---

### Task 1: Establish key-based production access

**Files:**
- Create: `/Users/vvv/.ssh/forum-prod`
- Create: `/Users/vvv/.ssh/forum-prod.pub`
- Create: `/Users/vvv/.ssh/config`
- Modify remotely: `/home/testing-user/.ssh/authorized_keys`

**Interfaces:**
- Consumes: password-authenticated SSH at `testing-user@84.47.165.130:15833`.
- Produces: non-interactive `ssh forum-prod` access using the Ed25519 key.

- [x] **Step 1: Generate a dedicated Ed25519 key named `forum-prod`**
- [x] **Step 2: Add the `forum-prod` SSH alias with host, user, port, and identity**
- [x] **Step 3: Install the public key with `ssh-copy-id`**
- [x] **Step 4: Verify key-only access with `ssh forum-prod`**

### Task 2: Install Docker Engine from the official Debian repository

**Files:**
- Create remotely: `/etc/apt/keyrings/docker.asc`
- Create remotely: `/etc/apt/sources.list.d/docker.sources`

**Interfaces:**
- Consumes: clean Debian 13 host with sudo access.
- Produces: enabled Docker Engine and Docker Compose v2 services.

- [x] **Step 1: Install CA certificates and curl**
- [x] **Step 2: Add Docker's official signing key and `trixie` apt source**
- [x] **Step 3: Install `docker-ce`, CLI, containerd, Buildx, and Compose plugin**
- [x] **Step 4: Enable Docker and verify both Engine and Compose versions**

### Task 3: Deploy the isolated Outline stack

**Files:**
- Create remotely: `/opt/outline/docker-compose.yml`
- Create remotely: `/opt/outline/docker.env`
- Create remotely: `/opt/outline/Caddyfile`
- Create remotely: `/opt/outline/secrets/outline_secret_key`
- Create remotely: `/opt/outline/secrets/outline_utils_secret`
- Create remotely: `/opt/outline/secrets/postgres_password`
- Create remotely: `/opt/outline/secrets/database_url`
- Create remotely: `/opt/outline/secrets/smtp_password`

**Interfaces:**
- Consumes: Docker Compose v2 and public URL `https://docs.astforum.ru`.
- Produces: restart-safe services `outline`, `postgres`, `redis`, and `caddy`, with named persistent volumes and no host exposure except port 80.

- [x] **Step 1: Install the reviewed Compose, Outline environment, and Caddy origin configuration under `/opt/outline`**
- [x] **Step 2: Generate 32-byte application and database secrets directly on the VM with restricted file permissions**
- [x] **Step 3: Validate the rendered Compose configuration without printing secrets**
- [x] **Step 4: Pull the pinned images and start the stack**
- [x] **Step 5: Verify PostgreSQL and Redis health, successful Outline migrations, and HTTP origin response**

### Task 4: Configure and verify backups

**Files:**
- Create remotely: `/usr/local/sbin/outline-backup`
- Create remotely: `/etc/systemd/system/outline-backup.service`
- Create remotely: `/etc/systemd/system/outline-backup.timer`
- Create remotely: `/var/backups/outline/`

**Interfaces:**
- Consumes: running Outline Compose project and named data volumes.
- Produces: daily PostgreSQL dumps and attachment archives retained locally for 14 days.

- [x] **Step 1: Install the root-owned backup script and systemd units**
- [x] **Step 2: Enable the daily timer**
- [x] **Step 3: Run an immediate backup and verify non-empty database and attachment artifacts**

### Task 5: Publish and finish application setup

**Files:**
- Modify externally: DNS zone for `astforum.ru`
- Modify remotely after provider choice: `/opt/outline/docker.env`

**Interfaces:**
- Consumes: REG.RU DNS access and one supported authentication provider.
- Produces: valid public HTTPS endpoint and a usable Outline sign-in flow.

- [x] **Step 1: Create `A docs.astforum.ru 84.47.165.130` in REG.RU DNS**
- [ ] **Step 2: Verify public TLS and WebSocket-compatible reverse proxying through the provider Caddy edge** — blocked pending access to the external Caddy configuration; HTTP redirects correctly, but TLS returns an internal-error alert without a certificate.
- [x] **Step 3: Add REG.RU SMTP magic-link credentials using a Docker secret**
- [x] **Step 4: Restart Outline and verify SMTP authentication, the email provider, and delivery of welcome and magic-link emails**
