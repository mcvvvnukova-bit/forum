# Bounded OKVED Live Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and run one bounded, auditable live pilot that obtains the first 10 legal entities for OKVED `43.11` through the visible List-Org UI, publishes them to the owned PostgreSQL database, and records 2025 `revenue`, `income`, and `expenses` from official FNS sources.

**Architecture:** Keep the existing domain, raw-evidence, task-fencing, replay, financial-publication, and reconciliation boundaries. Extract a source-neutral browser policy kernel, add separate live List-Org and BFO adapters, add immutable file evidence for the official FNS `revexp` archive, and coordinate them with one fixed CLI command. Discovery remains evidence-only until exactly 10 legal entities are accepted; organization replay is atomic, while finance is published by one fenced task per company and reconciled across all 10.

**Tech Stack:** TypeScript 7, Node.js 24, Playwright 1.62, PostgreSQL 17, MinIO/S3, AWS SDK v3, `saxes` 6, `fflate` 0.8.2, Vitest 4, Docker Compose.

**Binding spec:** `docs/superpowers/specs/2026-08-26-okved-live-pilot-design.md`

## Global Constraints

- The only live command is `audience live-pilot --okved 43.11 --year 2025 --max-companies 10`; reject every variation and every caller-supplied URL, proxy, IP, cookie, concurrency, download, or browser-script control.
- Live execution requires `APP_MODE=live`, `LIST_ORG_LIVE_ENABLED=true`, and `FNS_LIVE_ENABLED=true`. Existing fixture commands remain fixture-only.
- The live browser is headed, sequential, and limited to the approved source-owned HTTPS origins. Do not use List-Org Excel export, hidden endpoints, the paid BFO API, CAPTCHA solvers, proxies, IP rotation, or request flooding.
- Select the first 10 unique 10-digit legal-entity INNs in List-Org's default order. Include inactive entities, exclude 12-digit IP INNs, skip duplicates, and do not replace selected organizations because finance is missing.
- Persist only the allowlisted evidence projection needed for organization, OKVED, source identity, metric, and audit fields. Never persist cookies, storage, authorization data, request headers, CAPTCHA material, or unrelated company-page content.
- `revenue` is only BFO form `0710002`, line `2110`; `income` and `expenses` are only official FNS `7707329152-revexp`. BFO values displayed in thousands of rubles are multiplied by exactly 1000 using integer arithmetic.
- A positively evidenced missing/restricted value is `no_data`; a transport, contract, policy, or parse failure is failed/blocked and must never become zero or `no_data`.
- CAPTCHA pauses the same visible session and accepts only explicit terminal input `continue` or `abort`. No automatic challenge interaction is allowed.
- A transient network error or `5xx` gets at most two sequential retries with bounded delay. CAPTCHA, `403`, soft block, policy failure, contract drift, invalid INN/year, and malformed evidence are not blindly retried.
- The live command is executed once only after all non-live gates pass. It writes only to the isolated Compose project: PostgreSQL `127.0.0.1:5433` and MinIO `127.0.0.1:9000`/`9001`. Never use or stop host PostgreSQL 5432; never destroy volumes with `down -v`.
- Production changes follow RED-GREEN TDD. Contract tests use local source-shaped servers and never access public sites.
- No deployment, production write, merge, or automatic second live run is part of this plan.

## File Map

- `src/apps/browser-runner/cli.ts` owns the exact public command grammar.
- `src/apps/browser-runner/main.ts` wires fixture commands and delegates the live command.
- `src/apps/browser-runner/run-live-pilot.ts` owns the bounded live orchestration.
- `src/apps/browser-runner/live-pilot-report.ts` builds the sanitized terminal report.
- `src/apps/browser-runner/human-verification.ts` owns the `continue`/`abort` terminal gate.
- `src/modules/audience/infrastructure/sources/browser/policy-browser.ts` owns reusable headed-browser origin, action, retry, and verification policy.
- `src/modules/audience/infrastructure/sources/list-org-live/list-org-live-source.ts` implements the visible List-Org flow.
- `src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source.ts` implements the visible BFO flow and line `2110` extraction.
- `src/modules/audience/infrastructure/sources/fns-revexp/revexp-release.ts` validates official release metadata and archive identity.
- `src/modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser.ts` streams ZIP/XML and selects only the 10 target INNs.
- `src/modules/audience/infrastructure/storage/s3-file-raw-object-storage.ts` persists immutable source files without fake DOM/screenshots.
- `src/modules/audience/application/run-live-pilot.ts` applies publication and reconciliation invariants.
- `docs/runbooks/okved-live-pilot.md` is the preflight, operator, SQL-audit, and shutdown runbook.

