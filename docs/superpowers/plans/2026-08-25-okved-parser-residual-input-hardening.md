# OKVED Parser Residual Input Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two independently reproduced browser-evidence and CSV-validation bypasses so the OKVED parser branch can pass a clean whole-branch review.

**Architecture:** Browser capture derives one redaction-value set from the current page plus every live retained DOM link, then reuses it for DOM, screenshot, and centralized evidence verification. Replay accepts only canonical serialized entities and rejects every ambiguous ampersand form before URL parsing. The selected-OKVED CSV parser uses an explicit three-state grammar and continues to validate exact bytes before S3/DB publication.

**Tech Stack:** TypeScript 7, Node.js 24, Playwright 1.62, Vitest 4, PostgreSQL 5433, MinIO/S3 9000/9001, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-25-okved-parser-residual-input-hardening-design.md`

## Global Constraints

- Add no production dependency.
- Keep browser evidence manifest v2 and the accepted safe non-browser v1 compatibility shapes unchanged.
- Preserve centralized browser evidence scanning, canonical UUID action IDs, compact-phone redaction, immutable S3 writes, and checksum-consistent replay verification.
- Keep the OKVED object write allowed before the database transaction, but publish release metadata and OKVED rows only after exact byte validation and inside the existing shared database transaction.
- Use fixture mode only. Do not access live List-Org or FNS endpoints.
- Use owned PostgreSQL `5433` and MinIO `9000/9001`; never use host PostgreSQL `5432`.
- Do not add a database migration.
- Do not modify `CONTEXT.md`, `.playwright-cli/console-2026-08-21T09-16-39-068Z.log`, or `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`.
- Work only in `/Users/vvv/Проекты/АСТ Форум/.worktrees/okved-parser` on `codex/okved-parser`; do not merge, push, amend, or rewrite earlier commits.
- Starting implementation HEAD is `95e08fc` and the original branch merge base is `1a05e9d3a3c55a75d45798332c77584842e673f9`.
- Every production behavior change follows strict RED → GREEN TDD with the expected failure recorded before implementation.

---

### Task 1: Close browser URL-derived redaction and replay canonicalization

**Files:**

- Modify: `src/apps/browser-runner/list-org-fixture-server.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts`
- Modify: `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- Modify: `test/unit/audience/browser-raw-sanitizer.test.ts`
- Modify: `test/integration/audience/list-org-browser-source.test.ts`
- Modify: `test/integration/audience/s3-raw-object-storage.test.ts`

**Interfaces:**

- Consumes: `sensitiveBrowserUrlValues(value: string, sensitiveQueryParameters: readonly string[]): readonly string[]` and `BrowserSession.#capture`.
- Produces: `collectPageSensitiveUrlValues(page: Page, sensitiveQueryParameters: readonly string[]): Promise<readonly string[]>`.
- Preserves: `sanitizeBrowserUrl`, `sanitizeBrowserActionTarget`, `assertBrowserCaptureSafe`, `checksumBrowserRawBundle`, manifest v2, and exact v1 compatibility.

