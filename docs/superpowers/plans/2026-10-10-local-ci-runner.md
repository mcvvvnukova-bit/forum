# PROJ-168 Local CI Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run Docker-dependent GitHub Actions checks on the current Mac with persistent Docker images.

**Architecture:** Two Ubuntu 24.04 ARM64 runner containers share an isolated Docker-in-Docker daemon, its network namespace and an identical workspace volume mount. GitHub retains scheduling, logs, checks and immutable artifacts. Enable routing with a repository variable after runner registration.

**Tech Stack:** Docker Desktop, Docker Compose, official actions/runner, Python 3, GitHub API via host gh, macOS LaunchAgent.

## Global Constraints

- Repository: mcvvvnukova-bit/forum. Task: OP#PROJ-168 (OpenProject internal ID 206), parent OP#PROJ-164 (ID 202). Branch codex/PROJ-168-local-ci-runner, baseline 1afee9fd9e1055b52ddcf607d26f57ffb115326a.
- No host Docker socket, personal directories, administrative GitHub token or deployment credentials accessible to jobs. Only nested daemon is privileged. No exposed TCP Docker API or published service ports.
- Two runner services, astforum-mac-ci-01 and astforum-mac-ci-02, labels self-hosted/Linux/ARM64/astforum-local-ci. Shared /ci workspace; separate persistent runner homes; persistent nested Docker volume and socket volume.
- Initial aggregate allocation: 4 CPUs and approximately 3 GB memory (daemon 512 MB, each runner 1280 MB); keep other Docker Desktop services running. Adjust only CI resource limits if measured job needs prove insufficient.
- Base ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807. Official image is Ubuntu 24.04 and contains Docker static binaries. Install Python, iptables, process/network tools and Chromium system dependencies. Runner application updates remain enabled.
- Four existing Docker jobs alone use dynamic runs-on. Repository variable ASTFORUM_CI_DOCKER_RUNNERS contains JSON labels. Unset variable and external fork PR route to ["ubuntu-24.04"]. Main/push/workflow_dispatch and same-repo PR can use the local labels. Do not weaken selection, quality gate, source ownership, tests or artifact provenance.
- Exact image digests from existing source remain authoritative. Existing historical receipts and predecessor pins remain immutable; add a PROJ-168 ownership layer for touched existing files and independently hashed new files.
- Private state directory: ~/Library/Application Support/AST Forum CI. No private state or tokens in tracked files. Registration token passed through stdin, never logged or stored in container environment. Repeated start/install must not duplicate GitHub registrations.

## Task 1: Implement local runner deployment and CI routing

**Files:** Create deployment/ci-local/{Dockerfile,compose.yaml,entrypoint.sh,README.md}, scripts/deployment/ci-local/manage.py, scripts/verification/test_local_ci.py, artifacts/repository-audits/proj-168-local-ci-ownership.json. Modify .github/workflows/quality.yml and the verification/ownership files needed to register these exact paths. Add no unrelated UI/API/product changes.

**Interfaces:** manage.py commands install/start/stop/status/warm/autostart, optional --state-dir; install builds and starts the fixed Compose project astforum-ci-local, registers missing runners through host gh and stdin, copies runtime support into the private state directory. warm imports the four pinned local images and caddy:2.10-alpine and verifies requested image references/platforms in the nested daemon. status reports sanitized Docker/GitHub health only. autostart installs a user LaunchAgent that starts Docker Desktop and the copied service after login, without registration credentials. stop never deletes volumes or registrations. Compose runner environment has DOCKER_HOST pointing to the nested Unix socket, ImageOS=ubuntu24 and persistent writable tool/browser/npm caches.