---

### Task 1: Extract the reviewed browser policy kernel

**Files:**

- Create: `src/modules/audience/infrastructure/sources/browser/policy-browser.ts`
- Modify: `src/modules/audience/application/ports/browser-session.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-record-policy.ts`
- Create: `test/unit/audience/policy-browser.test.ts`
- Modify: `test/integration/audience/list-org-browser-source.test.ts`

**Interfaces:**

- Add `BrowserOriginPolicy`, `BrowserCaptureProjection`, and `PolicyBrowserSessionFactory` without changing the fixture `OrganizationSource` contract.
- Add `captureProjection(selectors)` for a caller-specified allowlist; it returns sanitized textual/structural evidence and never a full live page snapshot.
- Preserve current exact fixture behavior and browser-manifest verification.

- [ ] **Step 1: Add failing policy tests.** Prove HTTPS/exact-origin enforcement; terminal rejection of cross-origin document/script/XHR/WebSocket/service-worker, popup, and unauthorized download; and non-terminal logging plus abort of passive external image/font/stylesheet/subframe requests.

- [ ] **Step 2: Add a failing projection test.** Serve a company card containing INN/OKVED plus unrelated phones, people, and page chrome. Assert that `captureProjection()` retains only explicitly selected fields and that the raw sanitizer rejects a sensitive value injected into a retained field.

- [ ] **Step 3: Confirm RED.** Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/policy-browser.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Expected: failures are caused by missing reusable policy/projection behavior, not by fixture-server or Playwright startup errors.

- [ ] **Step 4: Extract the policy implementation.** Move shared request, redirect, popup, download, action-recording, canonical-URL, retry, sanitization, and capture logic behind `PolicyBrowserSessionFactory`. Keep the fixture adapter on its existing local HTTP origin through an explicit test-only policy; require HTTPS for all live policies.

- [ ] **Step 5: Keep fixture behavior green.** Run the targeted tests again and then:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
```

- [ ] **Step 6: Commit.**

```bash
git add src/modules/audience/infrastructure/sources/browser src/modules/audience/application/ports/browser-session.ts src/modules/audience/infrastructure/sources/list-org-browser test/unit/audience/policy-browser.test.ts test/integration/audience/list-org-browser-source.test.ts
git diff --cached --check
git commit -m "refactor: extract audited browser policy"
```

---

### Task 2: Add exact live activation and manual CAPTCHA continuation

**Files:**

- Modify: `src/shared/config/env.ts`
- Modify: `src/apps/browser-runner/cli.ts`
- Create: `src/apps/browser-runner/human-verification.ts`
- Modify: `test/unit/shared/config/env.test.ts`
- Modify: `test/unit/apps/audience-cli.test.ts`
- Create: `test/unit/apps/human-verification.test.ts`

**Interfaces:**

- Add `AppEnv.fnsLiveEnabled: boolean`.
- Add `AudienceCliCommand` variant `{ kind: "live-pilot"; okved: "43.11"; year: 2025; maxCompanies: 10 }`.
- Add `HumanVerificationGate.wait({ source, revalidate, signal }): Promise<"continue">` and `OperatorAbortedError`.

- [ ] **Step 1: Write failing environment tests.** Cover default-false `FNS_LIVE_ENABLED`, strict boolean parsing, forbidden live flags under `APP_MODE=fixture`, and the requirement that both live-source flags be true for live execution.

- [ ] **Step 2: Write failing CLI matrix tests.** Accept only the exact three-option live command independent of option order. Reject omitted, duplicated, unknown, malformed, or changed values, plus all source-control flags and positional URLs.

- [ ] **Step 3: Write failing terminal-gate tests.** Using injected input/output streams, prove that only a full trimmed line `continue` resumes, `abort` throws, EOF throws, arbitrary input reprompts, abort signals cancel, and no challenge contents are written.

- [ ] **Step 4: Confirm RED.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/unit/shared/config/env.test.ts test/unit/apps/audience-cli.test.ts test/unit/apps/human-verification.test.ts
```

