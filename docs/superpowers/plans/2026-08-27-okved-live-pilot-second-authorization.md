# Second Bounded OKVED Live-Pilot Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate one checksum-bound replacement pilot for OKVED `43.11`, year `2025`, and 10 legal entities, execute it once in a visible browser, audit the result, and permanently consume the replacement authorization.

**Architecture:** Preserve policy v1 and its failed run as immutable history. Add policy v2 as a distinct, expiring in-code authorization with its own scope key and durable PostgreSQL guard; review it before source access. After the one terminal command, preserve the active checksum in history, commit a consumed v2 snapshot, and leave runtime disabled on every database.

**Tech Stack:** TypeScript 7, Node.js 24, Vitest 4, PostgreSQL 17, MinIO/S3, Playwright 1.62, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-27-okved-live-pilot-second-authorization-design.md`

## Global Constraints

- The only command is `audience live-pilot --okved 43.11 --year 2025 --max-companies 10`.
- Selection is the first 10 unique legal entities in List-Org default order; active and inactive entities are included, while individual entrepreneurs and duplicate INNs are skipped with audited outcomes.
- Financial mapping stays fixed: `revenue` is BFO form `0710002`, line `2110`; `income` and `expenses` come from the official FNS `7707329152-revexp` dataset for 2025.
- Policy v2 scope key is `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02`.
- Policy v2 owner is `Veronica — АСТ Форум repository operator`.
- Policy v2 is reviewed at `2026-08-27T09:40:50+03:00` and expires at `2026-08-27T21:40:50+03:00`.
- Runtime coordinates are PostgreSQL `127.0.0.1:5433/okved`, MinIO `http://127.0.0.1:9000`, bucket `okved-raw`. Never access PostgreSQL 5432.
- Run `50b2909b-0171-45d6-ae17-7c805ff49be6`, its discovery task, and `docs/runbooks/evidence/okved-live-pilot-2026-08-26.md` remain unchanged.
- Policy v1 remains consumed. Policy v2 has a distinct scope key and guard row; the old run does not consume v2.
- The replacement command is executed at most once. Guard acquisition consumes it even if no run UUID is created or the command crashes.
- The browser is headed and sequential. CAPTCHA may only be solved manually in the same open session; resume only after the controller receives explicit user confirmation.
- No API, export, hidden endpoint, direct browser script, proxy, IP rotation, stealth mode, download workaround, or CAPTCHA solver.
- No selector or policy change during the live command. Contract drift terminates the attempt and requires a new explicit decision.
- After any terminal outcome, policy v2 becomes consumed. No third attempt is authorized.
- Stop owned services without `-v`; preserve PostgreSQL and MinIO volumes.

---

### Task 1: Add the expiring policy-v2 authorization

**Files:**

- Modify: `src/modules/audience/domain/live-pilot-policy.ts`
- Verify unchanged: `src/apps/browser-runner/main.ts`
- Verify unchanged: `src/apps/browser-runner/run-live-pilot.ts`
- Create: `test/unit/audience/live-pilot-policy.test.ts`
- Modify: `test/unit/apps/audience-main-lifecycle.test.ts`
- Modify: `test/integration/audience/live-pilot-attempt-guard.test.ts`
- Modify: `test/e2e/audience-parser.e2e.test.ts`
- Modify: `docs/architecture/audience-ingestion-source-policy.md`
- Create: `docs/runbooks/okved-live-pilot-second-attempt.md`
- Modify: `README.md`

**Interfaces:**

- Make `LivePilotPolicyDocument.authorization` a status-discriminated union: an active authorization requires canonical `reviewedAt` and `expiresAt`; a consumed authorization retains its reviewed data and requires `consumedAt`. This must preserve the serialized v1 document exactly.
- Produce `LIVE_PILOT_POLICY_V1: LivePilotPolicy`, the unchanged consumed v1 snapshot.
- Produce `LIVE_PILOT_POLICY: LivePilotPolicy`, the active v2 snapshot used by public runtime until Task 3 consumes it.
- Change `assertLivePilotPolicyActive(policy, now?: Date): void` so checksum, active status, canonical timestamps, and `now <= expiresAt` are required.
- Error codes remain non-sensitive: `LIVE_PILOT_POLICY_CHECKSUM_MISMATCH`, `LIVE_PILOT_AUTHORIZATION_CONSUMED`, and `LIVE_PILOT_AUTHORIZATION_EXPIRED`.

