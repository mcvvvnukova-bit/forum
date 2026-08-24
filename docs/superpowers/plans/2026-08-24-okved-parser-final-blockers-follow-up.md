# OKVED Parser Final Blockers Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three residual Important review findings by making replay enqueue atomic, duplicate classification order-independent, and browser raw capture fail-closed for unknown form secrets.

**Architecture:** Keep the existing eleven-table audience schema. Use pg-boss's transaction-bound database option so `crawl_task` and its job share one PostgreSQL commit; move duplicate equivalence into browser record policy; and make DOM/screenshot form handling deny values by default at both sanitizer and checksum boundaries.

**Tech Stack:** Node.js 24, TypeScript, PostgreSQL 17, `pg`, pg-boss, Playwright/Chromium, Vitest, MinIO/S3.

## Global Constraints

- Work only in `/Users/vvv/Проекты/АСТ Форум/.worktrees/okved-parser` on `codex/okved-parser`.
- Stage 1 remains legal entities with ten-digit INN; IP support remains stage 2.
- `APP_MODE=fixture` and `LIST_ORG_LIVE_ENABLED=false` for every verification run.
- Do not enable or exercise live List-Org or live FNS traffic.
- Do not use List-Org bulk endpoints, hidden APIs, direct HTTP crawling, proxy rotation, identity spoofing, or CAPTCHA solving.
- Preserve `revenue ← Ф2.2110`, `income ← FNS income`, and `expenses ← FNS expenses`.
- Preserve immutable raw provenance, decimal money strings, lease/fencing semantics, and replay idempotency.
- Do not modify the main checkout's `CONTEXT.md`, `.playwright-cli` log, or untracked `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`.
- Use PostgreSQL on loopback `5433` for this worktree; do not stop or reconfigure the unrelated PostgreSQL on host port `5432`.
- No production change may be written before its focused regression has failed for the expected reason.

---

### Task 1: Atomic replay task and pg-boss enqueue

**Files:**
- Create: `src/apps/browser-runner/enqueue-replay-write.ts`
- Modify: `src/apps/browser-runner/main.ts:67-93`
- Modify: `src/shared/jobs/pg-boss-job-queue.ts:1-89`
- Modify: `src/modules/audience/application/ports/audience-repository.ts:124-135`
- Modify: `src/modules/audience/infrastructure/postgres/audience-repository.ts:156-233`
- Test: `test/integration/audience/job-delivery.test.ts`

**Interfaces:**
- Consumes: `Database.transaction<T>()`, `PostgresAudienceRepository.prepareTask()`, pg-boss `SendOptions.db`, and the existing payload `{ runId: string; taskId: string }`.
- Produces: `enqueueReplayWrite(runId, database, queue, taskId?) → { runId, taskId, jobId, queued: true }`; `PgBossJobQueue.ensureQueue(name)`; and `PgBossJobQueue.publishInTransaction(name, payload, { id, singletonKey }, database)`.
- Preserves: ordinary `JobQueue.publish()` and `JobQueue.work()` consumers.

- [ ] **Step 1: Add a RED rollback regression at the crash boundary**

Add to `test/integration/audience/job-delivery.test.ts` a test using the real temporary PostgreSQL database and a deliberately failing transaction-bound publisher:

```ts
it("rolls back the replay task when enqueue fails before the shared commit", async () => {
  const { runId } = await stageSingleCandidateRun(database, repository, env, client);
  const taskId = randomUUID();
  const failingQueue = {
    ensureQueue: async () => undefined,
    publishInTransaction: async () => { throw new Error("synthetic enqueue crash"); },
  };

  await expect(enqueueReplayWrite(runId, database, failingQueue, taskId))
    .rejects.toThrow("synthetic enqueue crash");

  const task = await database.query(
    "SELECT id FROM audience.crawl_tasks WHERE id = $1",
    [taskId],
  );
  const job = await database.query(
    "SELECT id FROM pgboss.job WHERE id = $1",
    [taskId],
  );
  expect(task.rowCount).toBe(0);
  expect(job.rowCount).toBe(0);
});
```