- [ ] **Step 5: Implement strict parsing and the gate.** Keep feature-gate validation in a pure helper used by `main.ts`; do not open the database or browser before the complete live contract has been validated.

- [ ] **Step 6: Confirm GREEN and build.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/unit/shared/config/env.test.ts test/unit/apps/audience-cli.test.ts test/unit/apps/human-verification.test.ts
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
```

- [ ] **Step 7: Commit.**

```bash
git add src/shared/config/env.ts src/apps/browser-runner/cli.ts src/apps/browser-runner/human-verification.ts test/unit/shared/config/env.test.ts test/unit/apps/audience-cli.test.ts test/unit/apps/human-verification.test.ts
git diff --cached --check
git commit -m "feat: gate bounded live pilot command"
```

---

### Task 3: Store immutable FNS file evidence without fake browser artifacts

**Files:**

- Modify: `src/modules/audience/application/ports/raw-object-storage.ts`
- Modify: `src/modules/audience/application/ports/audience-repository.ts`
- Modify: `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts`
- Create: `src/modules/audience/infrastructure/storage/file-raw-evidence.ts`
- Create: `src/modules/audience/infrastructure/storage/s3-file-raw-object-storage.ts`
- Modify: `src/modules/audience/infrastructure/postgres/audience-repository-support.ts`
- Modify: `test/integration/audience/s3-raw-object-storage.test.ts`
- Create: `test/integration/audience/s3-file-raw-object-storage.test.ts`
- Modify: `test/integration/audience/financial-publication.test.ts`

**Interfaces:**

- Replace browser-only `StoredRawObject.domKey/screenshotKey` assumptions with an exact discriminated artifact union: browser `{ kind: "browser"; domKey; screenshotKey }` or file `{ kind: "file"; dataKey; mimeType; byteLength }`.
- Add a checksummed file manifest containing source identity, final URL, capture time, HTTP status, parser version, MIME type, length, and SHA-256.
- Add `CapturedRawObject.mimeType` and persist it instead of hard-coded `application/json`.

- [ ] **Step 1: Add failing storage tests.** Cover immutable file put/verify, identical retry, collision, checksum mismatch, unsafe keys, wrong source identity, unknown manifest fields, invalid MIME type/length, and cross-kind verification. Keep all current browser-manifest tests unchanged.

- [ ] **Step 2: Add a failing repository test.** Publish one XML/ZIP raw object and assert `source_fetches.mime_type`, checksum, URL, parser version, and stored key are exact; assert an existing browser raw object still publishes with its current MIME type.

- [ ] **Step 3: Start owned services and confirm RED.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml up -d --wait postgres minio
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/s3-file-raw-object-storage.test.ts test/integration/audience/financial-publication.test.ts
```

- [ ] **Step 4: Implement the artifact union and file storage.** Use conditional S3 writes (`IfNoneMatch: "*"`), byte-for-byte equality on idempotent retries, exact manifest keys, checksum validation before publication, and no placeholder PNG/DOM.