- [ ] **Step 1: Write policy-v2 unit tests before production changes.**

Create `test/unit/audience/live-pilot-policy.test.ts` with these exact cases:

```ts
import { describe, expect, it } from "vitest";
import {
  assertLivePilotPolicyActive,
  LIVE_PILOT_POLICY,
  LIVE_PILOT_POLICY_V1,
} from "../../../src/modules/audience/domain/live-pilot-policy";

describe("second live-pilot authorization", () => {
  it("preserves v1 as consumed history", () => {
    expect(LIVE_PILOT_POLICY_V1.scopeKey).toBe(
      "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26",
    );
    expect(LIVE_PILOT_POLICY_V1.authorization.status).toBe("consumed");
    expect(LIVE_PILOT_POLICY_V1.checksumSha256).toBe(
      "b148497ffd55d725079055e19b85aa997017ccda51c1557ba23dc5d49c18a24a",
    );
    expect(() => assertLivePilotPolicyActive(LIVE_PILOT_POLICY_V1)).toThrow(
      "LIVE_PILOT_AUTHORIZATION_CONSUMED",
    );
  });

  it("binds the exact active v2 scope and expiry", () => {
    expect(LIVE_PILOT_POLICY).toMatchObject({
      version: 2,
      scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
      authorization: {
        reviewedAt: "2026-08-27T09:40:50+03:00",
        expiresAt: "2026-08-27T21:40:50+03:00",
        status: "active",
      },
      command: { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
    });
    expect(LIVE_PILOT_POLICY.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts v2 through expiry and rejects it after expiry", () => {
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T18:00:00+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T21:40:50+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T21:40:51+03:00"),
    )).toThrow("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  });
});
```

- [ ] **Step 2: Run the unit RED.**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm test -- test/unit/audience/live-pilot-policy.test.ts
```

Expected: FAIL because `LIVE_PILOT_POLICY_V1`, v2, `expiresAt`, and the clock-aware assertion do not exist.

- [ ] **Step 3: Implement the two policy snapshots and expiry assertion.**

In `live-pilot-policy.ts`, keep the v1 document byte-for-byte equivalent to the current consumed record. Add this v2 identity while reusing the exact origins, routes, actions, limits, retention, command, and run scope from v1:

```ts
const reviewedPolicyV2Active = {
  ...sharedPilotContract,
  version: 2,
  scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
  owner: "Veronica — АСТ Форум repository operator",
  authorization: {
    reviewedAt: "2026-08-27T09:40:50+03:00",
    expiresAt: "2026-08-27T21:40:50+03:00",
    status: "active",
  },
} as const satisfies LivePilotPolicyDocument;

