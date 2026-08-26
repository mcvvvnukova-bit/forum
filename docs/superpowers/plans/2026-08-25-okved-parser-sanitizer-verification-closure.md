# OKVED Parser Sanitizer Verification Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining browser raw-evidence sanitizer gaps so capture and immutable S3 verification enforce one fail-closed policy across URL, action, candidate website, DOM, and screenshot surfaces.

**Architecture:** Keep `browser-raw-sanitizer.ts` as the single owner of browser evidence policy and safety checks. Extend the parsed S3 manifest with the safety fields it already stores, reconstruct the narrow browser safety input after checksum/identity verification, and call the same verifier used before persistence. Extend the rendered-page overlay pass to include buttons without changing the sanitized DOM or manifest schema.

**Tech Stack:** TypeScript 7, Node.js 24, Vitest 4, Playwright 1.62, AWS SDK S3/MinIO, Docker Compose, PostgreSQL 17.

**Binding spec:** `docs/superpowers/specs/2026-08-25-okved-parser-sanitizer-verification-closure-design.md`

## Global Constraints

- For `list-org-browser`, `sensitiveFormFieldNames` contains every entry from `MANDATORY_SENSITIVE_QUERY_PARAMETERS`, matched case-insensitively.
- Missing mandatory names make browser v2 evidence invalid; verification never silently adds them.
- Configured extra names remain checksum-bound and apply to `finalUrl`, every action target, candidate website, serialized DOM, and rendered screenshot.
- Browser manifest v1 remains quarantined; safe non-browser manifest v1 compatibility remains unchanged; manifest v2 is not bumped again.
- `revenue` remains sourced only from BFO `Ф2.2110`; `income` and `expenses` remain sourced only from FNS revexp.
- Stage 1 remains legal entities/INN-10; IP remains stage 2.
- Live List-Org/FNS remains disabled. Every command uses `APP_MODE=fixture` and `LIST_ORG_LIVE_ENABLED=false`.
- Owned services use PostgreSQL `127.0.0.1:5433` and MinIO `127.0.0.1:9000`. Host PostgreSQL 5432 is not stopped, reconfigured, or used by tests.
- No migration or schema change is allowed.
- Production changes follow strict RED-GREEN TDD: each regression first fails for the intended missing behavior.
- Do not merge or push. Do not modify protected main-checkout files.

## File map

- `browser-raw-sanitizer.ts` owns mandatory policy validation, full browser safety verification, DOM validation, and screenshot overlays.
- `s3-raw-object-storage.ts` parses checksum-bound manifest fields and invokes the centralized verifier.
- `list-org-fixture-server.ts` renders the sensitive-button fixture.
- Unit and integration tests prove policy, immutable verification, and screenshot behavior.
- `fixture-run.test.ts` and `job-delivery.test.ts` update only their manual browser bundles to the mandatory-policy invariant.

---

### Task 1: Enforce complete policy and reverify immutable manifest surfaces

**Files:**

- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts:1-130`
- Modify: `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts:1-225`
- Modify: `test/unit/audience/browser-raw-sanitizer.test.ts:1-125`
- Modify: `test/integration/audience/s3-raw-object-storage.test.ts:150-440`
- Modify: `test/integration/audience/fixture-run.test.ts:360-390`
- Modify: `test/integration/audience/job-delivery.test.ts:340-370,510-535`

**Interfaces:**

- Consumes: `BrowserRawBundle`, `BrowserActionEvent`, `CandidateEvidence`, `MANDATORY_SENSITIVE_QUERY_PARAMETERS`, manifest v2.
- Produces: `assertCompleteBrowserSensitivePolicy(sourceKind: string, sensitiveFormFieldNames: readonly string[] | undefined): void` and `BrowserCaptureSafetyEvidence`.
- Preserves: `checksumBrowserRawBundle()` layout and `S3RawObjectStorage.verify()` return type.

- [ ] **Step 1: Update manual browser test fixtures to the approved baseline policy**

Import `MANDATORY_SENSITIVE_QUERY_PARAMETERS` in all Task 1 tests that manually construct `list-org-browser` bundles. Replace browser-only empty policies with:

```ts
sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
```

Replace configured-only fixtures such as `sensitiveFormFieldNames: ["nonce"]` with:

```ts
sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS, "nonce"],
```

This includes the checksum-consistent configured-DOM manifest test; it must continue failing for unsafe DOM, not for an incomplete policy.

Change the unit helper argument to configured extras:

```ts
function rawBundle(
  dom: string,
  configuredSensitiveFormFieldNames: readonly string[] = [],
): BrowserRawBundle {
  return {
    sourceKind: "list-org-browser",
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "https://fixture.invalid/company/1001",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8: new TextEncoder().encode(dom),
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71]),
    pageFingerprintSha256: "0".repeat(64),
    identity: { runId: "browser-sanitizer-test", page: 1, sourceRecordKey: "1001" },
    candidateEvidence: null,
    actions: [],
    sensitiveFormFieldNames: [
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...configuredSensitiveFormFieldNames,
    ],
  };
}
```

Make `sampleRawBundle()` in the S3 test use the same browser baseline. Do not add browser policy to `fns-bfo` bundles.

- [ ] **Step 2: Write the failing mandatory-policy unit regression**

```ts
it("rejects a browser policy that omits a mandatory sensitive name", () => {
  const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
  bundle.sensitiveFormFieldNames = MANDATORY_SENSITIVE_QUERY_PARAMETERS.filter(
    (name) => name !== "auth",
  );

  expect(() => checksumBrowserRawBundle(bundle)).toThrow(
    "browser raw bundle sensitive form policy is incomplete",
  );
});
```

Keep the missing-policy test and update it to expect the same incomplete-policy error.

- [ ] **Step 3: Verify unit RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts
```