Before writing the test, import the wished-for `enqueueReplayWrite` API from `src/apps/browser-runner/enqueue-replay-write.ts`. The fake is limited to the crash injection boundary; assertions are against real PostgreSQL state.

- [ ] **Step 2: Run the rollback regression and verify RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false \
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved \
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw \
S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret \
npx vitest run test/integration/audience/job-delivery.test.ts --no-file-parallelism
```

Expected: FAIL because the wished-for `enqueue-replay-write.ts`/`enqueueReplayWrite` API does not exist. This is the required missing-behavior RED; after the API exists, any later failure must come from the asserted rollback behavior rather than a syntax or fixture error.

- [ ] **Step 3: Add the transaction-bound pg-boss adapter**

In `src/shared/jobs/pg-boss-job-queue.ts` expose queue preparation and add an atomic publisher:

```ts
import type { Db as PgBossDatabase } from "pg-boss";
import type { Database } from "../postgres/database";

async ensureQueue(name: string): Promise<void> {
  validateName(name);
  await this.#ensureQueue(name);
}

async publishInTransaction<T>(
  name: string,
  payload: T,
  options: { id: string; singletonKey: string },
  database: Database,
): Promise<string> {
  validatePublish(name, payload, options.singletonKey);
  await this.ensureQueue(name);
  this.#assertAvailable();
  const db: PgBossDatabase = {
    executeSql: async (text, values) => {
      const result = await database.query(text, values);
      return { rows: result.rows };
    },
  };
  const id = await this.#boss.send(name, payload as object, {
    id: options.id,
    singletonKey: options.singletonKey,
    db,
  });
  if (id === null) throw new Error("job identity is already queued");
  return id;
}
```

Extract the existing name/payload/singleton validation into `validatePublish()` and reuse it from both publish methods. `ensureQueue()` must finish before the caller enters the shared transaction; awaiting an already-resolved queue promise inside `publishInTransaction()` is permitted but must not perform DDL through the transaction adapter.

- [ ] **Step 4: Implement the atomic composition function**

Create `src/apps/browser-runner/enqueue-replay-write.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/postgres/database";
import { PostgresAudienceRepository } from "../../modules/audience/infrastructure/postgres/audience-repository";

const REPLAY_QUEUE = "audience-replay-write";

export interface AtomicReplayQueue {
  ensureQueue(name: string): Promise<void>;
  publishInTransaction<T>(
    name: string,
    payload: T,
    options: { id: string; singletonKey: string },
    database: Database,
  ): Promise<string>;
}

export async function enqueueReplayWrite(
  runId: string,
  database: Database,
  queue: AtomicReplayQueue,
  taskId = randomUUID(),
): Promise<{ runId: string; taskId: string; jobId: string; queued: true }> {
  await queue.ensureQueue(REPLAY_QUEUE);
  return database.transaction(async (transaction) => {
    await new PostgresAudienceRepository(transaction)
      .prepareTask(taskId, runId, "replay_write");
    const jobId = await queue.publishInTransaction(
      REPLAY_QUEUE,
      { runId, taskId },
      { id: taskId, singletonKey: `audience:${runId}:replay_write` },
      transaction,
    );
    return { runId, taskId, jobId, queued: true };
  });
}
```

Update the `replay-write` case in `main.ts` to keep the existing run-state checks, construct `PgBossJobQueue`, call `enqueueReplayWrite()`, and close the queue in `finally`. Remove the prepare/publish compensation block.

Remove unused `failPreparedTask()` from the repository port and PostgreSQL repository after `rg -n "failPreparedTask" src test` shows no consumer.

- [ ] **Step 5: Verify rollback GREEN**

Run the focused command from Step 2.

Expected: the new rollback test passes and no `pending` task or pg-boss job remains for its task UUID.

- [ ] **Step 6: Add a real atomic delivery regression**

Extend the existing stable pg-boss delivery test to call `enqueueReplayWrite(runId, database, queue, taskId)` instead of separately calling `prepareTask()` and `publish()`. Assert:

```ts
expect(enqueued).toMatchObject({ runId, taskId, jobId: taskId, queued: true });
expect(tasks.rows[0]).toEqual({ count: "1", attempts: "1", non_terminal: "0" });
```

Query `pgboss.job` by `taskId` before worker completion and assert its JSON payload equals `{ runId, taskId }`. Keep the existing second delivery/source-free assertion as a separate test using ordinary `publish()`.

- [ ] **Step 7: Run Task 1 affected tests and build**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false \
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved \
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw \
S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret \
npx vitest run test/integration/audience/job-delivery.test.ts test/e2e/audience-parser.e2e.test.ts --no-file-parallelism
npm run build
```