- [ ] **Step 1: Start only the owned fixture services**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml up -d --wait postgres minio
```

Expected: PostgreSQL is healthy on `127.0.0.1:5433`, MinIO is healthy on `127.0.0.1:9000`, and no command connects to `5432`.

- [ ] **Step 2: Add a fixture whose secrets exist only in a DOM href**

Add a `href-only-url-secrets` company-page branch beside `unsafe-url-components` in `list-org-fixture-server.ts`:

```ts
if (scenario === "href-only-url-secrets" && companyKey === "1001") {
  body = body.replace(
    "</dl>",
    `<a href="https://href-user:href-pass@localhost/public?token=href-query-secret#href-fragment-secret">Public</a>
     <p style="display:block;width:260px;height:24px">href-user</p>
     <p style="display:block;width:260px;height:24px">href-pass</p>
     <p style="display:block;width:260px;height:24px">href-query-secret</p>
     <p style="display:block;width:260px;height:24px">href-fragment-secret</p>
     </dl>`,
  );
}
```

The four values must occur only in this response body. No navigation, request, action, or candidate website may contain them, otherwise an existing redaction source could make the test pass accidentally.

- [ ] **Step 3: Write the failing capture test**

Add to `list-org-browser-source.test.ts`:

```ts
it("derives DOM and screenshot redaction terms from every live retained href", async () => {
  const [result, baseline] = await Promise.all([
    collect("/search?scenario=href-only-url-secrets"),
    collect("/search"),
  ]);
  const card = result.rawBundles.find((item) => item.identity.sourceRecordKey === "1001")!;
  const baselineCard = baseline.rawBundles.find(
    (item) => item.identity.sourceRecordKey === "1001",
  )!;
  const dom = new TextDecoder().decode(card.sanitizedDomUtf8);

  expect(dom).toContain('href="https://localhost/public"');
  expect(dom).not.toMatch(/href-user|href-pass|href-query-secret|href-fragment-secret/);
  expect(await countBlackContactBands(card.redactedScreenshotPng)).toBeGreaterThanOrEqual(
    (await countBlackContactBands(baselineCard.redactedScreenshotPng)) + 4,
  );
});
```

This catches a missing DOM-href collection step: sanitizing the attribute alone is insufficient because duplicated visible text and screenshot regions must also be redacted.

- [ ] **Step 4: Write failing replay tests for named and ambiguous entities**

Add to `browser-raw-sanitizer.test.ts`:

```ts
it.each([
  ["named fragment", "https://fixture.invalid/public&num;href-fragment-secret"],
  ["semicolonless named-like form", "https://fixture.invalid/public&num"],
  ["named userinfo", "https://href-user&commat;localhost/public"],
  ["unknown name", "https://fixture.invalid/public&unknown;value"],
  ["raw ambiguous ampersand", "https://fixture.invalid/public?a=1&next=2"],
])("rejects a noncanonical serialized DOM href with %s", (_case, href) => {
  expect(() => checksumBrowserRawBundle(rawBundle(
    `<!doctype html><html><body><a href="${href}">Public</a></body></html>`,
  ))).toThrow("raw redaction scan failed");
});

it.each([
  "https://fixture.invalid/public?a=1&amp;next=2",
  "https://fixture.invalid/public/a&amp;b",
  "https://fixture.invalid/public/a&quot;b",
  "https://fixture.invalid/public/a&apos;b",
  "https://fixture.invalid/public/a&#38;b",
])("accepts a canonical serialized DOM href %s", (href) => {
  expect(() => checksumBrowserRawBundle(rawBundle(
    `<!doctype html><html><body><a href="${href}">Public</a></body></html>`,
  ))).not.toThrow();
});
```

Extend the checksum-consistent DOM-href table in `s3-raw-object-storage.test.ts` with:

```ts
["named fragment", "https://fixture.invalid/public&num;href-fragment-secret"],
["named userinfo", "https://href-user&commat;localhost/public"],
```

Reuse `putChecksumConsistentBrowserManifest` and assert `S3RawObjectStorage.verify` rejects with `raw redaction scan failed`.

- [ ] **Step 5: Run the URL tests and capture RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
```

Expected: the new capture test fails because at least one `href-*` value survives DOM/screenshot capture; named/ambiguous entity tests fail because checksum/S3 verification accepts them. Pre-existing cases remain green.

- [ ] **Step 6: Implement live page URL-value collection**

Add to `browser-raw-sanitizer.ts`:

```ts
export async function collectPageSensitiveUrlValues(
  page: Page,
  sensitiveQueryParameters: readonly string[],
): Promise<readonly string[]> {
  const urls = await page.evaluate(() => {
    const resolved = [window.location.href];
    for (const element of document.querySelectorAll("a[href]")) {
      const href = element.getAttribute("href");
      if (href === null || /^(?:mailto|tel):/iu.test(href)) continue;
      try {
        resolved.push(new URL(href, document.baseURI).toString());
      } catch {
        // sanitizePageDom removes the corresponding unverifiable attribute.
      }
    }
    return resolved;
  });

  return [...new Set(urls.flatMap(
    (url) => sensitiveBrowserUrlValues(url, sensitiveQueryParameters),
  ))];
}
```

In `BrowserSession.#capture`, collect these values before either artifact is produced:

```ts
const pageUrlValues = await collectPageSensitiveUrlValues(
  this.#page,
  this.#sensitiveQueryParameters,
);
const redactionValues = [...new Set([
  ...this.#sensitiveValues,
  ...labeledValues,
  ...pageUrlValues,
])];
```