- [ ] **Step 5: Confirm GREEN and build.** Run the three integration files above, then `APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build`.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/audience/application/ports src/modules/audience/infrastructure/storage src/modules/audience/infrastructure/postgres/audience-repository-support.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/s3-file-raw-object-storage.test.ts test/integration/audience/financial-publication.test.ts
git diff --cached --check
git commit -m "feat: persist immutable financial source files"
```

---

### Task 4: Implement the source-shaped List-Org live adapter

**Files:**

- Create: `src/modules/audience/infrastructure/sources/list-org-live/list-org-live-source.ts`
- Create: `src/modules/audience/infrastructure/sources/list-org-live/list-org-live-contract.ts`
- Create: `test/support/list-org-live-contract-server.ts`
- Create: `test/fixtures/list-org-live/search.html`
- Create: `test/fixtures/list-org-live/results-page-1.html`
- Create: `test/fixtures/list-org-live/results-page-2.html`
- Create: `test/fixtures/list-org-live/company-active.html`
- Create: `test/fixtures/list-org-live/company-inactive.html`
- Create: `test/fixtures/list-org-live/company-ip.html`
- Create: `test/fixtures/list-org-live/captcha.html`
- Create: `test/integration/audience/list-org-live-source.test.ts`

**Interfaces:**

- Implement the existing `OrganizationSource.collect()` contract through the visible `/search` form (`#okved`, `#is_ip`, `#work`, visible `Поиск`) and sequential `/company/<id>` links.
- Card parsing accepts only `Полное юридическое наименование`, `ИНН / КПП`, primary OKVED, and the additional-OKVED table. Optional phone/email/site are published as `null` and not captured.
- Emit an audited `captcha_waiting` event before calling `HumanVerificationGate`, then revalidate the same origin and expected page identity before continuing.

- [ ] **Step 1: Build sanitized source-shaped fixtures.** Include 10 accepted legal entities in default order, one inactive entity, a duplicate INN, one 12-digit IP, unrelated personal/contact content, pagination, CAPTCHA, soft block, `403`, malformed INN, missing labels, and a foreign redirect.

- [ ] **Step 2: Write failing contract tests.** Prove default-order selection, duplicate/IP skips, inactive retention, exact 10-company stop, `onlyActive: false`, canonical OKVED `43.11`, minimal raw projections, sequential navigation, two-retry ceiling for transient `5xx`, CAPTCHA continuation/abort, and terminal policy/contract failures.

- [ ] **Step 3: Confirm RED.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/integration/audience/list-org-live-source.test.ts
```

- [ ] **Step 4: Implement the adapter.** Use locator-based visible interactions, observable navigation readiness, one page/action at a time, and the shared policy browser. Do not use `page.request`, fetch/XHR injection, Excel download, or hidden endpoints.

- [ ] **Step 5: Confirm GREEN plus fixture compatibility.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/integration/audience/list-org-live-source.test.ts test/integration/audience/list-org-browser-source.test.ts
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
```

- [ ] **Step 6: Commit.**

```bash
git add src/modules/audience/infrastructure/sources/list-org-live test/support/list-org-live-contract-server.ts test/fixtures/list-org-live test/integration/audience/list-org-live-source.test.ts
git diff --cached --check
git commit -m "feat: collect bounded List-Org live evidence"
```

---

### Task 5: Resolve and stream the official 2025 FNS `revexp` release

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/modules/audience/infrastructure/sources/fns-revexp/revexp-release.ts`
- Create: `src/modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser.ts`
- Modify: `src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser.ts`
- Create: `test/fixtures/fns-revexp/metadata-2025.html`
- Create: `test/fixtures/fns-revexp/revexp-2025.zip`
- Create: `test/support/fns-revexp-contract-server.ts`
- Modify: `test/unit/audience/revexp-parser.test.ts`
- Create: `test/unit/audience/revexp-release.test.ts`
- Create: `test/integration/audience/revexp-live-source.test.ts`

**Interfaces:**

- Add `resolveRevexpRelease(metadataUrl, transport)` returning a validated official final archive URL, 2025 release identity, structure/XSD version, timestamps, content metadata, and capture metadata.
- Add `selectRevexpMetrics(archiveStream, targetInns, context)` returning at most one `income` and one `expenses` outcome for every target INN.
- Keep `parseRevexp()` as the single record-to-domain mapping boundary; adapt it to accept selected records without materializing the full archive.

- [ ] **Step 1: Add exact ZIP dependency.** Run `npm install --save-exact fflate@0.8.2` and verify that only `package.json` and `package-lock.json` change.

- [ ] **Step 2: Write failing release tests.** Accept the official dataset identity `7707329152-revexp`, an HTTPS redirect chain limited to `nalog.gov.ru`/`www.nalog.gov.ru`/`file.nalog.ru`, and metadata explicitly describing report year 2025. Reject wrong dataset/year, HTTP downgrade, unapproved host, missing structure version, ambiguous archive, missing length/type, and a final URL outside the allowlist.

- [ ] **Step 3: Write failing stream-selection tests.** Cover 10 targets in a larger ZIP, unrelated INNs, missing records, duplicate/correction ordering, malformed XML, ZIP traversal names, multiple data members, compressed bytes over 256 MiB, expanded bytes over 1 GiB, and exact integer values for both metrics. Assert the implementation never retains an array proportional to total archive records.

- [ ] **Step 4: Write a failing local integration test.** Resolve metadata, download the archive exactly once, persist the full archive through `S3FileRawObjectStorage`, stream-select only requested INNs, and attach the same immutable checksum to their source attempts. The test server must prove sequential bounded retries and reject a second archive download.

- [ ] **Step 5: Confirm RED.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/unit/audience/revexp-parser.test.ts test/unit/audience/revexp-release.test.ts test/integration/audience/revexp-live-source.test.ts
```

