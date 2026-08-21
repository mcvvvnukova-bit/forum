# Local Outline Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a local-only Outline Community Edition instance at `http://localhost:3000` on this Apple Silicon Mac, with Google OAuth authentication and persistent local data.

**Architecture:** Docker Compose runs Outline, PostgreSQL, and Redis on an internal network from `/Users/vvv/outline-local`, outside the existing dirty Git worktree. Only Outline port 3000 is published to localhost; PostgreSQL and Redis remain private. Database records and uploaded files are stored in named Docker volumes, while Google OAuth credentials and generated application secrets live only in an ignored `.env` file.

**Tech Stack:** Docker Desktop for Apple Silicon, Docker Compose, Outline Community Edition, PostgreSQL 18, Redis 8, Google OAuth 2.0.

## Global Constraints

- Deployment is local-only at `http://localhost:3000`.
- Authentication is Google OAuth.
- Installation uses Docker Compose and the official Outline ARM64 image.
- Existing repository changes must not be modified, staged, committed, or reverted.
- Secrets must not be committed or printed in command output.
- PostgreSQL and Redis ports must not be published to the host.

---

### Task 1: Install and verify Docker Desktop

**Files:**
- No workspace files changed.

**Interfaces:**
- Consumes: Apple Silicon macOS host.
- Produces: working `docker` CLI and Docker Compose v2 runtime.

- [ ] **Step 1: Download the current Docker Desktop installer for Apple Silicon from Docker's official distribution endpoint**

Run:

```bash
curl --fail --location --output /tmp/Docker.dmg https://desktop.docker.com/mac/main/arm64/Docker.dmg
```

- [ ] **Step 2: Verify the downloaded disk image**

Run:

```bash
hdiutil verify /tmp/Docker.dmg
```

Expected: verification completes successfully.

- [ ] **Step 3: Install and launch Docker Desktop**

Mount the verified image, copy `Docker.app` into `/Applications`, unmount the image, and open Docker. Complete the first-run agreement and permissions in the macOS window if requested.

- [ ] **Step 4: Verify Docker and Compose**

Run:

```bash
docker version
docker compose version
docker run --rm hello-world
```

Expected: Docker reports an ARM64 Linux server and `hello-world` exits successfully.

### Task 2: Create the isolated Outline Compose project

**Files:**
- Create: `/Users/vvv/outline-local/docker-compose.yml`
- Create: `/Users/vvv/outline-local/.env.example`
- Create: `/Users/vvv/outline-local/.gitignore`
- Create: `/Users/vvv/outline-local/README.md`
- Runtime-only ignored file: `/Users/vvv/outline-local/.env`

**Interfaces:**
- Consumes: Docker Compose v2 and the Google OAuth callback URL `http://localhost:3000/auth/google.callback`.
- Produces: validated Compose services `outline`, `postgres`, and `redis` plus documented operating commands.

- [ ] **Step 1: Add a Compose configuration with health checks and private dependencies**

Create `/Users/vvv/outline-local/docker-compose.yml` with official version-pinned images, `127.0.0.1:3000:3000` as the only host port, health checks for PostgreSQL and Redis, and named volumes for database and attachments.

- [ ] **Step 2: Add a non-secret environment template**

Create `/Users/vvv/outline-local/.env.example` with documented Google OAuth values. Keep all secrets out of this tracked template; non-secret application settings live in Compose.

- [ ] **Step 3: Ignore the runtime environment file**

Create `/Users/vvv/outline-local/.gitignore` containing:

```gitignore
.env
```

- [ ] **Step 4: Create the runtime environment securely**

Copy `.env.example` to `.env`, generate `SECRET_KEY`, `UTILS_SECRET`, and the PostgreSQL password using `openssl rand`, and store them only in `.env` without printing their values.

- [ ] **Step 5: Validate Compose before startup**

Run:

```bash
docker compose --env-file .env config --quiet
```

Expected: exit code 0 and no missing-variable errors.

### Task 3: Configure Google OAuth

**Files:**
- Modify runtime-only ignored file: `outline-local/.env`

**Interfaces:**
- Consumes: Google OAuth Web application client ID and client secret configured with the exact redirect URI `http://localhost:3000/auth/google.callback`.
- Produces: populated `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` values available only to Docker Compose.

- [ ] **Step 1: Create or select a Google Cloud project**

In Google Cloud Console, configure the OAuth consent screen for the intended Google account. For an external test application, add the Google account under Test users.

- [ ] **Step 2: Create an OAuth client**

Create an OAuth 2.0 Client ID of type `Web application` with:

```text
Authorized JavaScript origin: http://localhost:3000
Authorized redirect URI: http://localhost:3000/auth/google.callback
```

- [ ] **Step 3: Store credentials locally**

Set the issued client ID and secret in `/Users/vvv/outline-local/.env`. Do not add surrounding quotes unless the values contain whitespace, and do not commit or print the file.

### Task 4: Start and verify Outline

**Files:**
- No tracked files changed.

**Interfaces:**
- Consumes: valid Compose configuration and Google OAuth credentials.
- Produces: usable Outline instance at `http://localhost:3000` with persistent data.

- [ ] **Step 1: Pull pinned images**

Run:

```bash
docker compose pull
```

- [ ] **Step 2: Start dependencies and Outline**

Run:

```bash
docker compose up -d
```

- [ ] **Step 3: Verify container health and migrations**

Run:

```bash
docker compose ps
docker compose logs --no-color --tail=150 outline
```

Expected: PostgreSQL and Redis are healthy, Outline stays running, migrations complete, and no authentication configuration errors appear.

- [ ] **Step 4: Verify the HTTP endpoint**

Run:

```bash
curl --fail --silent --show-error --output /dev/null http://localhost:3000
```

Expected: exit code 0.

- [ ] **Step 5: Verify Google sign-in in the browser**

Open `http://localhost:3000`, select Google authentication, sign in with the configured test account, and create the initial Outline workspace.

- [ ] **Step 6: Verify persistence**

Create a test document, restart the stack with `docker compose restart`, and confirm that the document is still present.