Expected: both files pass, TypeScript exits `0`, and no test reports a non-terminal replay orphan.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/apps/browser-runner/enqueue-replay-write.ts \
  src/apps/browser-runner/main.ts \
  src/shared/jobs/pg-boss-job-queue.ts \
  src/modules/audience/application/ports/audience-repository.ts \
  src/modules/audience/infrastructure/postgres/audience-repository.ts \
  test/integration/audience/job-delivery.test.ts
git commit -m "fix: enqueue replay task and job atomically"
```

---

### Task 2: Order-independent duplicate record policy

**Files:**
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-record-policy.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts:130-215`
- Modify: `src/apps/browser-runner/list-org-fixture-server.ts:60-112`
- Test: `test/integration/audience/list-org-browser-source.test.ts`

**Interfaces:**
- Consumes: typed result from `readCompany()` and existing `sameCompany()` normalization.
- Produces: exported `BrowserRecordResult` and `sameBrowserRecordResult(left, right): boolean`.
- Preserves: `duplicate_conflict`, typed reject reasons, occurrence ordering, raw blocker evidence, and first-seen accepted/rejected domain counts.

- [ ] **Step 1: Add three RED order regressions and one allowed duplicate regression**

Add fixture scenarios in `list-org-fixture-server.ts` using repeated record `1002` on page 1 (`from=1`) and page 2 (`from=2`):

- `accepted-then-rejected`: page 2 changes OKVED `43.11 → 43.12`;
- `rejected-then-accepted`: page 1 changes OKVED `43.11 → 43.12`;
- `rejected-reason-conflict`: page 1 has invalid INN and page 2 has mismatched OKVED;
- `duplicate-rejected-same`: both occurrences have mismatched OKVED.

Apply the scenario transformations to the rendered company body with these exact source values:

```ts
const mismatchedOkved = () => {
  body = body!.replace("<dt>ОКВЭД</dt><dd>43.11</dd>", "<dt>ОКВЭД</dt><dd>43.12</dd>");
};
const invalidInn = () => {
  body = body!.replace("<dt>ИНН</dt><dd>7710140679</dd>", "<dt>ИНН</dt><dd>not-an-inn</dd>");
};
if (companyKey === "1002") {
  if (scenario === "accepted-then-rejected" && from === "2") mismatchedOkved();
  if (scenario === "rejected-then-accepted" && from === "1") mismatchedOkved();
  if (scenario === "rejected-reason-conflict") {
    if (from === "1") invalidInn();
    else mismatchedOkved();
  }
  if (scenario === "duplicate-rejected-same") mismatchedOkved();
}
```

Add to `list-org-browser-source.test.ts`:

```ts
it.each([
  "accepted-then-rejected",
  "rejected-then-accepted",
  "rejected-reason-conflict",
])("blocks order-independent duplicate conflict for %s", async (scenario) => {
  const result = await collect(`/search?scenario=${scenario}`);
  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("duplicate_conflict");
  expect(result.blockers).toEqual([
    expect.objectContaining({
      reason: "duplicate_conflict",
      sourceRecordKey: "1002",
      raw: expect.objectContaining({ checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    }),
  ]);
});

it("collapses an identical rejected duplicate by source key and reason", async () => {
  const result = await collect("/search?scenario=duplicate-rejected-same");
  expect(result.status, result.reason).toBe("succeeded");
  expect(result.rejects.filter((item) => item.sourceRecordKey === "1002"))
    .toHaveLength(1);
});
```

