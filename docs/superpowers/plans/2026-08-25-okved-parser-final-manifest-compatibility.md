# OKVED Parser Final Manifest Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final raw-manifest blockers by making browser action IDs canonical and fully scanned while restoring exact compatibility with both safe historical non-browser v1 schemas.

**Architecture:** Keep browser contact/secret policy and the canonical browser action-ID predicate in `browser-raw-sanitizer.ts`, then reuse that predicate from structural manifest verification in `s3-raw-object-storage.ts`. Extend the existing action metadata scan with `id` and select one of two exact non-browser v1 key sets without changing v2 serialization or browser-v1 quarantine.

**Tech Stack:** TypeScript 7, Node.js 24, Vitest 4, AWS SDK S3/MinIO, Docker Compose, PostgreSQL 17.

**Binding spec:** `docs/superpowers/specs/2026-08-25-okved-parser-final-manifest-compatibility-design.md`

## Global Constraints

- `actions[].id` is a lowercase, hyphenated UUID v4 with standard RFC variant bits.
- Every retained browser action ID is included in the centralized contact/secret scan.
- Non-browser manifest v1 accepts exactly two schemas: no `sensitiveFormFieldNames`, or `sensitiveFormFieldNames: []`.
- Non-browser v1 rejects a non-empty policy, a policy of another type, and all unknown fields.
- Browser manifest v1 remains quarantined. New manifests remain version 2.
- Stored raw bytes are never rewritten or repaired.
- Live List-Org and FNS remain disabled. Every app, test, migration, and Compose command uses `APP_MODE=fixture` and `LIST_ORG_LIVE_ENABLED=false`.
- Owned services use PostgreSQL `127.0.0.1:5433` and MinIO `127.0.0.1:9000`. Host PostgreSQL 5432 is not stopped, reconfigured, or used.
- No database migration, schema change, dependency change, external request, merge, or push is allowed.
- Production changes follow RED-GREEN TDD. Each new regression must fail for the intended missing behavior before production code changes.
- Do not modify `.playwright-cli/console-2026-08-21T09-16-39-068Z.log`, `CONTEXT.md`, or `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`.

## File Map

- `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts` owns the centralized contact/secret scan and canonical action-ID predicate for retained browser evidence.
- `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts` owns exact manifest schemas, canonical action-ID validation, and historical v1 parsing.
- `test/unit/audience/browser-raw-sanitizer.test.ts` proves that action IDs are part of the pre-persistence redaction boundary.
- `test/integration/audience/s3-raw-object-storage.test.ts` proves checksum-consistent stored-manifest rejection and the exact v1 compatibility matrix.

---

### Task 1: Bind browser action IDs to the sanitizer and UUID v4 schema

**Files:**

- Modify: `test/unit/audience/browser-raw-sanitizer.test.ts:11-106`
- Modify: `test/integration/audience/s3-raw-object-storage.test.ts:337-445`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts:106-132`
- Modify: `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts:256-267,326-352`

**Interfaces:**

- Consumes: `BrowserRawBundle.actions`, `BrowserActionEvent.id`, `assertNoContactOrSecret(text, sensitiveValues)`.
- Produces: `isCanonicalBrowserActionId(value: unknown): value is string`, used before persistence and during S3 manifest parsing.
- Preserves: `BrowserRawBundle`, `BrowserActionEvent`, raw-manifest v2 layout, and `S3RawObjectStorage.verify()` public types.

- [ ] **Step 1: Write the failing persistence-boundary scan regression**

Add this test inside `browser raw sanitizer persistence boundary`:

```ts
it("rejects contact material in an action ID at the checksum boundary", () => {
  const bundle = rawBundle(
    "<!doctype html><html><body><main>safe</main></body></html>",
  );
  bundle.actions = [{
    id: "operator@example.test",
    at: "2026-08-24T09:00:00.000Z",
    kind: "navigate",
    target: "/results/page-1",
    outcome: "completed",
    navigationStatus: 200,
  }];

  expect(() => checksumBrowserRawBundle(bundle)).toThrow("raw redaction scan failed");
});
```

Add a separate safe-but-noncanonical format regression:

```ts
it("rejects a noncanonical action ID at the checksum boundary", () => {
  const bundle = rawBundle(
    "<!doctype html><html><body><main>safe</main></body></html>",
  );
  bundle.actions = [{
    id: "action-1",
    at: "2026-08-24T09:00:00.000Z",
    kind: "navigate",
    target: "/results/page-1",
    outcome: "completed",
    navigationStatus: 200,
  }];

  expect(() => checksumBrowserRawBundle(bundle)).toThrow(
    "browser action id is not a canonical UUID v4",
  );
});
```

- [ ] **Step 2: Run the unit regression and confirm RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts
```