- [ ] **Step 6: Implement strict metadata/download validation and streaming parsing.** Apply size limits while bytes arrive and while ZIP members expand. Feed SAX events into target-aware record mapping; stop retaining completed non-target records. Preserve official source timestamps and parser/structure versions in evidence.

- [ ] **Step 7: Confirm GREEN and build.** Run the three targeted files above and `APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build`.

- [ ] **Step 8: Commit.**

```bash
git add package.json package-lock.json src/modules/audience/infrastructure/sources/fns-revexp test/fixtures/fns-revexp test/support/fns-revexp-contract-server.ts test/unit/audience/revexp-parser.test.ts test/unit/audience/revexp-release.test.ts test/integration/audience/revexp-live-source.test.ts
git diff --cached --check
git commit -m "feat: ingest official revexp release"
```

---

### Task 6: Implement visible BFO 2025 revenue collection

**Files:**

- Create: `src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source.ts`
- Create: `src/modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-contract.ts`
- Modify: `src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser.ts`
- Create: `test/support/fns-bfo-live-contract-server.ts`
- Create: `test/fixtures/fns-bfo-live/search.html`
- Create: `test/fixtures/fns-bfo-live/report-2025.html`
- Create: `test/fixtures/fns-bfo-live/report-restricted.html`
- Create: `test/fixtures/fns-bfo-live/report-no-line-2110.html`
- Create: `test/fixtures/fns-bfo-live/captcha.html`
- Modify: `test/unit/audience/bfo-parser.test.ts`
- Create: `test/integration/audience/bfo-live-source.test.ts`

**Interfaces:**

- Add `BfoLiveSource.collectRevenue({ inn, reportYear: 2025 }, context)` returning one `published` or positively evidenced `no_data` outcome plus minimal browser raw evidence and source-attempt metadata.
- The parser requires matching legal-entity INN, visible `Отчетность за 2025 год`, form `0710002`, row code `2110`, and `Ед. измерения: тыс. ₽`.
- Convert the localized integer cell to rubles with `BigInt(displayedThousands) * 1000n`; reject decimals, unsafe separators, overflow outside the database numeric contract, and conflicting rows.

- [ ] **Step 1: Create sanitized source-shaped fixtures.** Reproduce the visible search box, result card, 2025 report selector, report heading, form section, units, and `2110` row. Add restricted, absent, wrong-INN, wrong-year, wrong-unit, duplicate-line, malformed-number, CAPTCHA, soft-block, and foreign-navigation variants.

- [ ] **Step 2: Write failing parser and contract tests.** Assert exact `1 654 023` thousand-ruble input becomes `1_654_023_000` rubles, only line `2110` becomes revenue, positively evidenced unavailable/missing line becomes `no_data`, and all wrong identity/contract/transport cases remain failed or blocked.

- [ ] **Step 3: Prove browser constraints in the test server.** Assert headed configuration, visible locator actions, one INN at a time, no direct application/API request, no report download, minimal capture projection, retry ceiling, and manual CAPTCHA resume on the same session.

- [ ] **Step 4: Confirm RED.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/unit/audience/bfo-parser.test.ts test/integration/audience/bfo-live-source.test.ts
```

- [ ] **Step 5: Implement the adapter and mapping.** Use the shared policy browser with only `https://bo.nalog.gov.ru`; wait on visible report identity instead of network-idle; create evidence only after all identity, form, year, unit, and line checks pass.

