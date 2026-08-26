# Automatic Fix Cycle Timebox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-final-fix-wave stop with a 12-hour automatic review/fix loop and close the two remaining browser screenshot/DOM redaction findings.

**Architecture:** The controller records one wall-clock deadline in the active SDD ledger and checks it before every new fix wave. Browser capture moves DOM sanitization and screenshot overlay discovery onto one rendered-text model: visible text is split at layout boundaries, Unicode-insensitive matches carry normalized-to-original UTF-16 offsets, and only the smallest rendered container of a real occurrence is masked or collapsed. Full fixture acceptance and independent review repeat automatically until clean or until the deadline prevents a new wave.

**Tech Stack:** TypeScript 7, Node.js 24, Playwright 1.62, Vitest 4, PostgreSQL 5433, MinIO/S3 9000/9001, Docker Compose, Git.

**Spec:** `docs/superpowers/specs/2026-08-25-automatic-fix-cycle-timebox-design.md`

## Global Constraints

- The automatic cycle is `independent review → fix → relevant tests → independent re-review`.
- Record `started_at` once and `deadline = started_at + 12 hours`; do not reset the deadline between waves.
- Check the deadline before every new fix wave. After the deadline, start no new fix; an already-running safe test or review may finish.
- Stop successfully only when mandatory tests pass and no actionable review finding remains.
- A timeout is not success and does not make the branch merge-ready.
- Do not merge, push, amend, publish, or rewrite history automatically.
- Add no production dependency and no database migration.
- Preserve browser manifest v2, accepted safe non-browser v1 compatibility, centralized evidence scanning, immutable S3 writes, and checksum-consistent replay verification.
- Use fixture mode only. Do not access live List-Org or FNS endpoints.
- Use owned PostgreSQL `5433` and MinIO `9000/9001`; never inspect, stop, reconfigure, or test against host PostgreSQL `5432`.
- Do not modify `CONTEXT.md`, `.playwright-cli/console-2026-08-21T09-16-39-068Z.log`, or `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`.
- Work only in `/Users/vvv/Проекты/АСТ Форум/.worktrees/okved-parser` on `codex/okved-parser`.
- Starting implementation HEAD is `385563c`; original branch merge base is `1a05e9d3a3c55a75d45798332c77584842e673f9`.
- Every production behavior change follows strict RED → GREEN TDD, with the intended pre-fix failure recorded in the active ledger.
- Keep historical review reports unchanged. Append a superseding ruling only to the active ledger.

---

### Task 1: Start and record the 12-hour automatic cycle

**Files:**

- Modify: `.superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/progress.md`
- Verify only: `docs/superpowers/specs/2026-08-25-automatic-fix-cycle-timebox-design.md`

**Interfaces:**

- Consumes: the approved timebox spec and the current `BLOCKED` ruling in the active ledger.
- Produces: immutable `started_at`, `deadline`, current cycle status, and a superseding ruling that authorizes repeated automatic waves.
- Preserves: all historical findings, reports, rulings, and their original timestamps.

- [ ] **Step 1: Verify the isolated branch and clean starting state**

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

Expected: top level is `/Users/vvv/Проекты/АСТ Форум/.worktrees/okved-parser`, branch is `codex/okved-parser`, HEAD is `385563c`, and status is clean.

- [ ] **Step 2: Generate the single cycle window**

Run:

```bash
node -e 'const startedAt=new Date(); const deadline=new Date(startedAt.getTime()+12*60*60*1000); process.stdout.write(`started_at=${startedAt.toISOString()}\ndeadline=${deadline.toISOString()}\n`)'
```

Expected: two UTC ISO-8601 timestamps exactly 12 hours apart. Copy them into the ledger; never recompute them for later waves.

- [ ] **Step 3: Append the superseding control ruling with `apply_patch`**

Append this block to the active ledger, substituting only the two timestamps from Step 2:

```markdown
Automatic fix cycle: ACTIVE.
Automatic fix cycle started_at: `<UTC timestamp from Step 2>`.
Automatic fix cycle deadline: `<UTC timestamp from Step 2>`.
Automatic-cycle Ruling: the approved 12-hour timebox spec at commit `385563c` supersedes the earlier one-final-fix-wave stop for this active cycle. Before the deadline, every confirmed actionable finding automatically starts another TDD fix and independent re-review. At or after the deadline, no new fix wave starts; a running safe verification may finish, then the controller records a timeout report. Historical reports remain unchanged — cost if wrong: the cycle may perform more review/fix work without another prompt, but it remains bounded by one immutable wall-clock deadline and never merges or publishes automatically.
Automatic fix cycle current target: close the Unicode normalized-offset leak and the hidden/visually separate text-node false overlay reported in `final-fix-rereview-report.md`.
```

Expected: the earlier ruling remains visible as history and the appended ruling unambiguously supersedes it for the active cycle.

- [ ] **Step 4: Verify the timebox record**

Run:

```bash
tail -12 .superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/progress.md
git status --short
```

Expected: the tail contains one `started_at`, one `deadline`, and the superseding ruling. The ignored SDD ledger does not create a tracked worktree change.

---

### Task 2: Map sensitive rendered text without Unicode or visibility ambiguity

**Files:**

- Modify: `src/apps/browser-runner/list-org-fixture-server.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- Modify: `test/unit/audience/browser-raw-sanitizer.test.ts`
- Modify: `test/integration/audience/list-org-browser-source.test.ts`
- Modify: `.superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/progress.md`

**Interfaces:**

- Consumes: `sanitizePageDom(page, sensitiveQueryParameters, redactLabeledValues, redactionValues)` and the current `BrowserSession.#capture` redaction-value list.
- Produces: `preparePageCapture(page, sensitiveQueryParameters, redactLabeledValues, redactionValues): Promise<{ sanitizedDomUtf8: Uint8Array; overlayCounts: Record<string, number> }>`.
- Internal browser-context unit: `preparePageArtifacts(page, options): Promise<{ html: string; counts: Record<string, number> }>` with `options.addOverlays` controlling screenshot mutation.
- Preserves: `sanitizePageDom` for page fingerprinting, `collectPageSensitiveUrlValues`, overlay marker `data-browser-capture-redaction`, label counts, form/contact masking, and final `assertBrowserCaptureSafe`.

- [ ] **Step 1: Add two deterministic fixture scenarios**

Beside `split-href-secret` in `list-org-fixture-server.ts`, add:

```ts
if (scenario === "unicode-split-href-secret" && companyKey === "1001") {
  body = body.replace(
    "</dl>",
    `<a href="https://localhost/public#foo">Public Unicode fragment</a>
     <p style="position:absolute;left:420px;top:220px;width:260px;height:32px;margin:0;background:#fff;font:24px monospace">İf<span>oo</span></p>
     </dl>`,
  );
}
if (scenario === "hidden-boundary-href-secret" && companyKey === "1001") {
  body = body.replace(
    "</dl>",
    `<a href="https://localhost/public#hidden-visible-secret">Public hidden-boundary fragment</a>
     <span style="display:none">hidden-</span><p style="position:absolute;left:420px;top:290px;width:260px;height:32px;margin:0;background:#fff">visible-secret</p>
     <p style="position:absolute;left:420px;top:350px;width:260px;height:32px;margin:0;background:#fff">Unrelated retained marker</p>
     </dl>`,
  );
}
```

The Unicode case places the lowercase expansion `İ → i̇` before the cross-node `foo`. The hidden case contains the complete known term only in raw concatenation; it never appears as one rendered occurrence.

- [ ] **Step 2: Write the failing real-browser regressions**

Add after the existing split-href test in `list-org-browser-source.test.ts`:

```ts
it("maps a Unicode-folded split term back to its original rendered container", async () => {
  const result = await collect("/search?scenario=unicode-split-href-secret");
  const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
  const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

  expect(result.status, result.reason).toBe("succeeded");
  expect(dom).not.toMatch(/İf(?:<[^>]+>)*oo/iu);
  expect(await isBlackPixel(card.redactedScreenshotPng, 420 + 250, 220 + 16)).toBe(true);
});

it("does not join hidden and separately rendered nodes into a page-wide redaction", async () => {
  const result = await collect("/search?scenario=hidden-boundary-href-secret");
  const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
  const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

  expect(result.status, result.reason).toBe("succeeded");
  expect(dom).toContain("Unrelated retained marker");
  expect(dom).toContain("visible-secret");
  expect(await isBlackPixel(card.redactedScreenshotPng, 760, 560)).toBe(false);
});
```