Pass this exact list to `sanitizePageDom`, `addPageRedactionOverlays`, and `assertBrowserCaptureSafe`.

- [ ] **Step 7: Implement fail-closed canonical entity decoding**

Replace the partial decoder with this complete fail-closed implementation:

```ts
function decodeHtmlUrlAttribute(value: string): string | null {
  const canonicalEntity = /&(?:amp|quot|apos|#(?:[xX][0-9a-fA-F]+|[0-9]+));/gu;
  if (value.replace(canonicalEntity, "").includes("&")) return null;

  let invalidNumericReference = false;
  const decoded = value.replace(canonicalEntity, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return "\"";
    if (entity === "&apos;") return "'";
    const hexadecimal = entity.startsWith("&#x") || entity.startsWith("&#X");
    const numeric = Number.parseInt(
      entity.slice(hexadecimal ? 3 : 2, -1),
      hexadecimal ? 16 : 10,
    );
    if (!Number.isInteger(numeric)
      || numeric < 0
      || numeric > 0x10ffff
      || (numeric >= 0xd800 && numeric <= 0xdfff)) {
      invalidNumericReference = true;
      return "";
    }
    return String.fromCodePoint(numeric);
  });
  return invalidNumericReference ? null : decoded;
}
```

Make `containsUnsafeSerializedHref` treat `null` as unsafe before `assertRetainedBrowserUrlSafe`. Do not add more named entities: only exact lowercase `amp`, `quot`, `apos`, and valid decimal/hex numeric references are canonical.

- [ ] **Step 8: Run focused GREEN, build, and commit**

Run the exact test command from Step 5, then:

```bash
npm run build
git diff --check
git add src/apps/browser-runner/list-org-fixture-server.ts src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer.ts src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
git commit -m "fix: close browser URL canonicalization gaps"
```

Expected: all URL tests pass, including UUID and compact-phone regressions; build and diff check pass; the commit contains only Task 1 files.

---

### Task 2: Enforce strict selected-OKVED CSV grammar before publication

**Files:**

- Create: `test/unit/audience/import-selected-okveds.test.ts`
- Modify: `src/modules/audience/application/import-selected-okveds.ts`
- Modify: `test/integration/audience/okved-release.test.ts`

**Interfaces:**

- Consumes and preserves: `parseSelectedOkvedsCsv(csv: string, expectedSourceVersion?: string): readonly Omit<OkvedRecord, "datasetReleaseId">[]`.
- Preserves: exact header, non-empty dataset, three columns, `parseOkvedCode`, non-empty name/source version, exact requested `source_version`, pre-S3 validation, and atomic DB publication.

- [ ] **Step 1: Write failing unit tests for invalid grammar transitions**