Expected: FAIL because a present array omitting `auth` is accepted. A fixture or syntax failure is not the intended RED.

- [ ] **Step 4: Implement the centralized mandatory-policy boundary**

Add:

```ts
export function assertCompleteBrowserSensitivePolicy(
  sourceKind: string,
  sensitiveFormFieldNames: readonly string[] | undefined,
): void {
  if (sourceKind !== "list-org-browser") return;
  const normalized = new Set(
    (sensitiveFormFieldNames ?? []).map((name) => name.toLocaleLowerCase("en-US")),
  );
  if (MANDATORY_SENSITIVE_QUERY_PARAMETERS.some((name) => !normalized.has(name))) {
    throw new Error("browser raw bundle sensitive form policy is incomplete");
  }
}
```

Add the narrow safety input:

```ts
export type BrowserCaptureSafetyEvidence = Pick<
  BrowserRawBundle,
  | "sourceKind"
  | "finalUrl"
  | "sanitizedDomUtf8"
  | "candidateEvidence"
  | "actions"
  | "sensitiveFormFieldNames"
>;
```

Make `assertBrowserCaptureSafe()` accept this type and call the policy validator first. Make `assertPersistableRawBundle()` delegate to that verifier instead of keeping a presence-only branch.

- [ ] **Step 5: Verify unit GREEN**

Run Step 3 again. Expected: the unit file passes, including missing-policy, malformed-control, configured-name, and API-key cases.

- [ ] **Step 6: Write checksum-consistent S3 RED regressions**

Add this test helper; it deliberately rehashes hostile bytes without calling a production sanitizer:

```ts
interface MutableBrowserManifestFixture extends Record<string, unknown> {
  sensitiveFormFieldNames: string[];
  finalUrl: string;
  actions: Array<{ target: string }>;
  candidateEvidence: { website: string | null };
}

async function putChecksumConsistentBrowserManifest(
  runId: string,
  mutate: (manifest: MutableBrowserManifestFixture) => void,
) {
  const bundle = sampleBundle(runId);
  const manifest = JSON.parse(
    new TextDecoder().decode(bundle.manifestUtf8),
  ) as MutableBrowserManifestFixture;
  mutate(manifest);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const checksumSha256 = fixtureSha256(manifestBytes);
  const prefix = `raw/${runId}/list-org-browser/${checksumSha256}`;
  const stored = {
    runId,
    sourceKind: "list-org-browser",
    sourceRecordKey: "1001",
    parserVersion: bundle.parserVersion,
    checksumSha256,
    prefix,
    manifestKey: `${prefix}/manifest.json`,
    domKey: `${prefix}/dom.html`,
    screenshotKey: `${prefix}/screenshot.png`,
  };
  await Promise.all([
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: stored.domKey,
      Body: bundle.sanitizedDomUtf8,
    })),
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: stored.screenshotKey,
      Body: bundle.redactedScreenshotPng,
    })),
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: stored.manifestKey,
      Body: manifestBytes,
    })),
  ]);
  return stored;
}
```

The helper uses the existing `client`, `bucket`, `PutObjectCommand`, and `fixtureSha256` test boundaries.

Add table-driven cases with an explicit tuple type:

```ts
const hostileManifestCases: Array<[
  string,
  string,
  (manifest: MutableBrowserManifestFixture) => void,
]> = [
  ["final URL", "final-url", (manifest: MutableBrowserManifestFixture) => {
    manifest.finalUrl = "https://fixture.invalid/page?nonce=final-secret";
  }],
  ["action target", "action-target", (manifest: MutableBrowserManifestFixture) => {
    manifest.actions[0]!.target = "https://fixture.invalid/page?nonce=action-secret";
  }],
  ["candidate website", "candidate-website", (manifest: MutableBrowserManifestFixture) => {
    manifest.candidateEvidence.website = "https://fixture.invalid/?nonce=website-secret";
  }],
];

it.each(hostileManifestCases)(
  "rejects checksum-consistent configured secret in %s",
  async (_case, runSlug, mutate) => {
  const stored = await putChecksumConsistentBrowserManifest(
    `s3-hostile-${runSlug}`,
    (manifest) => {
      manifest.sensitiveFormFieldNames = [
        ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
        "nonce",
      ];
      mutate(manifest);
    },
  );
  await expect(browserStorage.verify(stored)).rejects.toThrow("raw redaction scan failed");
  },
);
```

Add incomplete v2 policy:

```ts
it("rejects a checksum-consistent browser manifest with an incomplete policy", async () => {
  const stored = await putChecksumConsistentBrowserManifest(
    "s3-incomplete-browser-policy",
    (manifest) => {
      manifest.sensitiveFormFieldNames = [];
      manifest.finalUrl = "https://fixture.invalid/page?auth=must-not-pass";
    },
  );
  await expect(browserStorage.verify(stored)).rejects.toThrow(
    "browser raw bundle sensitive form policy is incomplete",
  );
});
```

- [ ] **Step 7: Start owned services and verify S3 RED**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
```

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: four new cases FAIL because parsed verification discards URL/actions and validates only DOM.

- [ ] **Step 8: Retain and validate browser safety fields in the parsed manifest**

Extend `RawManifest` with `finalUrl: string` and `actions: readonly BrowserActionEvent[]`. Import `BrowserActionEvent` and `assertBrowserCaptureSafe`. Require `typeof value.finalUrl === "string"` and an array where every member passes:

```ts
function isBrowserActionEvent(value: unknown): value is BrowserActionEvent {
  return isRecord(value)
    && hasExactlyKeys(value, [
      "id", "at", "kind", "target", "outcome", "navigationStatus",
    ])
    && typeof value.id === "string"
    && typeof value.at === "string"
    && typeof value.kind === "string"
    && typeof value.target === "string"
    && ["intent", "completed", "contract-drift", "failed"].includes(String(value.outcome))
    && (value.navigationStatus === null
      || (Number.isSafeInteger(value.navigationStatus)
        && Number(value.navigationStatus) >= 100
        && Number(value.navigationStatus) <= 599));
}
```

Return both fields from `parseRawManifest()`. Malformed actions return `null` and follow existing checksum-verification failure behavior.

- [ ] **Step 9: Invoke the full verifier after checksum and identity checks**

Replace the DOM-only call with a browser-only full verification so non-browser v1 behavior stays unchanged:

```ts
if (manifest.sourceKind === "list-org-browser") {
  assertBrowserCaptureSafe({
    sourceKind: manifest.sourceKind,
    finalUrl: manifest.finalUrl,
    sanitizedDomUtf8: domBytes,
    candidateEvidence: manifest.candidateEvidence,
    actions: manifest.actions,
    sensitiveFormFieldNames: manifest.sensitiveFormFieldNames,
  });
}
```

Do not normalize the persisted policy and do not add S3-specific secret predicates.

- [ ] **Step 10: Verify affected GREEN**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/fixture-run.test.ts test/integration/audience/job-delivery.test.ts
```

Expected: all four files pass; valid v2, browser v1 quarantine, non-browser v1 compatibility, identity tamper, and artifact tamper remain green.

- [ ] **Step 11: Build and commit Task 1**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
git diff --check
```

```bash
git add src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/fixture-run.test.ts test/integration/audience/job-delivery.test.ts
git commit -m "fix: verify browser manifest safety across S3"
```

---

### Task 2: Mask sensitive named buttons in rendered screenshots

**Files:**

- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts:258-340`
- Modify: `src/apps/browser-runner/list-org-fixture-server.ts:140-155`
- Modify: `test/integration/audience/list-org-browser-source.test.ts:330-365`

**Interfaces:**

- Consumes: `addPageRedactionOverlays(page, labels, sensitiveFormFieldNames, redactionValues)` and the complete policy produced by `PlaywrightBrowserSessionFactory`.
- Produces: the same function signature, now covering `HTMLButtonElement`.
- Preserves: sanitized DOM behavior, PNG format, contact-band oracle, and action ledger.