- [ ] Inspect current verification ownership chain and evaluate GitNexus impact before editing. Use the matching ast-forum baseline index, or register/reindex this worktree with a distinct name for changed-code verification. No local .gitnexus/run.cjs exists; use installed CLI.
- [ ] Add meaningful tests for trusted/fork/default routing, non-destructive stop/restart, absence of host socket/personal mounts and secrets, persisted volumes, token stdin handling and ownership tampering. Demonstrate a new behavioral assertion failing before implementation.
- [ ] Implement the deployment and management interfaces. Preserve localhost and bind mount behavior across daemon and runners. Keep registration idempotent and avoid tokens in process logs and tracked files.
- [ ] Replace only database's unconditional pull with platform-aware presence check followed by pull on miss. Keep all job steps and artifacts, apart from required runner scheduling.
- [ ] Add the exact PROJ-168 ownership layer and its tests; preserve predecessor hashes and validate the current bytes of every changed/new governed path. Extend layout registration only where required.
- [ ] Run python3 -m unittest discover -s scripts/verification -p test_local_ci.py -v; node --test scripts/verification/checks.test.mjs scripts/verification/ci-optimization.test.mjs; node scripts/verification/check-repository-layout.mjs; Docker Compose config; Python/shell syntax checks. Avoid rerunning broad unrelated suites until new failures warrant it.
- [ ] Self-review, GitNexus detect_changes, commit PROJ-168 changes, write full report and hand over to controller. Do not push, merge, register a runner, enable repo variables, configure LaunchAgent or spawn agents; controller owns runtime activation.

## Task 2: Activate and prove the installed service

**Files:** Private installed runtime and LaunchAgent, outside repository; add a sanitized proof document only after observations.

- [ ] Review Task 1's diff and evidence before activation; fix material findings through the original implementer.
- [ ] Run manage.py install, verify both registrations online and no host socket/personal mounts. Import existing pinned images and confirm digest/platform identity using an offline Docker run where possible.
- [ ] Restart service; confirm registration IDs and Docker image IDs persist. Verify nested PostgreSQL readiness and localhost/bind mounting.
- [ ] Install and load autostart LaunchAgent. Do not alter system sleep settings; record that the Mac must be on and awake.
- [ ] Enable ASTFORUM_CI_DOCKER_RUNNERS, push branch and create PR with both OP codes and links. Attach PR to chat. Run the exact candidate CI and inspect runner names, all four jobs, gate result and artifact provenance.
- [ ] Verify PR visibility in OpenProject GitHub tabs under Kuzmina. Record sanitized evidence, finish review and report active service, observed caching, timing limits and pending merge status.


## Уточнения исполнения, утверждённые в Task 1

Pre-job hook включён через ACTIONS_RUNNER_HOOK_JOB_STARTED и baked вне writable runner home. До шагов задания он fail-closed проверяет fixed mcvvvnukova-bit/forum и payload: push/workflow_dispatch из своего repository, pull_request только со своими head и base repository. Fork, другие события, отсутствующий или malformed payload отклоняются независимо от routing YAML. Manager копирует hook и validator в private runtime; GitHub administrative credentials остаются на Mac.

Два runner используют общий network namespace daemon. Для одновременных web-release jobs FORUM_WEB_E2E_PORT равен 5297 у первого и 5298 у второго; public-site config и сервер валидируют один целочисленный порт 1024..65535. Hosted default остаётся 5297. Docker Compose v5.6.0 linux-aarch64 устанавливается из official release с SHA256 733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2. Limits заданы явно только CI сервисам.

Новая Python suite scripts/verification/test_local_ci.py выполняется в существующем layout шаге Verification and CI regressions после прежних Node suites; все прежние проверки и artifacts сохраняются.


## Исправление I1: неизменяемая граница hook

Job пользователь runner лишён группы sudo; пакет sudo и его policies удалены из custom image. Hook/validator и системные interpreter/import directories принадлежат root и недоступны runner для записи/замены. Root entrypoint выполняет только подготовку volumes и runuser, сами jobs работают runner. Validator вызывается абсолютным /usr/bin/python3 -I: Python игнорирует пользовательский site/usercustomize и PYTHON environment/import paths.

Все Playwright1.62.1 Ubuntu24.04 ARM64 tools/Chromium dependencies установлены при build. Только API и web-release определяют официальный runner.environment: self-hosted устанавливает Chromium без --with-deps; github-hosted сохраняет --with-deps. Hosted mail/frontend и все browser tests сохраняются. Приёмка fix: настоящий built image запрещает runner sudo и запись/замену gate/import/interpreter directories, usercustomize marker не выполняется, fork остаётся отклонён; headless Chromium действительно запускается как runner без root.
