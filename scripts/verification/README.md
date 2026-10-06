# Candidate checks

`repository-layout.json` records the current seven package owners, exact declared
commands, entrypoints and test files. `node check-repository-layout.mjs` runs
from any directory and validates the tracked candidate tree. Required packages
cannot be skipped. Generated dependencies/builds, private JSON and backups must
be ignored and untracked. `--root PATH` selects a Git fixture for regression
tests; it does not relax any checks.

The checker reports the current `docs/` inventory. `--strict-docs`, or a later
explicit change to `documentation.strictPlansOnly`, enforces `docs/plans/`
only. Enable that policy after the separate Outline migration has saved and
reopened content and attachments. It is intentionally disabled for this
candidate; there is no environment-variable bypass.

The workflow uses Node 24.18.1 and Python 3 stdlib on Ubuntu 24.04. Every owner
is installed from the canonical root lock with root `npm ci`. API and legacy landing install their
own Playwright Chromium. The frontend jobs run declared lint where present,
typecheck, tests and builds; the landing test already includes its build/layout
and gateway/rollback tests. Root composition uses the shared root React and Primer dependency context.
Publisher integration runs the actual three entrypoints plus home/audience
unit regressions; auth's Python suite is already part of its frontend script.
Fresh builds additionally exercise auth → home → audience → auth across eight
pages, preserving assets and source build bytes. None of these checks invokes
the default remote home verifier.

`bash scripts/verification/check-api.sh` requires fresh API/landing installs,
API-owned Chromium, Docker and the pinned official PostgreSQL 18.6 image. It
creates two dedicated `_test` databases in a disposable container, exposes
only a random localhost port, waits for TCP readiness of the final postmaster,
checks the server version and removes the container on failure or completion.
The ACL suite separately uses its network-none Linux amd64 container. Both use
the official multi-platform index digest
`postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2`.
Only synthetic credentials/provider data are used; no application dump or
external provider configuration is required.

`node --test scripts/verification/checks.test.mjs` exercises missing actual
packages, root lock/tests, command drift, tracked generated/private files and the
final gate. The stable `quality` job requires layout, API/browser, aggregate
frontend matrix, composition, publishers, ACL, profile and operational jobs to equal `success`.
Missing, skipped and canceled results fail. Superseded workflow/ref candidates
may be canceled; this cannot give them a successful final gate.

Actions are immutable official v7 commits with version comments in the YAML.
Failure artifacts contain only a status receipt with a pointer to the failed
Actions command. Raw application logs, environment values, screenshots,
generated sites and worktree files are never uploaded as artifacts. Native
command logs retain diagnostics for inspection. The first actual GitHub run
must validate this candidate head before merge; local checks do not substitute
for the remote workflow result.

Task4 adds the independent profile fixture owner and its reviewed lock, tests,
lint, typecheck and build. Operational checks require all selected source files
in the layout and validate the accepted matrix's actual file hashes/modes,
Python/shell/Ruby syntax, four Compose owners, both active override contracts,
eight independent HTML templates and the production Caddyfile. Compose parses
copies with synthetic environment values; administrative programs are never
executed. Caddy runs only `adapt` in a disposable network-none container from
an immutable official image. No SMTP, provider, database data or server restart
is part of these checks. Every checkout selects the exact pull-request head SHA
(or push SHA), rather than GitHub's virtual merge; parent verifies job logs.

Ruby patch syntax uses the pinned OpenProject 17.8.0 runtime in a disposable
network-none/read-only container with the `ruby` entrypoint; host Ruby may be
older and cannot parse the deployed Ruby language. This runs syntax checks only.

Task5 consolidates all six npm app workspaces into one root lock, relocates publishers to `scripts/deployment/<owner>` and retains source-only Python/static owners. All eight HTML templates pass offline local resource closure and local Chromium rendering through `npm run test:mail`; no email is sent. Dated deployment observations retain original paths and semantics.