- [ ] **Step 2: Run the duplicate regressions and verify RED**

Run:

```bash
npx vitest run test/integration/audience/list-org-browser-source.test.ts \
  -t "order-independent|identical rejected duplicate" --no-file-parallelism
```

Expected: at least accepted→rejected and rejected(A)→rejected(B) fail because the rejected branch continues before consulting the earlier outcome. Confirm the allowed same-reason duplicate behavior separately; a passing control does not replace the required RED failures.

- [ ] **Step 3: Define one normalized record result and equivalence rule**

In `browser-record-policy.ts`, name the existing `readCompany()` union and add one comparator:

```ts
export type BrowserRecordResult =
  | {
    kind: "accepted";
    sourceRecordKey: string;
    company: Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion">;
  }
  | { kind: "rejected"; sourceRecordKey: string; reason: DiscoveryRejectReason };

export function sameBrowserRecordResult(
  left: BrowserRecordResult,
  right: BrowserRecordResult,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "rejected") {
    return right.kind === "rejected" && left.reason === right.reason;
  }
  return right.kind === "accepted" && sameCompany(left.company, right.company);
}
```

Set `readCompany()` return type to `Promise<BrowserRecordResult>`.

- [ ] **Step 4: Replace asymmetric maps with one first-seen outcome map**

In `list-org-browser-source.ts` replace `firstSeen` plus `rejectedKeys` with:

```ts
const firstSeen = new Map<string, BrowserRecordResult>();
```

Immediately after capture/return-to-results and occurrence recording:

```ts
const prior = firstSeen.get(parsed.sourceRecordKey);
if (prior !== undefined && !sameBrowserRecordResult(prior, parsed)) {
  return await block("duplicate_conflict", {
    sourceRecordKey: parsed.sourceRecordKey,
    raw: cardRaw,
  });
}
if (prior !== undefined) continue;
firstSeen.set(parsed.sourceRecordKey, parsed);

if (parsed.kind === "rejected") {
  rejects.push({
    sourceRecordKey: parsed.sourceRecordKey,
    reason: parsed.reason,
    raw: cardRaw,
  });
  continue;
}
```

Then publish only the first accepted company using the existing raw checksum/parser fields. Remove the old rejected early-return and accepted-only duplicate branches.

- [ ] **Step 5: Verify Task 2 GREEN and preserve earlier scenarios**

Run:

```bash
npx vitest run test/integration/audience/list-org-browser-source.test.ts --no-file-parallelism
```

Expected: all browser integration tests pass, all three conflicting permutations block, exact accepted/rejected duplicates remain collapsed, and existing `conflicting-duplicate` behavior is unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/modules/audience/infrastructure/sources/list-org-browser/browser-record-policy.ts \
  src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts \
  src/apps/browser-runner/list-org-fixture-server.ts \
  test/integration/audience/list-org-browser-source.test.ts
git commit -m "fix: classify duplicate browser records symmetrically"
```

---

### Task 3: Fail-closed form-value sanitization

**Files:**
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts`
- Modify: `src/apps/browser-runner/list-org-fixture-server.ts:99-116`
- Create: `test/unit/audience/browser-raw-sanitizer.test.ts`
- Test: `test/integration/audience/list-org-browser-source.test.ts`

**Interfaces:**
- Consumes: `BrowserRawBundle`, `checksumBrowserRawBundle()`, Playwright `Page`, configured sensitive query names.
- Produces: `isSensitiveFormFieldName(name, configuredNames)`, DOM without input values, screenshot overlays for every non-empty form control, and checksum-boundary rejection of forbidden form attributes.
- Preserves: existing contact/query/action redaction, explicit safe tag allowlist, and immutable checksum ordering.

- [ ] **Step 1: Add RED checksum-boundary tests for unsafe form markup**