Add this adjacent server-side regression to `browser-raw-sanitizer.test.ts` so action metadata uses the same offset-safe semantics:

```ts
it("redacts after a length-changing Unicode fold without shifting original offsets", () => {
  expect(sanitizeBrowserActionTarget("İfoo", [], ["foo"])).toBe("İ[REDACTED]");
});
```

The first pixel is inside the fixed 260-pixel rendered container and is black only when the split occurrence produces an overlay. The second pixel is outside every legitimate contact/form/link overlay and becomes black under the current erroneous BODY mask.

- [ ] **Step 3: Run the focused integration file and record RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Expected: the Unicode action test returns a shifted/incorrect value; the Unicode screenshot test reports a non-black leaking-container pixel; the hidden-boundary test loses the retained marker and/or reports a black far-corner pixel. Append the exact command, failing assertion names, and failure reasons to the active ledger.

- [ ] **Step 4: Introduce original-offset-aware folding inside the browser evaluator**

In `browser-raw-sanitizer.ts`, make one browser-context artifact evaluator and define this mapping primitive inside its serialized callback:

```ts
type FoldedText = {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
};

function foldWithOriginalOffsets(value: string): FoldedText {
  let text = "";
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  for (let originalStart = 0; originalStart < value.length;) {
    const codePoint = value.codePointAt(originalStart);
    if (codePoint === undefined) break;
    const original = String.fromCodePoint(codePoint);
    const originalEnd = originalStart + original.length;
    const folded = original.toLocaleLowerCase("en-US");
    text += folded;
    for (let offset = 0; offset < folded.length; offset += 1) {
      originalStarts.push(originalStart);
      originalEnds.push(originalEnd);
    }
    originalStart = originalEnd;
  }
  return { text, originalStarts, originalEnds };
}

function originalMatchRanges(value: string, term: string): Array<{ start: number; end: number }> {
  const haystack = foldWithOriginalOffsets(value);
  const needle = foldWithOriginalOffsets(term).text;
  if (needle === "") return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  let index = haystack.text.indexOf(needle, searchFrom);
  while (index >= 0) {
    const lastFoldedOffset = index + needle.length - 1;
    const start = haystack.originalStarts[index];
    const end = haystack.originalEnds[lastFoldedOffset];
    if (start !== undefined && end !== undefined) ranges.push({ start, end });
    searchFrom = index + needle.length;
    index = haystack.text.indexOf(needle, searchFrom);
  }
  return ranges;
}
```

Define the same pure mapping at module scope for Node-side strings and use it in `replaceEveryCaseInsensitive`. Keep an evaluator-local copy because Playwright serializes the browser callback without Node closures. Use `originalMatchRanges` for every known-term replacement in the cloned DOM. Apply each term's ranges from right to left so earlier original offsets remain valid:

```ts
for (const { start, end } of originalMatchRanges(output, term).reverse()) {
  output = `${output.slice(0, start)}[REDACTED]${output.slice(end)}`;
}
```

This preserves case-insensitive matching without assuming that lowercasing preserves UTF-16 length.

- [ ] **Step 5: Build visible text segments with explicit layout boundaries**

Inside the same browser evaluator, walk `document.body` text nodes and retain a node only when all of these hold:

```ts
function renderedRects(node: Text): DOMRect[] {
  for (let element = node.parentElement; element !== null; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === "none"
      || style.visibility === "hidden"
      || style.visibility === "collapse"
      || style.contentVisibility === "hidden"
      || Number(style.opacity) === 0) return [];
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
}
```

Assign each retained node to its nearest rendered flow root: stop at the first ancestor whose computed `display` is neither `inline` nor `contents`, or whose `position` is `absolute`/`fixed`; fall back to `document.body`. Start a new segment when the flow root changes, when a rendered `<br>`/`<hr>` lies between adjacent nodes, when same-line boxes have more than 2 CSS pixels of horizontal separation, or when consecutive boxes have more than 4 CSS pixels of vertical separation.

Each segment stores exact original offsets:

```ts
type RenderedTextEntry = { node: Text; start: number; end: number; rects: DOMRect[] };
type RenderedTextSegment = { root: HTMLElement; text: string; entries: RenderedTextEntry[] };
```

For each `originalMatchRanges(segment.text, term)` result, resolve the first and last entries by original offsets. Ignore no range silently: a missing endpoint throws `Error("rendered sensitive range mapping failed")` so capture fails closed.

- [ ] **Step 6: Use the same occurrence model for DOM and screenshot artifacts**

Refactor the current two page evaluations into:

```ts
type PreparedPageCapture = {
  sanitizedDomUtf8: Uint8Array;
  overlayCounts: Record<string, number>;
};

export async function preparePageCapture(
  page: Page,
  sensitiveQueryParameters: readonly string[],
  redactLabeledValues: readonly string[],
  redactionValues: readonly string[],
): Promise<PreparedPageCapture>;
```

The internal `preparePageArtifacts` evaluator must perform these operations in one browser JavaScript task:

1. collect rendered sensitive occurrences from the live DOM;
2. create the unsanitized clone before adding overlays;
3. map each cross-node occurrence's smallest common ancestor to the corresponding cloned element using the pre-sanitization element-order index, then replace only that cloned container with `[REDACTED]`;
4. run the existing allowlist, form, attribute, per-text-node contact, and URL sanitization over the clone;
5. add each real occurrence's smallest rendered containing element to the screenshot overlay set;
6. retain the existing label, attribute, contact, and populated-control overlay rules;
7. add overlay elements only when `addOverlays` is true;
8. return sanitized HTML and label counts.

Remove the separator-free whole-subtree `textContent` loop and the separator-free raw `document.body` text stream. Do not overlay `BODY` unless a real rendered occurrence consists of direct visible BODY text whose endpoints both map to BODY.

Keep `sanitizePageDom` as a wrapper over `preparePageArtifacts(..., { addOverlays: false })` for `fingerprint()`. In `BrowserSession.#capture`, replace the separate calls with:

```ts
const { sanitizedDomUtf8, overlayCounts } = await preparePageCapture(
  this.#page,
  this.#sensitiveQueryParameters,
  redactLabeledValues,
  redactionValues,
);
```

Use `overlayCounts` in the existing `requireEveryLabel` check. Keep the existing screenshot `try/finally` removal of `[data-browser-capture-redaction]` nodes.