- [ ] **Step 6: Confirm GREEN and build.** Run the two targeted files above and `APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build`.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/audience/infrastructure/sources/fns-bfo src/modules/audience/infrastructure/sources/fns-bfo-live test/support/fns-bfo-live-contract-server.ts test/fixtures/fns-bfo-live test/unit/audience/bfo-parser.test.ts test/integration/audience/bfo-live-source.test.ts
git diff --cached --check
git commit -m "feat: collect BFO revenue through visible UI"
```

---

### Task 7: Orchestrate exactly 10 companies and reconcile 30 finance outcomes

**Files:**

- Modify: `src/modules/audience/application/run-fixture-discovery.ts`
- Create: `src/modules/audience/application/run-live-pilot.ts`
- Modify: `src/modules/audience/application/publish-financial-evidence.ts`
- Modify: `src/modules/audience/application/reconcile-run.ts`
- Modify: `src/modules/audience/application/ports/audience-repository.ts`
- Modify: `src/modules/audience/infrastructure/postgres/audience-repository.ts`
- Modify: `src/modules/audience/infrastructure/postgres/audience-repository-support.ts`
- Create: `src/apps/browser-runner/run-live-pilot.ts`
- Create: `src/apps/browser-runner/live-pilot-report.ts`
- Modify: `src/apps/browser-runner/main.ts`
- Modify: `test/integration/audience/fixture-run.test.ts`
- Modify: `test/integration/audience/financial-publication.test.ts`
- Create: `test/integration/audience/live-pilot.test.ts`
- Modify: `test/e2e/audience-parser.e2e.test.ts`

**Interfaces:**

- Generalize discovery start with an explicit task kind (`fixture_discovery` or `live_discovery`) and `onlyActive`; preserve the legacy `fixture_version` database column as immutable source-version storage, avoiding a migration.
- Extend financial publication with task kind `live_finance` and required `companyInn`; persist `companyInn` in the task result and reject evidence/outcomes for another company.
- Reconciliation must aggregate all 10 `live_finance` tasks rather than select one latest fixture task. It requires exactly 10 scoped companies, 10 `43.11` relations, and 30 terminal company/metric outcomes.

- [ ] **Step 1: Write failing discovery-generalization tests.** Prove fixture discovery still uses `fixture_discovery`/`onlyActive: true`, while live uses `live_discovery`/`onlyActive: false`; retries cannot change source version, task kind, scope, or parser version.

- [ ] **Step 2: Write failing per-company publication tests.** Prove one `live_finance` task owns exactly one INN and its three metric outcomes, the shared revexp raw object is referenced without duplicate `source_fetches`, per-company commits are isolated, and stale/foreign evidence is rejected.

- [ ] **Step 3: Write failing reconciliation tests.** Cover 10×3 complete outcomes, mixed values and legitimate `no_data`, missing outcome, duplicate outcome, failed/blocked task, wrong year, wrong OKVED, 9/11 organizations, unexplained raw object, and missing provenance.

- [ ] **Step 4: Write the failing local end-to-end pilot.** Run the exact CLI against injected local List-Org, BFO, and revexp contract origins. Assert evidence-only discovery precedes replay; fewer than 10 leaves zero organizations/relations; successful discovery atomically creates all 10; finance runs sequentially per INN; and the sanitized report contains run ID, ordered INNs, 30 outcomes, source-attempt states, and reconciliation counts but no session material.

- [ ] **Step 5: Confirm RED with owned services.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/fixture-run.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/live-pilot.test.ts test/e2e/audience-parser.e2e.test.ts
```

- [ ] **Step 6: Implement the bounded state machine.** Validate gates before resources open; create one UUID run; collect and persist discovery evidence; require exactly 10 accepted unique legal INNs; call existing replay directly for atomic organization publication; resolve/store revexp once; collect BFO and publish all three outcomes per company; reconcile once; and close browser, storage, streams, and database in `finally` blocks.