Expected: both new tests fail because checksumming succeeds. A type error or unrelated sanitizer failure is not the intended RED.

- [ ] **Step 3: Write checksum-consistent stored-ID regressions**

Add this table near the existing invalid action timestamp cases in `s3-raw-object-storage.test.ts`:

```ts
it.each([
  ["contact material", "operator@example.test"],
  ["uppercase UUID", "123E4567-E89B-42D3-A456-426614174000"],
  ["non-v4 UUID", "123e4567-e89b-12d3-a456-426614174000"],
  ["non-standard UUID variant", "123e4567-e89b-42d3-7456-426614174000"],
] as const)("rejects checksum-consistent action ID with %s", async (_case, id) => {
  const stored = await putChecksumConsistentBrowserManifest(
    `s3-invalid-action-id-${_case.replaceAll(" ", "-")}`,
    (manifest) => {
      manifest.actions[0]!.id = id;
    },
  );

  const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
  await expect(browserStorage.verify(stored)).rejects.toThrow(
    "raw object checksum verification failed",
  );
});
```

The existing helper recomputes the manifest checksum after mutation, so these cases exercise semantic parsing rather than a stale-checksum failure.

- [ ] **Step 4: Start the owned MinIO/PostgreSQL services and confirm S3 RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml up -d --wait postgres minio
```

Then run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: all four new action-ID cases fail because verification currently accepts any non-empty control-free ID. An S3 connection failure is not the intended RED.

- [ ] **Step 5: Include the action ID in centralized textual evidence**

Change the mapped action metadata in `assertBrowserCaptureSafe()` to:

```ts
const actionMetadata = bundle.actions.map((action) => ({
  id: action.id,
  kind: action.kind,
  target: action.target,
  outcome: action.outcome,
  navigationStatus: action.navigationStatus,
}));
```

Do not create a second scan or special action-ID redactor. After the scan, reject any noncanonical ID with the shared predicate:

```ts
if (bundle.actions.some((action) => !isCanonicalBrowserActionId(action.id))) {
  throw new Error("browser action id is not a canonical UUID v4");
}
```

The scan runs first so contact material reports the redaction-policy failure; safe malformed IDs report the structural UUID failure.

- [ ] **Step 6: Add exact UUID v4 validation at stored-manifest parsing**

Export this predicate from `browser-raw-sanitizer.ts` next to the other persistence-boundary helpers:

```ts
export function isCanonicalBrowserActionId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
```

Import the predicate beside `assertBrowserCaptureSafe` in `s3-raw-object-storage.ts`, then replace the generic action-ID check in `isBrowserActionEvent()`:

```ts
&& isCanonicalBrowserActionId(value.id)
```

Keep the exact action-event key set and all timestamp, text, outcome, and navigation-status checks unchanged.

- [ ] **Step 7: Run targeted tests and confirm GREEN**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: both files pass. Contact material fails at the in-memory redaction boundary, a safe malformed ID fails the pre-persistence UUID boundary, and all checksum-consistent invalid stored IDs fail structural verification.

- [ ] **Step 8: Run the TypeScript build**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
```