Create `test/unit/audience/browser-raw-sanitizer.test.ts` with a helper returning a minimal `BrowserRawBundle`, then assert the real checksum boundary rejects each unsafe DOM:

```ts
it.each([
  ['password', '<input type="password" name="password" value="pw-123">'],
  ['csrf', '<input type="text" name="csrf_token" value="csrf-123">'],
  ['api key', '<input type="text" name="api_key" value="api-123">'],
  ['unknown visible value', '<input type="text" name="public_field" value="visible-123">'],
])("rejects %s markup at the checksum boundary", (_case, input) => {
  expect(() => checksumBrowserRawBundle(rawBundle(`<!doctype html><html><body>${input}</body></html>`)))
    .toThrow("raw redaction scan failed");
});
```

The helper must use fixed non-secret values for `finalUrl`, timestamps, SHA-256-shaped fingerprint, empty actions, `candidateEvidence: null`, and a minimal PNG byte array. Do not test an internal regex directly.

- [ ] **Step 2: Run the checksum-boundary tests and verify RED**

Run:

```bash
npx vitest run test/unit/audience/browser-raw-sanitizer.test.ts
```

Expected: all four cases fail because the current `SAFE_CAPTURE_ATTRIBUTES` and post-scan accept `value=` form markup.

- [ ] **Step 3: Make the persistence boundary reject unsafe form attributes**

In `browser-raw-sanitizer.ts`:

- remove `value` from `SAFE_CAPTURE_ATTRIBUTES`;
- add a case-insensitive sensitive-name rule covering configured names and `token|csrf|secret|credential|password|api_key|apikey|authorization|cookie|session`;
- add a post-scan for serialized `<input>` markup containing `value=`, `type="password"`, or a sensitive `name=`;
- keep the public error text exactly `raw redaction scan failed`.

The scan must operate on the final serialized DOM inside `assertBrowserCaptureSafe()`, not only inside Playwright page evaluation.

- [ ] **Step 4: Verify boundary tests GREEN**

Run the command from Step 2.

Expected: 4/4 cases pass because `checksumBrowserRawBundle()` now throws for every unsafe fixture.

- [ ] **Step 5: Add a RED real-browser sanitization and screenshot regression**

Extend the fixture server with `scenario=form-secrets` on company `1001`. Insert four visibly sized controls before `</dl>`:

```html
<input style="width:260px" type="password" name="password" value="pw-123">
<input style="width:260px" type="text" name="csrf_token" value="csrf-123">
<input style="width:260px" type="text" name="api_key" value="api-123">
<input style="width:260px" type="text" name="public_field" value="visible-123">
```

Add an integration test that collects the scenario, finds card `1001`, and asserts:

```ts
const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
const evidence = `${dom}\n${new TextDecoder().decode(card!.manifestUtf8)}`;
expect(evidence).not.toMatch(/pw-123|csrf-123|api-123|visible-123/i);
expect(dom).not.toMatch(/\svalue=|name="(?:password|csrf_token|api_key)"/i);
expect(await countBlackContactBands(card!.redactedScreenshotPng))
  .toBeGreaterThan(await countBlackContactBands(baselineCard.redactedScreenshotPng));
```

Expected RED before the page sanitizer change: checksum creation throws or secret form values remain/unmasked.

- [ ] **Step 6: Implement DOM removal and screenshot overlays**

Inside `sanitizePageDom()` page evaluation:

- remove every password input;
- remove every input whose `name` matches configured or generic sensitive names;
- remove `value` from every remaining form control through the safe-attribute loop;
- keep non-sensitive `type`, `name`, `checked`, and `disabled` only.

Inside `addPageRedactionOverlays()` add every `input`, `textarea`, or `select` with a non-empty runtime value to the overlay set, in addition to the existing contact/known-secret nodes. Password and sensitive-name controls are therefore covered even when their DOM serialization is removed.

Keep browser-evaluated helpers as object methods so the production `tsx` transform does not inject Node-only `__name` references.