export const LIVE_PILOT_POLICY_V1 = bindLivePilotPolicy(reviewedPolicyV1Consumed);
export const LIVE_PILOT_POLICY = bindLivePilotPolicy(reviewedPolicyV2Active);
```

Implement an internal RFC 3339 instant validator that accepts a full date, time,
seconds, an optional fractional-second part, and either `Z` or a numeric UTC
offset. Reject date-only strings, invalid calendar values, and non-finite parsed
values. Apply it to both `reviewedAt` and `expiresAt` for active policies, then use
an injectable clock:

```ts
export function assertLivePilotPolicyActive(
  policy: LivePilotPolicy,
  now: Date = new Date(),
): void {
  assertLivePilotPolicyChecksum(policy);
  if (policy.authorization.status !== "active") {
    throw new Error("LIVE_PILOT_AUTHORIZATION_CONSUMED");
  }
  if (!isCanonicalRfc3339Instant(policy.authorization.reviewedAt)
    || !isCanonicalRfc3339Instant(policy.authorization.expiresAt)) {
    throw new Error("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  }
  const expiry = Date.parse(policy.authorization.expiresAt);
  const currentTime = now.getTime();
  if (!Number.isFinite(currentTime) || currentTime > expiry) {
    throw new Error("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  }
}
```

Add RED/GREEN cases for date-only `reviewedAt`, date-only `expiresAt`, an invalid
calendar instant, and an invalid `now`. Invalid active timestamps or clocks must
fail closed with `LIVE_PILOT_AUTHORIZATION_EXPIRED`. Do not add an environment
override for the policy or clock.

- [ ] **Step 4: Update test-only active policies to carry an expiry.**

In `live-pilot-attempt-guard.test.ts` and the loopback E2E policy helper, set:

```ts
authorization: {
  reviewedAt: "2026-08-27T00:00:00.000Z",
  expiresAt: "2099-12-31T23:59:59.000Z",
  status: "active",
}
```

Keep `test-only/` scope enforcement, fixture mode, disabled live flags, loopback-only endpoints, and checksum binding unchanged.

Replace the guard test that currently expects the production policy to be
consumed. It must now use a checksum-bound, expired `test-only/` policy and prove
that expiry is rejected before guard/repository/client-factory access. Do not call
the active production policy through this integration seam.

- [ ] **Step 5: Write the guard RED for a distinct v2 scope after v1 history.**

Add a database-backed test that inserts the preserved v1 run scope, acquires the exact v2 input concurrently, and proves:

```ts
expect(results.sort()).toEqual([false, true]);
expect(v1AttemptRows).toBe("0");
expect(v2AttemptRows).toBe("1");
expect(storedV2Checksum).toBe(LIVE_PILOT_POLICY.checksumSha256);
```

The test uses a disposable database from `createTemporaryDatabase()` and never the preserved `okved` database.

- [ ] **Step 6: Run the focused policy and guard GREEN.**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/live-pilot-policy.test.ts test/integration/audience/live-pilot-attempt-guard.test.ts test/unit/apps/audience-main-lifecycle.test.ts
```

Expected: all files pass. The public lifecycle test uses Vitest fake system time
set before the v2 expiry for its active-policy cases, then proves policy
validation still precedes DB/S3 construction for consumed, expired, and
checksum-invalid snapshots. Restore real timers after each case.

- [ ] **Step 7: Record the active v2 policy and runbook.**

Update the source policy with a second table containing the exact v2 scope,
review/expiry timestamps, active checksum printed from the built module, same
routes/limits, and status `active — not yet consumed`. Preserve the v1 section.

Create `docs/runbooks/okved-live-pilot-second-attempt.md` with:

- the exact command and environment;
- the expiry check;
- preserved-v1 audit queries;
- migrations 002–003 up-only procedure for the preserved database;
- headed browser and manual CAPTCHA procedure;
- run-scoped SQL/S3 audit queries;
- mandatory post-run consumption steps;
- explicit prohibition on a third attempt.

Link the new active runbook from `README.md`. Do not edit the historical evidence report.

- [ ] **Step 8: Run non-live verification and print the active checksum.**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
node --input-type=module -e 'import("./dist/modules/audience/domain/live-pilot-policy.js").then(({LIVE_PILOT_POLICY}) => console.log(LIVE_PILOT_POLICY.checksumSha256))'
git diff --check
```

Expected: full suite/build pass, checksum is 64 lowercase hex characters, and
documentation contains that exact checksum. The migration test proves migrations
001–003 go up and down on a disposable database; fixture and reconciliation
command tests remain unchanged and green.

- [ ] **Step 9: Commit active policy v2.**

```bash
git add src/modules/audience/domain/live-pilot-policy.ts test/unit/audience/live-pilot-policy.test.ts test/unit/apps/audience-main-lifecycle.test.ts test/integration/audience/live-pilot-attempt-guard.test.ts test/e2e/audience-parser.e2e.test.ts docs/architecture/audience-ingestion-source-policy.md docs/runbooks/okved-live-pilot-second-attempt.md README.md
git diff --cached --check
git commit -m "feat(audience): authorize second bounded live pilot"
```

Expected: clean worktree and a task report containing the active checksum and verification counts.

---

### Task 2: Review and preflight the replacement attempt

**Files:**

- Verify: all Task 1 paths
- Verify: `migrations/002_live_pilot_attempt_guard.js`
- Verify: `migrations/003_raw_upload_intents.js`
- Verify: `docs/runbooks/okved-live-pilot-second-attempt.md`
- Create: `.superpowers/sdd/2026-08-27-okved-live-pilot-second-authorization/preflight-report.md` (ignored evidence)

**Interfaces:**

- Consumes the active `LIVE_PILOT_POLICY` v2 and exact checksum from Task 1.
- Produces a clean task review and a preflight report authorizing only the command in Task 3.

- [ ] **Step 1: Perform an independent task review before any public access.**

Review the Task 1 diff against the spec. The reviewer must verify:

- v1 remains consumed and unchanged;
- v2 identity, owner, timestamps, scope, routes, limits, checksum, and expiry are exact;
- expired/consumed/tampered v2 stops before DB/S3/browser construction;
- test-only policy injection cannot reach public origins or live flags;
- v2 guard is independent from v1 and one-shot under concurrency;
- the runbook cannot be mistaken for authorization after v2 is consumed.

Fix every Critical or Important finding with TDD and scoped re-review before continuing.

- [ ] **Step 2: Start only owned services.**

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps
```

Expected: only `okved-parser` PostgreSQL and MinIO are healthy on loopback 5433/9000/9001.

- [ ] **Step 3: Snapshot and hash the preserved v1 rows before migration.**

Run the runbook query for run `50b2909b-0171-45d6-ae17-7c805ff49be6` and its task. Save canonical JSON and SHA-256 in the ignored preflight report. Expected values remain one run, one `live_discovery` task, zero source fetches, zero companies, zero relations, and zero financial outcomes.

- [ ] **Step 4: Apply migrations up-only to the preserved database.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: migrations 002 and 003 are applied. Do not run `migrate:down` on the preserved database.

- [ ] **Step 5: Prove migration did not change v1 evidence.**

Repeat the exact Step 3 query and hash. Expected: byte-identical canonical JSON and SHA-256. Confirm the v2 scope has zero rows in `audience.live_pilot_attempts`.

- [ ] **Step 6: Run the complete non-live gate on current HEAD.**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
git diff --check
git status --short
```

Expected: tests/build pass and worktree is clean. Tests make no public request.

- [ ] **Step 7: Perform the strict live preflight without collecting records.**

Before the expiry time:

- assert the compiled policy is active and unexpired;
- verify Compose labels and exact ports;
- verify database `okved`, role `okved`, client host `127.0.0.1`, client port `5433`;
- verify the `okved-raw` bucket with `HeadBucket`;
- open headed Chromium only to `about:blank` and close it;
- issue at most one header-only check to each approved entry point;
- verify v2 guard count remains zero and v1 rows remain unchanged.

Abort if any value differs or the local time is later than `2026-08-27T21:40:50+03:00`.

- [ ] **Step 8: Write the ignored preflight report.**

Record timestamp, HEAD, active checksum, expiry, v1 before/after hashes, migration list, service identities, non-live counts, headed-browser result, entry-point status codes, and v2 guard count. Exclude credentials, headers, cookies, session material, page bodies, and sensitive URLs.

Do not commit this operational report and do not run the live command in Task 2.

---

### Task 3: Execute once, audit, and consume policy v2

**Files:**

- Modify after the terminal command: `src/modules/audience/domain/live-pilot-policy.ts`
- Modify after the terminal command: `test/unit/audience/live-pilot-policy.test.ts`
- Modify after the terminal command: `test/unit/apps/audience-main-lifecycle.test.ts`
- Modify after the terminal command: `test/integration/audience/live-pilot-attempt-guard.test.ts`
- Modify after the terminal command: `docs/architecture/audience-ingestion-source-policy.md`
- Modify after the terminal command: `docs/runbooks/okved-live-pilot-second-attempt.md`
- Modify after the terminal command: `README.md`
- Create after the terminal command: `docs/runbooks/evidence/okved-live-pilot-2026-08-27-attempt-02.md`
- Create: `.superpowers/sdd/2026-08-27-okved-live-pilot-second-authorization/task-3-report.md` (ignored evidence)

**Interfaces:**

- Consumes the exact active policy checksum and clean preflight from Tasks 1–2.
- Produces one v2 guard row, at most one new run, a sanitized evidence report, and `LIVE_PILOT_POLICY` as consumed.
- Preserve `LIVE_PILOT_POLICY_V2_ACTIVE` after the command so the guard checksum remains auditable.

- [ ] **Step 1: Recheck time, HEAD, policy, guard, and worktree immediately before execution.**

Expected:

- current time is not later than `2026-08-27T21:40:50+03:00`;
- HEAD is the reviewed Task 1 commit or its reviewed fix commit;
- `LIVE_PILOT_POLICY.authorization.status === "active"`;
- v2 guard count is zero;
- worktree is clean;
- owned services are healthy.

If any condition fails, stop without source access and request a new decision.

- [ ] **Step 2: Execute the fixed command exactly once in an interactive headed session.**

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

Do not rerun this command for any exit code.

- [ ] **Step 3: Handle CAPTCHA only through the same session.**

If the CLI prints the manual-verification prompt:

1. Leave the browser and PTY open.
2. Notify the controller without copying challenge content.
3. Wait for the user to solve it manually and explicitly confirm.
4. Send one line `continue` only after that confirmation.
5. On `abort`, EOF, repeated challenge, failed revalidation, block, or drift, let the command terminate and continue to audit. Never open a replacement browser or run.

- [ ] **Step 4: Capture the terminal time before any audit.**

As the first command after the live process terminates, run:

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ'
```

Copy that exact stdout value into the ignored Task 3 operator report. This is the
only `consumedAt` value used later; do not recompute it.

- [ ] **Step 5: Recover and freeze the new run identity.**

Read the v2 guard row and the newest run created after the Task 2 preflight timestamp. Require one v2 guard row with the exact active checksum and at most one new run. Record the new run ID before any other audit. Never infer or reuse the v1 run ID.

- [ ] **Step 6: Audit PostgreSQL and immutable evidence.**

Use only run-scoped queries from the new runbook. On success require:

```text
companies=10
company_okveds_43_11=10
live_discovery_succeeded=1
live_revexp_capture_succeeded=1
live_finance_succeeded=10
terminal_metric_outcomes_2025=30
non_terminal_tasks=0
unexplained_upload_intents=0
unexplained_source_fetches=0
reconciliation_consistent=true
```

For a terminal failure, record actual counts, task/run terminal reasons,
upload-intent states, and raw-object verification without changing them. Every
created task must either be terminal or have a durable, evidence-backed
explanation of why it remained non-terminal.

- [ ] **Step 7: Write the new sanitized evidence report.**

Create `docs/runbooks/evidence/okved-live-pilot-2026-08-27-attempt-02.md` containing:

- active policy checksum and v2 scope key;
- command exit code and safe terminal message;
- guard consumption timestamp and new run ID, if created;
- ordered 10 INNs on success;
- each `revenue`, `income`, and `expenses` value or `no_data` outcome;
- source-attempt states and safe checksums/object keys;
- reconciliation and SQL/S3 audit counts;
- CAPTCHA status only;
- confirmation that v1 evidence stayed unchanged.

Exclude page bodies, query strings, request/response headers, credentials, cookies, sessions, CAPTCHA content, screenshots, and stack traces.

- [ ] **Step 8: Write the consumed v2 snapshot before any integration handoff.**

Copy the terminal timestamp captured in Step 4 into the committed evidence
report and use the same literal value for `consumedAt`.

Preserve the exact active snapshot:

```ts
export const LIVE_PILOT_POLICY_V2_ACTIVE = bindLivePilotPolicy(reviewedPolicyV2Active);
```

Create `reviewedPolicyV2Consumed` by copying every field from
`reviewedPolicyV2Active`, changing only `authorization.status` to `consumed` and
adding `authorization.consumedAt` with the exact literal captured above. Bind it
as the current `LIVE_PILOT_POLICY`. Export an immutable
`LIVE_PILOT_POLICY_HISTORY` containing `LIVE_PILOT_POLICY_V1` followed by
`LIVE_PILOT_POLICY_V2_ACTIVE`. The source, operator report, and evidence report
must use the same `consumedAt` value byte-for-byte.

- [ ] **Step 9: Write consumed-policy RED/GREEN tests.**

Update policy and main-lifecycle tests to prove:

- current `LIVE_PILOT_POLICY` is consumed and rejects before database/S3/client construction regardless of database contents;
- `LIVE_PILOT_POLICY_V2_ACTIVE` retains the exact active checksum asserted in Task 1;
- `LIVE_PILOT_POLICY_HISTORY` contains v1 consumed and v2 active;
- the consumed snapshot has a valid different checksum;
- no test-only injection can select the historical active production snapshot.

Run focused tests, then full non-live suite and build.
The preserved database is audited with the runbook queries, never used as an
automated test fixture. The run-scoped Step 6 audit—not a unit-test mock—proves
the active checksum equals the persisted v2 guard checksum.

- [ ] **Step 10: Mark documents consumed without changing historical evidence.**

Update the v2 policy table and runbook with terminal status, completion timestamp, active checksum, consumed checksum, result, and prohibition on another run. Change README routing from active workflow to audit-only. Do not edit `docs/runbooks/evidence/okved-live-pilot-2026-08-26.md`.

- [ ] **Step 11: Review the terminal diff and run complete non-live verification while services are healthy.**

Review the Task 3 diff and evidence report for accuracy and leakage. Resolve every
Critical or Important finding without rerunning the live command. Then run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false FNS_LIVE_ENABLED=false npm run build
git diff --check
```

Expected: full suite/build pass and no whitespace errors. Tests make no public
request and cannot consume the historical active policy.

- [ ] **Step 12: Commit the terminal record.**

```bash
git add src/modules/audience/domain/live-pilot-policy.ts test/unit/audience/live-pilot-policy.test.ts test/unit/apps/audience-main-lifecycle.test.ts test/integration/audience/live-pilot-attempt-guard.test.ts docs/architecture/audience-ingestion-source-policy.md docs/runbooks/okved-live-pilot-second-attempt.md docs/runbooks/evidence/okved-live-pilot-2026-08-27-attempt-02.md README.md
git diff --cached --check
git commit -m "fix(audience): consume second live pilot authorization"
```

Expected: committed current production policy is consumed and the staged paths
contain no unrelated changes.

- [ ] **Step 13: Perform the whole-change review.**

Review from the Task 1 base through the terminal commit. Confirm exact
authorization identity, expiry, one-shot guard, preserved v1 evidence, sanitized
v2 evidence, current consumed runtime, and absence of a third-attempt path. Fix
Critical or Important findings without source access or live-command execution;
rerun the focused and full non-live checks and commit the fixes before continuing.

- [ ] **Step 14: Stop owned services and preserve evidence.**

```bash
docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml down
```

Do not pass `-v`. Confirm volumes `okved-parser_postgres_data` and `okved-parser_minio_data` remain.

Run `git status --short`, inspect Compose state, and list only the two named
volumes. Expected: clean worktree, current production policy consumed, owned
services stopped, both volumes present, and no second v2 command execution.

---

## Final handoff

After Task 3 is clean, use `superpowers:verification-before-completion` with the
fresh Task 3 checks and service/volume evidence, then use
`superpowers:finishing-a-development-branch`. Do not push, merge, or deploy
without a separate user choice.