- [ ] **Step 7: Run focused GREEN and regression gates**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/integration/audience/list-org-browser-source.test.ts
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
npm run build
git diff --check
```

Expected: both new regressions pass; existing ASCII split/non-anchor href, contact/form overlay, canonical URL, S3 verification, and build checks remain green.

- [ ] **Step 8: Commit the browser correction**

Run:

```bash
git add -- src/apps/browser-runner/list-org-fixture-server.ts src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts
git commit -m "fix: map rendered browser redactions safely"
```

Expected: exactly the five intended tracked files are committed. Append the commit, RED evidence, GREEN counts, and self-review result to the active ledger.

---

### Task 3: Run acceptance and the deadline-bounded review/fix loop

**Files:**

- Modify during later waves only when a confirmed finding requires it: files named by that finding and their focused tests.
- Modify: `.superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/progress.md`
- Create per wave: `.superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/automatic-fix-wave-<N>-report.md`
- Create per review: `.superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/automatic-fix-wave-<N>-review.md`
- Verify only: `migrations/*.sql`, `compose.yaml`, `deployment/okved-parser/postgres-5433.compose.yaml`, protected files, and the complete branch diff.

**Interfaces:**

- Consumes: the immutable Task 1 deadline, the Task 2 commit, full repository acceptance commands, and independent reviewer findings.
- Produces on success: clean acceptance evidence plus a review with no actionable finding.
- Produces on timeout: a non-success report containing elapsed time, completed commits, last test state, remaining findings by severity, and the safe next step.
- Preserves: owned service volumes, fixture-only operation, user control over merge/push/publication, and every historical report.

- [ ] **Step 1: Check the deadline before starting acceptance**

Run:

```bash
date -u '+now=%Y-%m-%dT%H:%M:%SZ'
tail -12 .superpowers/sdd/2026-08-25-okved-parser-residual-input-hardening/progress.md
```

Expected: `now` is earlier than the recorded deadline. If it is not, skip to Step 8 and record timeout without starting another mutating wave.

- [ ] **Step 2: Start only owned fixture services and verify bindings**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
node --version
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps
docker ps --format '{{.Names}}\t{{.Ports}}' | rg 'okved-parser|5433|9000|9001'
```

Expected: Node is `v24.x`; owned PostgreSQL is exposed only on `127.0.0.1:5433`; MinIO uses `9000/9001`; host `5432` is untouched.

- [ ] **Step 3: Verify migration reversibility on owned PostgreSQL**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: both commands exit `0`; no migration was added or edited by this plan.

- [ ] **Step 4: Run complete fixture acceptance**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts
npm run build
git diff --check 1a05e9d3a3c55a75d45798332c77584842e673f9..HEAD
```

Expected: full suite, dedicated e2e, build, and diff check all pass. Record exact file/test counts and exit results in the wave report.

- [ ] **Step 5: Audit protected and operational boundaries**

Run:

```bash
git diff --exit-code 385563c..HEAD -- migrations compose.yaml deployment/okved-parser/postgres-5433.compose.yaml CONTEXT.md .playwright-cli/console-2026-08-21T09-16-39-068Z.log docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
rg -n 'APP_MODE|LIST_ORG_LIVE_ENABLED|5432|5433|list-org.com|nalog.gov.ru' src test compose.yaml deployment/okved-parser/postgres-5433.compose.yaml
git status --short
```

Expected: protected diff is empty; the new code adds no live-source call or `5432` binding; status is clean after committing the implementation.

- [ ] **Step 6: Run an independent review and classify every result**

Freeze the complete branch diff from merge base through current HEAD and request an independent review against both the parser specs and the timebox spec. The review must separately report `Critical`, `Important`, and `Minor`, state whether the two original findings are addressed, inspect for new breakage, and identify each actionable item with an exact file/location and reproduction.

Expected: either no actionable finding remains, or the report contains enough evidence to write a failing test before changing production code. Append the verdict to the active ledger.

- [ ] **Step 7: Automatically repeat confirmed fix waves before the deadline**

For every review with an actionable finding:

1. read the immutable deadline from the ledger and run `date -u '+now=%Y-%m-%dT%H:%M:%SZ'`;
2. if `now` is earlier than the deadline, start the next numbered wave without asking the user;
3. reproduce each accepted finding with a focused failing test and record RED;
4. implement the smallest correction, run focused GREEN, run all gates from Steps 3–5, and commit once;
5. request a fresh independent re-review of the fix plus adjacent regression risk;
6. return to item 1 until no actionable finding remains.

Do not dismiss a technically incorrect finding by deference: record the evidence and ruling. Do not fix an unconfirmed suggestion. Do not reset `started_at` or `deadline`.

Expected: the loop has only two terminal states: clean review with passing acceptance, or deadline stop.

- [ ] **Step 8: Write the terminal report**

On clean success, append:

```markdown
Automatic fix cycle: COMPLETE before deadline.
Final commit: `<current HEAD>`.
Acceptance: `<exact full/e2e/build/migration results>`.
Independent review: no actionable findings remain.
Branch status: verified and ready for the user's integration decision; no merge or push performed.
```

On deadline, append:

```markdown
Automatic fix cycle: TIMED OUT; not complete and not merge-ready.
Elapsed window: `<started_at>` through `<deadline>`; final safe command completed at `<timestamp>`.
Completed commits: `<ordered commit list>`.
Last acceptance state: `<exact passing/failing commands and counts>`.
Remaining findings: `<severity, location, reproduction, and impact for each>`.
Safe next step: resume from current clean commit under a new explicit timebox or accept the documented risk.
```

Expected: the terminal state is explicit and contains no unsupported completion claim.

- [ ] **Step 9: Stop owned services without deleting volumes**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml down
docker ps --format '{{.Names}}\t{{.Ports}}' | rg 'okved-parser|5433|9000|9001' || true
docker volume ls --format '{{.Name}}' | rg '^okved-parser_(postgres_data|minio_data)$'
```

Expected: owned containers are stopped; `okved-parser_postgres_data` and `okved-parser_minio_data` remain; no `down -v` is used.