- [ ] **Step 1: Add a sensitive empty-value button to the browser fixture**

Add to the existing `empty-form-secret` scenario after the two inputs:

```html
<button style="display:block;width:260px;height:24px;margin:4px 0"
        type="button" name="nonce" value="">nonce button reminder</button>
```

Do not add a separate production route or test-only runtime state.

- [ ] **Step 2: Tighten the screenshot regression and verify RED**

Rename the existing test to include the button and assert:

```ts
const dom = new TextDecoder().decode(card!.sanitizedDomUtf8);
expect(dom).not.toMatch(
  /password reminder|nonce reminder|nonce button reminder|name="(?:password|nonce)"/i,
);
expect(await countBlackContactBands(card!.redactedScreenshotPng)).toBe(
  await countBlackContactBands(baselineCard!.redactedScreenshotPng) + 3,
);
```

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/integration/audience/list-org-browser-source.test.ts
```

Expected: FAIL because the screenshot contains only two additional black bands; the DOM assertion already passes.

- [ ] **Step 3: Add buttons to the existing overlay loop**

Use:

```ts
for (const control of document.querySelectorAll("input, textarea, select, button")) {
  if ((control instanceof HTMLInputElement
    || control instanceof HTMLTextAreaElement
    || control instanceof HTMLSelectElement
    || control instanceof HTMLButtonElement)
    && (control.value !== ""
      || (control instanceof HTMLInputElement && control.type.toLowerCase() === "password")
      || helpers.isSensitiveFormFieldName(control.name))) {
    elements.add(control);
  }
}
```

Do not special-case fixture text or change overlay geometry.

- [ ] **Step 4: Verify browser GREEN**

Run Step 2 again. Expected: the file passes and the case reports exactly three additional black bands.

- [ ] **Step 5: Run all affected sanitizer/S3/browser tests**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Expected: all affected files pass and make no non-loopback request.

- [ ] **Step 6: Build and commit Task 2**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
git diff --check
```

```bash
git add src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts src/apps/browser-runner/list-org-fixture-server.ts test/integration/audience/list-org-browser-source.test.ts
git commit -m "fix: mask sensitive buttons in browser evidence"
```

---

### Task 3: Run clean fixture acceptance and preserve the live boundary

**Files:**

- Verify: all Task 1–2 files
- Verify: `migrations/001_audience_core.ts`
- Verify: `test/e2e/audience-parser.e2e.test.ts`
- Modify only if commands became inaccurate: `README.md`, `docs/runbooks/audience-parser-canary.md`, `docs/architecture/audience-ingestion-source-policy.md`

**Interfaces:**

- Consumes: reviewed Task 1 and Task 2 commits.
- Produces: fresh build, migration, full-suite, e2e, clean-worktree, and live-gate evidence.
- Preserves: no schema change, no live access, no IP stage-1 ingestion.

- [ ] **Step 1: Start only owned services with explicit gates**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
```

Confirm the ports with:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps
```

Project `okved-parser` must map PostgreSQL to host 5433 and MinIO to host 9000. Do not run `down -v`.

- [ ] **Step 2: Verify reversible migration**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
```

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: both exit 0 and `001_audience_core` is reverted then reapplied without a migration diff.

- [ ] **Step 3: Run the full suite**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
```

Expected: at least the current 18 files / 175 tests plus the new regressions pass with zero failures.

- [ ] **Step 4: Run clean fixture e2e acceptance**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts
```

Expected: 10/10 e2e cases, reconciliation `consistent=true`, terminal tasks only, and no non-loopback source contact.

- [ ] **Step 5: Build and inspect final state**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
git diff --check
git status --short
git diff --name-only 1a05e9d3a3c55a75d45798332c77584842e673f9..HEAD -- CONTEXT.md .playwright-cli/console-2026-08-21T09-16-39-068Z.log docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
```

Expected: build/diff check exit 0 and both Git output checks are empty.

- [ ] **Step 6: Stop owned containers and record evidence**

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml down
```

Preserve volumes. Record exact counts, migration results, e2e result, build, gates, cleanup, HEAD, and clean status in the Task 3 report. Do not create an empty docs commit when README/runbook/source-policy remain accurate.

---

## Final review gate

After all tasks pass task-scoped spec and quality review, generate a whole-branch package from merge base `1a05e9d3a3c55a75d45798332c77584842e673f9` to final HEAD. The reviewer explicitly re-verdicts the three sanitizer gaps and confirms earlier atomic replay, duplicate, evidence-required blocker, financial source-time, and manifest-compatibility fixes remain closed. Final findings follow one final-fix wave plus one scoped re-review; merge and push require separate user approval.