- [ ] **Step 7: Preserve public error safety.** Map operator abort, source block, contract drift, and reconciliation failure to stable non-sensitive error codes/messages. Never print URLs containing query data, raw DOM, screenshots, cookies, headers, or stack traces from source adapters.

- [ ] **Step 8: Confirm targeted GREEN.** Re-run the four files in Step 5 and `APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build`.

- [ ] **Step 9: Run the complete non-live gate.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
```

Expected: the existing full fixture suite, dedicated e2e suite, and TypeScript build all pass with zero public-network requests.

- [ ] **Step 10: Commit.**

```bash
git add src/modules/audience/application src/modules/audience/infrastructure/postgres src/apps/browser-runner test/integration/audience/fixture-run.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/live-pilot.test.ts test/e2e/audience-parser.e2e.test.ts
git diff --cached --check
git commit -m "feat: orchestrate bounded OKVED live pilot"
```

---

### Task 8: Publish the runbook, verify the branch, and execute one live pilot

**Files:**

- Create: `docs/runbooks/okved-live-pilot.md`
- Modify: `README.md`
- Create after the run: `docs/runbooks/evidence/okved-live-pilot-2026-08-26.md`

- [ ] **Step 1: Write the runbook before live access.** Document the fixed command, feature gates, approved origins, headed-browser requirement, `continue`/`abort` CAPTCHA procedure, retry limits, owned service endpoints, preflight checks, expected terminal states, SQL audit queries, evidence audit, sanitized report fields, and shutdown without volume deletion.

- [ ] **Step 2: Add README routing.** Keep fixture commands labeled fixture-only and link the exceptional bounded live workflow to the runbook. State that arbitrary live collection remains unsupported.

- [ ] **Step 3: Verify migrations on the owned database.** Snapshot relevant row counts, then run the migration down/up cycle only against port 5433:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: exit code 0 both times and no interaction with port 5432.

- [ ] **Step 4: Run final non-live verification.** Execute the full command from Task 7 Step 9, `git diff --check`, and inspect `git status --short`. Confirm no live-site request was made during tests.

- [ ] **Step 5: Perform the live preflight.** Verify the Compose project labels and ports belong to `okved-parser`; confirm the destination database is the isolated local database; confirm MinIO bucket access; confirm the visible browser can be displayed; and record current official URLs in the operator log. Abort before collection if any identity check fails.

- [ ] **Step 6: Execute the fixed command once.** Use only:

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

If CAPTCHA appears, leave the browser open, let the operator complete it manually, type `continue`, and resume the same session. On `abort`, EOF, failed revalidation, `403`, soft block, drift, or policy failure, stop and do not create a replacement run.

- [ ] **Step 7: Audit SQL and immutable evidence.** Run the runbook queries and prove exactly 10 unique run companies, 10 run-scoped `43.11` relations, 30 terminal 2025 metric outcomes, value/no-data provenance, one verified revexp archive capture, verified BFO/List-Org browser objects, zero unexplained raw objects, zero non-terminal tasks, and successful reconciliation.

- [ ] **Step 8: Record a sanitized evidence report.** Write run ID, ordered 10 INNs, each metric value or `no_data`, source-attempt status, checksums/keys safe to disclose, reconciliation counts, command exit status, and audit query counts to `docs/runbooks/evidence/okved-live-pilot-2026-08-26.md`. Exclude page contents, sensitive URLs, session state, headers, cookies, CAPTCHA data, and secrets.

- [ ] **Step 9: Stop owned services without deleting data.**

```bash
docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml down
```

Do not pass `-v`; the pilot database and immutable object evidence must remain recoverable.

- [ ] **Step 10: Review and commit documentation/evidence.** Run `git diff --check`, inspect every changed path, and commit only the runbook, README, and sanitized evidence report:

```bash
git add README.md docs/runbooks/okved-live-pilot.md docs/runbooks/evidence/okved-live-pilot-2026-08-26.md
git diff --cached --check
git commit -m "docs: record bounded OKVED live pilot"
```

- [ ] **Step 11: Final branch review.** Use `superpowers:requesting-code-review`, resolve any critical findings through normal TDD, then use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Do not merge, deploy, push, or run the live pilot again without a new explicit user instruction.