Create `test/unit/audience/import-selected-okveds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSelectedOkvedsCsv } from "../../../src/modules/audience/application/import-selected-okveds";

const header = "code,name,source_version\n";

describe("parseSelectedOkvedsCsv strict grammar", () => {
  it.each([
    ["text after closing quote", `${header}43.11,"Разборка"x,v1\n`],
    ["space after closing quote", `${header}43.11,"Разборка" ,v1\n`],
    ["bare quote in unquoted field", `${header}43.11,Раз"борка,v1\n`],
    ["unterminated quoted field", `${header}43.11,"Разборка,v1\n`],
    ["lone carriage return", `${header}43.11,Разборка,v1\r`],
  ])("rejects %s", (_case, csv) => {
    expect(() => parseSelectedOkvedsCsv(csv, "v1")).toThrow("selected OKVED CSV");
  });

  it.each([
    ["escaped quote with LF", `${header}43.11,"Разборка ""Альфа""",v1\n`, "Разборка \"Альфа\""],
    ["CRLF", "code,name,source_version\r\n43.11,Разборка,v1\r\n", "Разборка"],
    ["quoted CRLF content", `${header}43.11,"Разборка\r\nстроения",v1\n`, "Разборка\r\nстроения"],
    ["quoted final field at EOF", `${header}43.11,Разборка,"v1"`, "Разборка"],
  ])("accepts %s", (_case, csv, expectedName) => {
    expect(parseSelectedOkvedsCsv(csv, "v1")).toEqual([
      { code: "43.11", name: expectedName, sourceVersion: "v1" },
    ]);
  });
});
```

- [ ] **Step 2: Add the executable poisoning and corrected-retry regression**

Inside the existing malformed executable test in `okved-release.test.ts`, add:

```ts
const quotedJunkPath = join(directory, "quoted-junk.csv");
await writeFile(
  quotedJunkPath,
  `code,name,source_version\n43.11,"Разборка"x,${executableSourceVersion}\n`,
  "utf8",
);
const quotedJunk = runOkvedReleaseCli(quotedJunkPath, isolated.connectionString, env);
expect(quotedJunk.status, `${quotedJunk.stdout}\n${quotedJunk.stderr}`).toBe(1);
await expect(publicationTableCounts(isolated.connectionString)).resolves.toEqual({
  crawlRuns: 0,
  sourceFetches: 0,
  datasetReleases: 0,
  okveds: 0,
});
```

Then run the CLI with corrected bytes for the same requested source version and assert:

```ts
const correctedPath = join(directory, "corrected-after-quoted-junk.csv");
await writeFile(
  correctedPath,
  `code,name,source_version\n43.11,Разборка и снос зданий,${executableSourceVersion}\n`,
  "utf8",
);
const corrected = runOkvedReleaseCli(correctedPath, isolated.connectionString, env);
expect(corrected.status, `${corrected.stdout}\n${corrected.stderr}`).toBe(0);
expect(JSON.parse(corrected.stdout)).toMatchObject({
  ok: true,
  result: { reused: false, imported: 1 },
});
await expect(publicationTableCounts(isolated.connectionString)).resolves.toEqual({
  crawlRuns: 1,
  sourceFetches: 1,
  datasetReleases: 1,
  okveds: 1,
});
```

- [ ] **Step 3: Run the CSV tests and capture RED**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/import-selected-okveds.test.ts test/integration/audience/okved-release.test.ts
```

Expected: text/space after a closing quote and the trailing lone-CR cases fail because current parsing accepts them; the executable quoted-junk case fails because it publishes a release/OKVED row and blocks corrected retry. Existing bare-quote/unterminated rejection, positive grammar, and previous release tests remain green.

- [ ] **Step 4: Replace the quoted boolean with a strict state machine**

Replace `parseCsv` with this explicit state-machine shape; retain the final blank-row filter shown at the end:

```ts
type CsvState = "unquoted" | "quoted" | "afterQuote";

const rows: string[][] = [];
let row: string[] = [];
let field = "";
let state: CsvState = "unquoted";
const finishField = () => {
  row.push(field);
  field = "";
};
const finishRow = () => {
  finishField();
  rows.push(row);
  row = [];
  state = "unquoted";
};

for (let index = 0; index < csv.length; index += 1) {
  const character = csv[index]!;

  if (state === "quoted") {
    if (character === '"') {
      if (csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        state = "afterQuote";
      }
    } else if (character === "\r") {
      if (csv[index + 1] !== "\n") {
        throw new Error("selected OKVED CSV has an invalid carriage return");
      }
      field += "\r\n";
      index += 1;
    } else {
      field += character;
    }
    continue;
  }

  if (state === "afterQuote") {
    if (character === ",") {
      finishField();
      state = "unquoted";
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r" && csv[index + 1] === "\n") {
      finishRow();
      index += 1;
    } else {
      throw new Error("selected OKVED CSV has text after a closing quote");
    }
    continue;
  }

  if (character === '"') {
    if (field !== "") {
      throw new Error("selected OKVED CSV has an invalid quoted field");
    }
    state = "quoted";
  } else if (character === ",") {
    finishField();
  } else if (character === "\n") {
    finishRow();
  } else if (character === "\r" && csv[index + 1] === "\n") {
    finishRow();
    index += 1;
  } else if (character === "\r") {
    throw new Error("selected OKVED CSV has an invalid carriage return");
  } else {
    field += character;
  }
}

if (state === "quoted") {
  throw new Error("selected OKVED CSV has an unterminated quoted field");
}
if (state === "afterQuote" || field !== "" || row.length > 0) {
  finishRow();
}

return rows.filter((parsedRow) => parsedRow.some((value) => value !== ""));
```

Keep all `parseSelectedOkvedsCsv` semantic validation unchanged. Do not modify publication repositories.