Expected: exit code 0.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts
git diff --cached --check
git commit -m "fix: validate retained browser action ids"
```

---

### Task 2: Restore the exact non-browser v1 compatibility matrix

**Files:**

- Modify: `test/integration/audience/s3-raw-object-storage.test.ts:447-540,600-650`
- Modify: `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts:192-254`

**Interfaces:**

- Consumes: JSON raw manifest bytes, `RAW_MANIFEST_VERSION`, `hasExactlyKeys()`, and the existing non-browser verification path.
- Produces: exact selection between `LEGACY_RAW_MANIFEST_KEYS` and `CURRENT_RAW_MANIFEST_KEYS`; both allowed non-browser v1 forms normalize to `sensitiveFormFieldNames: []`.
- Preserves: browser-v1 quarantine error, v2 exact schema, checksum/identity verification, stored bytes, and `VerifiedRawObject`.

- [ ] **Step 1: Replace the incorrect policy-field rejection test with the exact v1 matrix**

Add this helper inside the `S3RawObjectStorage` describe block, immediately before `putChecksumConsistentBrowserManifest()`:

```ts
async function putLegacyNonBrowserManifest(
  runId: string,
  mutate: (manifest: Record<string, unknown>) => void,
) {
  const bundle = checksumBrowserRawBundle({
    ...sampleRawBundle(runId),
    sourceKind: "fns-bfo",
    candidateEvidence: null,
  });
  const manifest = JSON.parse(
    new TextDecoder().decode(bundle.manifestUtf8),
  ) as Record<string, unknown>;
  manifest.version = 1;
  mutate(manifest);
  return putManifestBytes(
    bundle,
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
}
```

Replace the existing single browser-v1 quarantine case with both historical top-level shapes:

```ts
it.each([
  ["without form policy", (manifest: Record<string, unknown>) => {
    delete manifest.sensitiveFormFieldNames;
  }],
  ["with an empty form policy", (manifest: Record<string, unknown>) => {
    manifest.sensitiveFormFieldNames = [];
  }],
] as const)("quarantines legacy browser manifest %s", async (_case, mutate) => {
  const bundle = sampleBundle(`s3-legacy-browser-${_case.replaceAll(" ", "-")}`);
  const legacy = JSON.parse(
    new TextDecoder().decode(bundle.manifestUtf8),
  ) as Record<string, unknown>;
  legacy.version = 1;
  mutate(legacy);
  const stored = await putManifestBytes(
    bundle,
    new TextEncoder().encode(JSON.stringify(legacy)),
  );

  const storage = new S3RawObjectStorage(env, "list-org-browser", client);
  await expect(storage.verify(stored)).rejects.toThrow(
    "raw manifest version 1 is unsupported for browser evidence",
  );
});
```

Replace the duplicated non-browser-v1 acceptance and the test that calls the policy field v2-only with:

```ts
it.each([
  ["without form policy", (manifest: Record<string, unknown>) => {
    delete manifest.sensitiveFormFieldNames;
  }],
  ["with an empty form policy", (manifest: Record<string, unknown>) => {
    manifest.sensitiveFormFieldNames = [];
  }],
] as const)("verifies legacy non-browser manifest %s", async (_case, mutate) => {
  const stored = await putLegacyNonBrowserManifest(
    `s3-legacy-financial-${_case.replaceAll(" ", "-")}`,
    mutate,
  );

  const storage = new S3RawObjectStorage(env, "fns-bfo", client);
  await expect(storage.verify(stored)).resolves.toMatchObject({
    sourceKind: "fns-bfo",
    sourceRecordKey: "1001",
    checksumSha256: stored.checksumSha256,
  });
});

it.each([
  ["a non-empty form policy", (manifest: Record<string, unknown>) => {
    manifest.sensitiveFormFieldNames = ["auth"];
  }],
  ["a non-array form policy", (manifest: Record<string, unknown>) => {
    manifest.sensitiveFormFieldNames = "auth";
  }],
  ["an unknown field", (manifest: Record<string, unknown>) => {
    delete manifest.sensitiveFormFieldNames;
    manifest.persistedSecret = "must-not-survive-verification";
  }],
] as const)("rejects legacy non-browser manifest with %s", async (_case, mutate) => {
  const stored = await putLegacyNonBrowserManifest(
    `s3-invalid-legacy-financial-${_case.replaceAll(" ", "-")}`,
    mutate,
  );

  const storage = new S3RawObjectStorage(env, "fns-bfo", client);
  await expect(storage.verify(stored)).rejects.toThrow(
    "raw object checksum verification failed",
  );
});
```

- [ ] **Step 2: Run the S3 test and confirm compatibility RED**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: only the accepted v1 case with `sensitiveFormFieldNames: []` fails. The v1 case without the field passes, all three hostile v1 cases fail, both browser-v1 shapes remain quarantined, and Task 1 action-ID cases remain green.

- [ ] **Step 3: Define the two exact manifest key sets**

Add these constants immediately before `parseRawManifest()`:

```ts
const LEGACY_RAW_MANIFEST_KEYS = [
  "version", "sourceKind", "parserVersion", "finalUrl", "capturedAt",
  "navigationStatus", "pageFingerprintSha256", "identity", "candidateEvidence",
  "actions", "artifacts",
] as const;

const CURRENT_RAW_MANIFEST_KEYS = [
  ...LEGACY_RAW_MANIFEST_KEYS,
  "sensitiveFormFieldNames",
] as const;
```

The current key set is shared by v2 and the transitional v1 shape; validation rules, not key names, distinguish their policy semantics.

- [ ] **Step 4: Select the exact v1 shape and validate an exact empty policy**

After browser-v1 quarantine, calculate:

```ts
const isLegacyNonBrowser = value.version === 1;
const hasLegacyPolicy = isLegacyNonBrowser
  && Object.hasOwn(value, "sensitiveFormFieldNames");
const expectedKeys = isLegacyNonBrowser && !hasLegacyPolicy
  ? LEGACY_RAW_MANIFEST_KEYS
  : CURRENT_RAW_MANIFEST_KEYS;
const hasValidSensitivePolicy = isLegacyNonBrowser
  ? !hasLegacyPolicy
    || (Array.isArray(value.sensitiveFormFieldNames)
      && value.sensitiveFormFieldNames.length === 0)
  : isSafeRetainedTextArray(value.sensitiveFormFieldNames);
```

Use these values in the existing fail-closed condition:

```ts
if ((!isLegacyNonBrowser && value.version !== RAW_MANIFEST_VERSION)
  || !hasExactlyKeys(value, expectedKeys)
  || typeof value.sourceKind !== "string"
  || !/^[a-z0-9-]+$/.test(value.sourceKind)
  || !isSafeRetainedText(value.parserVersion)
  || !hasValidSensitivePolicy
  || !isSafeRetainedText(value.finalUrl)
  || !isCanonicalIsoTimestamp(value.capturedAt)
  || !isNavigationStatus(value.navigationStatus)
  || !isSha256(value.pageFingerprintSha256)
  || !isRawIdentity(value.identity)
  || !isCandidateEvidenceOrNull(value.candidateEvidence)
  || !Array.isArray(value.actions)
  || !value.actions.every(isBrowserActionEvent)
  || !isRecord(value.artifacts)
  || !hasExactlyKeys(value.artifacts, ["sanitizedDom", "redactedScreenshot"])
  || !isArtifact(value.artifacts.sanitizedDom)
  || !isArtifact(value.artifacts.redactedScreenshot)
) {
  return null;
}
```

Retain the existing return normalization:

```ts
sensitiveFormFieldNames: isSafeRetainedTextArray(value.sensitiveFormFieldNames)
  ? value.sensitiveFormFieldNames
  : [],
```

Because the transitional v1 policy is validated as exactly empty, both accepted v1 shapes normalize to `[]`. Do not infer missing fields, copy unknown fields, or alter stored bytes.

- [ ] **Step 5: Run the compatibility tests and confirm GREEN**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: the full S3 storage file passes, including both accepted non-browser v1 shapes, all three rejected hostile shapes, both browser-v1 quarantine cases, v2 exact-key checks, and Task 1 UUID checks.

- [ ] **Step 6: Run combined targeted tests and build**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts
```

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts test/integration/audience/s3-raw-object-storage.test.ts
git diff --cached --check
git commit -m "fix: restore safe raw manifest v1 compatibility"
```

---

### Task 3: Run full fixture acceptance and preserve repository boundaries

**Files:**

- Verify only: all production, unit, integration, e2e, migration, and protected-file boundaries.
- Do not create an empty acceptance commit.

**Interfaces:**

- Consumes: Task 1 and Task 2 commits, owned Compose services, fixture-only environment.
- Produces: fresh command evidence that the branch is buildable, migration-safe, test-clean, and ready for final whole-branch review.

- [ ] **Step 1: Verify the runtime and owned service bindings**

```bash
node --version
```

Expected: `v24.x.x`.

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml up -d --wait postgres minio
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml ps
```

Expected: PostgreSQL is healthy on host 5433 and MinIO is healthy on host 9000. Do not operate on host PostgreSQL 5432.

- [ ] **Step 2: Verify migration reversibility on PostgreSQL 5433**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the complete test suite after migration replay**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
```

Expected: every unit, integration, and e2e test passes with no live source access.

- [ ] **Step 4: Run a fresh dedicated e2e pass and TypeScript build**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Audit the final worktree and protected files**

```bash
git diff --check
git status --short --branch
git diff --exit-code 1a05e9d3a3c55a75d45798332c77584842e673f9..HEAD -- .playwright-cli/console-2026-08-21T09-16-39-068Z.log CONTEXT.md docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
```

Expected: `git diff --check` and the protected-file diff exit 0; `git status` shows a clean `codex/okved-parser` worktree.

- [ ] **Step 6: Stop only the owned services and preserve volumes**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f .superpowers/postgres-5433.compose.yaml down
```

Expected: project `okved-parser` containers stop. Do not add `-v`; preserved volumes remain available for later acceptance runs.

## Completion Gate

Implementation is complete only after Task 1 and Task 2 each pass requirement and code-quality review, Task 3 produces fresh successful evidence, and a final reviewer confirms the whole branch diff against the binding spec. Do not merge or push without a separate explicit user instruction.