- [ ] **Step 7: Run all sanitizer/browser tests and build**

Run:

```bash
npx vitest run test/unit/audience/browser-raw-sanitizer.test.ts \
  test/integration/audience/list-org-browser-source.test.ts --no-file-parallelism
npm run build
```

Expected: both test files pass, existing mailto/metadata/aria/action/contact regressions remain green, the form-secret scenario persists sanitized evidence, and TypeScript exits `0`.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts \
  src/apps/browser-runner/list-org-fixture-server.ts \
  test/unit/audience/browser-raw-sanitizer.test.ts \
  test/integration/audience/list-org-browser-source.test.ts
git commit -m "fix: reject unknown browser form secrets"
```

---

### Task 4: Full acceptance and scoped review package

**Files:**
- Modify only if counts/commands change: `README.md`
- Modify only if commands change: `docs/runbooks/audience-parser-canary.md`
- Create during review workflow: `.superpowers/sdd/2026-08-24-okved-parser-final-blockers-follow-up/final-review-report.md`

**Interfaces:**
- Consumes: all three task commits and the binding follow-up spec.
- Produces: fresh verification evidence, a clean worktree, and one scoped review verdict for the follow-up diff.

- [ ] **Step 1: Run affected real-boundary tests**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false \
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved \
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw \
S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret \
npx vitest run test/integration/audience/job-delivery.test.ts \
  test/integration/audience/list-org-browser-source.test.ts \
  test/integration/audience/fixture-run.test.ts \
  test/e2e/audience-parser.e2e.test.ts --no-file-parallelism
```

Expected: all files pass with real PostgreSQL, MinIO, pg-boss, and Chromium boundaries.

- [ ] **Step 2: Run the fresh full suite and build**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false \
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved \
TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw \
S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret \
npm test
npm run build
```

Expected: zero failed tests and TypeScript exit `0`. Record the exact new test/file count; do not reuse the earlier 137-test result.

- [ ] **Step 3: Verify migration reversibility on only port 5433**

```bash
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: migration `001_audience_core` reverts and applies successfully; exact eleven-table schema tests remain green.

- [ ] **Step 4: Repeat clean fixture acceptance**

Follow `docs/runbooks/audience-parser-canary.md` with the ignored `5433:5432` Compose overlay. Run immutable OKVED release create/reuse, fixture discovery, replay through the real worker, a second delivery of the same task payload, fixture finance, and reconciliation.

Expected final report:

- run status terminal and published;
- replay task count stable with `nonTerminal=0`;
- financial counts `revenue=1`, `income=1`, `expenses=1`;
- `unexplainedSourceFetches=0`;
- `consistent=true`;
- `LIST_ORG_LIVE_ENABLED=false` throughout.

- [ ] **Step 5: Verify diff and protected paths**

```bash
git diff --check 20a5226cd56a32e66a8bccaf2402a93aaaa5c5bb..HEAD
git status --short
git diff --name-only 20a5226cd56a32e66a8bccaf2402a93aaaa5c5bb..HEAD
```

Expected: no whitespace errors, only follow-up-owned paths, and no `CONTEXT.md` or `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`.

- [ ] **Step 6: Generate and independently review the scoped package**

Generate a review package for the range `20a5226..HEAD`. The reviewer must read:

- `docs/superpowers/specs/2026-08-24-okved-parser-final-blockers-follow-up-design.md`;
- this plan;
- the three residual findings in the previous `final-rereview-report.md`;
- the generated diff.

Require explicit verdicts for atomic enqueue, all duplicate permutations, DOM/checksum/screenshot form-secret handling, and any new Critical/Important regression. The branch is ready only if Critical=`0`, Important=`0`, fresh verification remains green, and the worktree is clean.

- [ ] **Step 7: Commit documentation only if verification changed it**

If README/runbook commands or counts required correction:

```bash
git add README.md docs/runbooks/audience-parser-canary.md
git commit -m "docs: record OKVED blocker follow-up acceptance"
```

If no user-facing documentation changed, do not create an empty commit.