- [ ] **Step 5: Run focused GREEN and adjacent import regressions**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/unit/audience/import-selected-okveds.test.ts test/integration/audience/import-selected-okveds.test.ts test/integration/audience/okved-release.test.ts
```

Expected: invalid transitions reject before publication; escaped quotes, LF, CRLF, and quoted EOF pass; quoted-junk leaves all four tables empty; corrected retry succeeds; adjacent import behavior remains green.

- [ ] **Step 6: Build and commit Task 2**

Run:

```bash
npm run build
git diff --check
git add src/modules/audience/application/import-selected-okveds.ts test/unit/audience/import-selected-okveds.test.ts test/integration/audience/okved-release.test.ts
git commit -m "fix: reject malformed selected OKVED CSV"
```

Expected: build and diff check pass; the commit contains only Task 2 files.

---

### Task 3: Run final fixture acceptance and repository-boundary audit

**Files:**

- Verify only: `migrations/*.sql`, `test/e2e/audience-parser.e2e.test.ts`, and the full repository.
- Report only: the plan-owned SDD workspace; do not create an empty code commit.

**Interfaces:**

- Consumes: committed Task 1 and Task 2 behavior.
- Produces: fresh acceptance evidence for whole-branch review and finishing.

- [ ] **Step 1: Confirm runtime and owned service boundaries**

Run:

```bash
node --version
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml ps
docker ps --format '{{.Names}}\t{{.Ports}}' | rg 'okved-parser|5433|9000|9001'
```

Expected: Node is `v24.x`; owned services expose only PostgreSQL `5433` and MinIO `9000/9001`. Do not inspect or mutate the unrelated host service on `5432`.

- [ ] **Step 2: Replay the latest migration down/up on 5433**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:down
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved npm run migrate:up
```

Expected: both commands succeed. This plan adds no migration.

- [ ] **Step 3: Run full fixture and dedicated e2e gates**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved TEST_DATABASE_ADMIN_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/postgres S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm test -- test/e2e/audience-parser.e2e.test.ts
npm run build
```

Expected: full suite passes; dedicated e2e passes 10/10 or more if intentionally extended; build exits `0`; no live-source access occurs.

- [ ] **Step 4: Audit repository boundaries and protected files**

Run:

```bash
git diff --check 95e08fc..HEAD
git diff --exit-code 95e08fc..HEAD -- migrations compose.yaml deployment/okved-parser/postgres-5433.compose.yaml CONTEXT.md .playwright-cli/console-2026-08-21T09-16-39-068Z.log docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
git status --short
rg -n 'APP_MODE|LIST_ORG_LIVE_ENABLED|5432|5433|list-org.com|nalog.gov.ru' src test compose.yaml deployment/okved-parser/postgres-5433.compose.yaml
```

Expected: diff check is clean; migrations, compose, and protected files have no task diff; worktree is clean; fixture gates remain explicit; no new live-source call or `5432` test binding exists.

- [ ] **Step 5: Stop owned services without deleting volumes**

Run:

```bash
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false docker compose -p okved-parser -f compose.yaml -f deployment/okved-parser/postgres-5433.compose.yaml down
docker ps --format '{{.Names}}\t{{.Ports}}' | rg 'okved-parser|5433|9000|9001' || true
docker volume ls --format '{{.Name}}' | rg '^okved-parser_(postgres_data|minio_data)$'
```

Expected: no owned container remains and both named volumes remain. Never add `-v`.

- [ ] **Step 6: Record acceptance without an empty commit**

Write exact commands and summarized counts to the plan-owned SDD report, confirm `git status --short` is empty, and do not create a Task 3 code commit.

---

## Final review requirements

Generate a whole-branch review package from original merge base `1a05e9d3a3c55a75d45798332c77584842e673f9` to `HEAD`. Give the reviewer this plan, the binding spec, ledger, Task 1–3 reports, and full diff. It must explicitly verify:

1. a value introduced only by a live DOM `href` cannot survive DOM or screenshot capture;
2. checksum-consistent replay rejects named, semicolonless, and ambiguous entity forms while accepting canonical serializer output;
3. invalid text after a closing CSV quote publishes none of the four DB row categories and corrected retry succeeds;
4. UUID/phone scanning, exact manifest compatibility, immutable release reuse, discovery reconciliation, and fixture gates do not regress.

If the whole-branch review reports findings, use the single final-fix wave and one scoped re-review permitted by `superpowers:subagent-driven-development`. Do not merge or push without separate user authorization.
