# OKVED Parser First Executable Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible local parser slice that discovers legal entities by one OKVED code through a visible fixture browser flow, stores immutable raw evidence, publishes idempotent organization data, and maps `revenue`, `income`, and `expenses` from financial fixtures.

**Architecture:** A TypeScript modular monolith owns the PostgreSQL `audience` schema. Application use cases depend on ports for browser sessions, object storage, repositories, clock, and jobs; Playwright, PostgreSQL, S3-compatible storage, and pg-boss are infrastructure adapters. Browser discovery and financial enrichment produce immutable evidence first, then a transactionally published read model. Live List-Org and live BFO access remain disabled until their source-policy gates are approved.

**Tech Stack:** Node.js 24 LTS, TypeScript 7.0.2, Vitest 4.1.11, Playwright 1.62.1, PostgreSQL via `pg` 8.23.0, node-pg-migrate 9.0.0, pg-boss 12.28.0, `saxes` 6.0.0, AWS S3 client 3.1116.0, Docker Compose.

## Global Constraints

- Implement only legal entities with validated 10-digit INN. Do not generalize the database key to IP/INN-12 in this slice.
- Never call live List-Org or BFO from tests, local acceptance, or CI. Fixture browser traffic must be origin-allowlisted and all unmatched requests must fail.
- Do not add Excel/bulk endpoints, direct HTTP crawling, hidden API access, CAPTCHA solving, identity spoofing, proxy rotation, or blocked-run resume.
- Store monetary values as canonical decimal strings in TypeScript and `numeric(18,2)` in PostgreSQL. Never convert financial values through JavaScript `number`.
- `revenue ← БФО Ф2.2110`; `income ← ФНС revexp СумДоход`; `expenses ← ФНС revexp СумРасход`.
- `NULL` means that no value was published. The string `"0.00"` is a real observed zero and must have evidence.
- Use parameterized SQL only. The `audience` module is the sole owner of the `audience` schema.
- Use one ephemeral Playwright context per run. Do not persist cookies, local storage, or browser profiles.
- Every domain row published from a source must be traceable to a `source_fetches.checksum_sha256` and parser version.

---

### Task 1: Scaffold the Node runtime and deterministic local services

**Files:**

- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `compose.yaml`
- Create: `src/shared/config/env.ts`
- Create: `test/unit/shared/config/env.test.ts`

**Interfaces:**

- Consumes: `NodeJS.ProcessEnv` from each CLI/worker entry point.
- Produces: `parseEnv(input: NodeJS.ProcessEnv): AppEnv`, where `AppEnv` contains the validated database, S3, app-mode, and live-source-gate settings used by Tasks 2, 4, and 6.

- [ ] **Step 1: Write the failing environment contract test**

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../../src/shared/config/env";

describe("parseEnv", () => {
  it("rejects a live source in the fixture runtime", () => {
    expect(() => parseEnv({ APP_MODE: "fixture", LIST_ORG_LIVE_ENABLED: "true" }))
      .toThrow("live List-Org is forbidden in fixture mode");
  });

  it("requires PostgreSQL and S3 coordinates", () => {
    expect(() => parseEnv({ APP_MODE: "fixture" })).toThrow("DATABASE_URL");
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run: `npm test -- test/unit/shared/config/env.test.ts`

Expected: FAIL because `package.json` and `src/shared/config/env.ts` do not exist.

- [ ] **Step 3: Create the pinned package manifest and compiler/test configuration**

Use these direct dependencies:

```json
{
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration --no-file-parallelism",
    "migrate:up": "node-pg-migrate up --migrations-dir migrations",
    "migrate:down": "node-pg-migrate down --migrations-dir migrations --count 1",
    "audience": "tsx src/apps/browser-runner/main.ts",
    "worker": "tsx src/apps/worker/main.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1116.0",
    "pg": "8.23.0",
    "pg-boss": "12.28.0",
    "playwright": "1.62.1",
    "saxes": "6.0.0"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@types/pg": "8.23.1",
    "tsx": "4.23.12",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

Generate `package-lock.json` with `npm install`, then install the matching Chromium once with `npx playwright install chromium`.

- [ ] **Step 4: Implement strict environment parsing**

Expose `parseEnv(input: NodeJS.ProcessEnv): AppEnv`. Require `APP_MODE`, `DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Accept `APP_MODE=fixture|live`; default `LIST_ORG_LIVE_ENABLED` to false; reject `APP_MODE=fixture` with live access enabled. `TEST_DATABASE_ADMIN_URL` is test-only and must never be used by an application entry point.

- [ ] **Step 5: Define local services without starting live collectors**

`compose.yaml` must use `postgres:17.6-alpine` and `minio/minio:RELEASE.2025-09-07T16-13-09Z`, with health checks, named volumes, and no browser service. Bind PostgreSQL to `127.0.0.1:5432` and MinIO/API to loopback only. Put example credentials only in `.env.example`; ignore `.env`, raw output, Playwright state, and test reports.

- [ ] **Step 6: Run unit tests and compiler**

Run: `npm test -- test/unit/shared/config/env.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example package.json package-lock.json tsconfig.json vitest.config.ts compose.yaml src/shared/config/env.ts test/unit/shared/config/env.test.ts
git commit -m "build: scaffold OKVED parser runtime"
```

---

### Task 2: Create the owned PostgreSQL schema and migration contract

**Files:**

- Create: `migrations/001_audience_core.js`
- Create: `migrations/sql/001_audience_core.up.sql`
- Create: `migrations/sql/001_audience_core.down.sql`
- Create: `src/shared/postgres/database.ts`
- Create: `test/integration/postgres/migration.test.ts`
- Create: `test/support/postgres.ts`

**Interfaces:**

- Consumes: `AppEnv.databaseUrl` at runtime and the test-only administrative URL from Task 1.
- Produces: `Database.query<T>(text, values)` and `Database.transaction<T>(work)`, plus the `audience` tables consumed by repository adapters in Tasks 3 and 6.

- [ ] **Step 1: Write a failing migration integration test**

The test must create a unique temporary database, run migration up, inspect `information_schema` and `pg_constraint`, run migration down, and drop the temporary database in `afterAll`.

```ts
expect(await tableNames(client, "audience")).toEqual(expect.arrayContaining([
  "crawl_runs", "crawl_tasks", "source_fetches", "dataset_releases",
  "companies", "okveds", "company_okveds", "run_company_matches",
  "organization_evidence", "financial_evidence", "financial_observations"
]));
expect(await primaryKey(client, "audience", "company_okveds"))
  .toEqual(["company_inn", "okved_code"]);
```

- [ ] **Step 2: Run the integration test and confirm failure**

Run: `docker compose up -d postgres && npm run test:integration -- test/integration/postgres/migration.test.ts`

Expected: FAIL because the migration files do not exist.

- [ ] **Step 3: Implement grouped SQL migration wrappers**

`migrations/001_audience_core.js` must read the adjacent up/down SQL files and pass their full contents to `pgm.sql`. The up migration must create schema `audience`, enum/check constraints, and the eleven approved tables.

Required natural keys and constraints:

```sql
companies               PRIMARY KEY (inn), CHECK (inn ~ '^[0-9]{10}$')
okveds                   PRIMARY KEY (code)
company_okveds           PRIMARY KEY (company_inn, okved_code)
run_company_matches      PRIMARY KEY (run_id, company_inn, matched_okved_code)
financial_observations   PRIMARY KEY (company_inn, report_year)
source_fetches           UNIQUE (run_id, source_kind, source_record_key, checksum_sha256)
financial_evidence       UNIQUE (company_inn, report_year, metric, source_fetch_id, source_record_key)
```

`crawl_runs` stores immutable scope JSON, fixture/parser versions, timestamps, `pending|running|succeeded|failed|blocked`, terminal reason, and nullable `published_at`. `crawl_tasks` stores task kind, status, attempts, lease/fencing token, error JSON, and `result_json`; structured rejects live in the task result for this slice. `source_fetches` stores object key, SHA-256, MIME type, final URL, navigation status, capture time, parser version, and sanitized metadata JSON. Evidence tables reference `source_fetches` with restrictive foreign keys. Use `numeric(18,2)` for all three financial columns.

Add indexes for `(crawl_tasks.run_id, status)`, `(run_company_matches.run_id)`, `(financial_evidence.company_inn, report_year)`, and `(source_fetches.run_id)`.

- [ ] **Step 4: Implement the database transaction boundary**

```ts
export interface Database {
  query<T>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
}
```

`transaction` must use one checked-out client, `BEGIN`, `COMMIT`, and `ROLLBACK`, and must release the client in `finally`.

- [ ] **Step 5: Verify up/down/up and rollback behavior**

Run: `npm run test:integration -- test/integration/postgres/migration.test.ts`

Expected: PASS, including migration down removing `audience` and a deliberately thrown transaction leaving no row behind.

- [ ] **Step 6: Commit**

```bash
git add migrations src/shared/postgres test/integration/postgres test/support/postgres.ts
git commit -m "feat: add audience ingestion schema"
```

---

### Task 3: Implement strict INN/OKVED value objects and selected-code import

**Files:**

- Create: `data/okved/selected-okveds.csv`
- Create: `src/modules/audience/domain/inn.ts`
- Create: `src/modules/audience/domain/okved.ts`
- Create: `src/modules/audience/application/import-selected-okveds.ts`
- Create: `src/modules/audience/infrastructure/postgres/okved-repository.ts`
- Create: `test/unit/audience/domain/inn.test.ts`
- Create: `test/unit/audience/domain/okved.test.ts`
- Create: `test/integration/audience/import-selected-okveds.test.ts`

**Interfaces:**

- Consumes: `Database` from Task 2 and UTF-8 CSV rows `{ code, name, source_version }`.
- Produces: `parseLegalEntityInn(value): LegalEntityInn`, `parseOkvedCode(value): OkvedCode`, `importSelectedOkveds(csv, repository)`, and `OkvedRepository` for Tasks 4 and 6.

- [ ] **Step 1: Write failing value-object tests**

```ts
expect(parseLegalEntityInn("7707083893")).toBe("7707083893");
expect(() => parseLegalEntityInn("7707083894")).toThrow("checksum");
expect(() => parseLegalEntityInn("123456789012")).toThrow("legal entity");
expect(parseOkvedCode("43.11")).toBe("43.11");
expect(() => parseOkvedCode("4311")).toThrow("canonical OKVED");
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- test/unit/audience/domain`

Expected: FAIL because the value objects do not exist.

- [ ] **Step 3: Implement validation without heuristic correction**

Implement the Russian legal-entity INN checksum using coefficients `[2,4,10,3,5,9,4,6,8]`. Accept only ASCII digits and exactly ten characters. Implement OKVED grammar `^[0-9]{2}(?:\.[0-9]{1,2}){0,2}$`; trim surrounding whitespace only and reject punctuation removal or inferred dots.

- [ ] **Step 4: Add the stable selected-code CSV**

```csv
code,name,source_version
43.11,Разборка и снос зданий,ОКВЭД-2 ОК 029-2014 (КДЕС Ред. 2)
```

Keep UTF-8, LF line endings, and code values as strings. Do not commit an ad-hoc conversion of all 967 codes in this slice.

- [ ] **Step 5: Write and implement the importer integration test**

The first run inserts `43.11`; the second run updates only name/source metadata and keeps one row. A malformed code must abort the import transaction and leave prior rows unchanged.

The repository API is:

```ts
export interface OkvedRepository {
  upsertMany(rows: readonly { code: OkvedCode; name: string; sourceVersion: string }[]): Promise<number>;
  find(code: OkvedCode): Promise<OkvedRecord | null>;
}
```

- [ ] **Step 6: Verify**

Run: `npm test -- test/unit/audience/domain && npm run test:integration -- test/integration/audience/import-selected-okveds.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add data/okved src/modules/audience/domain src/modules/audience/application/import-selected-okveds.ts src/modules/audience/infrastructure/postgres/okved-repository.ts test/unit/audience test/integration/audience/import-selected-okveds.test.ts
git commit -m "feat: validate and import selected OKVED codes"
```

---

### Task 4: Build the isolated Playwright fixture collector and immutable raw bundle

**Files:**

- Create: `src/modules/audience/application/ports/browser-session.ts`
- Create: `src/modules/audience/application/ports/raw-object-storage.ts`
- Create: `src/modules/audience/domain/discovery.ts`
- Create: `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- Create: `src/modules/audience/infrastructure/storage/s3-raw-object-storage.ts`
- Create: `src/modules/audience/infrastructure/storage/raw-bundle.ts`
- Create: `test/support/list-org-fixture-server.ts`
- Create: `test/fixtures/list-org-browser/search.html`
- Create: `test/fixtures/list-org-browser/results-page-1.html`
- Create: `test/fixtures/list-org-browser/results-page-2.html`
- Create: `test/fixtures/list-org-browser/company-1001.html`
- Create: `test/fixtures/list-org-browser/company-1002.html`
- Create: `test/fixtures/list-org-browser/company-1003.html`
- Create: `test/fixtures/list-org-browser/captcha.html`
- Create: `test/fixtures/list-org-browser/soft-block.html`
- Create: `test/fixtures/list-org-browser/contract-drift.html`
- Create: `test/integration/audience/list-org-browser-source.test.ts`
- Create: `test/integration/audience/s3-raw-object-storage.test.ts`

**Interfaces:**

- Consumes: `LegalEntityInn` and `OkvedCode` from Task 3, `AppEnv` from Task 1, and a fixture base URL supplied by the test server.
- Produces: `OrganizationSource.collect(scope): Promise<DiscoveryResult>`, `RawObjectStorage.put(bundle): Promise<StoredRawObject>`, and checksummed `BrowserRawBundle` manifests consumed by replay in Task 6.

- [ ] **Step 1: Write the failing happy-path browser test**

The local server exposes `/search`, two result pages, and three company cards. Company `1002` appears on both result pages. The test must assert only browser-visible operations and ordered discovery:

```ts
const result = await source.collect({
  okved: "43.11",
  onlyActive: true,
  maxPages: 2,
  maxCompanies: 50
});

expect(result.status).toBe("succeeded");
expect(result.companies.map((x) => x.inn)).toEqual([
  "7707083893", "7710140679", "7704217370"
]);
expect(result.pages).toHaveLength(2);
expect(result.pages.every((x) => x.raw.checksumSha256.length === 64)).toBe(true);
```

- [ ] **Step 2: Run the browser test and confirm failure**

Run: `npm run test:integration -- test/integration/audience/list-org-browser-source.test.ts`

Expected: FAIL because the fixture server and adapter do not exist.

- [ ] **Step 3: Define the source contract**

```ts
export type DiscoveryStatus = "succeeded" | "limited" | "blocked";

export interface OrganizationSource {
  collect(scope: DiscoveryScope): Promise<DiscoveryResult>;
}

export interface DiscoveredCompany {
  sourceRecordKey: string;
  inn: LegalEntityInn;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  okvedCode: OkvedCode;
  isPrimary: boolean;
  rawFetchKey: string;
}

export interface BrowserRawBundle {
  finalUrl: string;
  capturedAt: string;
  navigationStatus: number | null;
  sanitizedDomUtf8: Uint8Array;
  redactedScreenshotPng: Uint8Array;
  pageFingerprintSha256: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  actions: readonly { at: string; kind: string; target: string; outcome: string }[];
}
```

- [ ] **Step 4: Implement a true visible-controls fixture flow**

The adapter must launch pinned Chromium, create a fresh context, navigate to the fixture `/search`, fill the visible OKVED field, check `work`, click submit, wait for a result landmark, verify the rendered filter values, open cards by visible links, and advance only by clicking a visible next link.

Use stable semantic selectors in fixtures (`label`, role, link name), not CSS tied to presentation. Capture a result-page fingerprint before and after opening each card. Stop only when the explicit terminal marker appears or a configured limit is reached.

Route all requests through a strict allowlist containing exactly the fixture origin and `data:` URLs. Abort any other request and include the URL origin in the failed assertion. Launch no persistent browser context.

- [ ] **Step 5: Implement sanitization and immutable S3 persistence**

Remove `script`, cookies, tokens, hidden secrets, and configured sensitive query parameters from DOM/metadata. Redact phone/email in screenshots by covering their element boxes before capture; retain normalized contact text only in the domain record. Serialize a deterministic manifest, calculate SHA-256 over each artifact and the manifest, and write with `If-None-Match: *` under `raw/{runId}/{sourceKind}/{checksum}/...`.

An existing object with the same checksum is success; a key collision with different content is fatal.

- [ ] **Step 6: Add negative browser tests**

Cover:

- CAPTCHA landmark → `blocked/captcha`;
- navigation 403 → `blocked/http_403`;
- soft-block page with HTTP 200 → `blocked/soft_block`;
- missing required controls/landmarks → `blocked/contract_drift`;
- missing terminal pagination marker → never reported as success;
- attempted external request → test failure;
- duplicate company across pages → one discovered company, with both page occurrences retained in evidence metadata.

- [ ] **Step 7: Verify browser and storage integrations**

Run: `docker compose up -d minio && npm run test:integration -- test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts`

Expected: PASS and no network request outside the fixture origin/loopback storage.

- [ ] **Step 8: Commit**

```bash
git add src/modules/audience/application/ports src/modules/audience/domain/discovery.ts src/modules/audience/infrastructure/sources src/modules/audience/infrastructure/storage test/support/list-org-fixture-server.ts test/fixtures/list-org-browser test/integration/audience/list-org-browser-source.test.ts test/integration/audience/s3-raw-object-storage.test.ts
git commit -m "feat: collect organizations through fixture browser flow"
```

---

### Task 5: Parse financial fixtures with metric-level provenance

**Files:**

- Create: `src/modules/audience/domain/financial.ts`
- Create: `src/modules/audience/infrastructure/sources/fns-revexp/revexp-parser.ts`
- Create: `src/modules/audience/infrastructure/sources/fns-bfo/bfo-parser.ts`
- Create: `test/fixtures/fns-revexp/revexp.xml`
- Create: `test/fixtures/fns-bfo/report-0710002.json`
- Create: `test/unit/audience/revexp-parser.test.ts`
- Create: `test/unit/audience/bfo-parser.test.ts`

**Interfaces:**

- Consumes: `LegalEntityInn` from Task 3 and immutable fixture bytes plus their raw fetch keys.
- Produces: `parseRevexp(input, context): FinancialMetricEvidence[]`, `parseBfo(input, context): BfoParseResult`, `parseMoneyText(value, format): MoneyText`, and metric-level evidence consumed by Task 6.

- [ ] **Step 1: Write failing mapping and zero/NULL tests**

```ts
expect(parseRevexp(xml)).toEqual([
  expect.objectContaining({ inn: "7707083893", income: "150000.00", expenses: "0.00" })
]);
expect(parseBfo(report)).toEqual(
  expect.objectContaining({ inn: "7707083893", reportYear: 2025, revenue: "125000.00" })
);
expect(parseBfo(reportWithout2110).revenue).toBeNull();
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- test/unit/audience/revexp-parser.test.ts test/unit/audience/bfo-parser.test.ts`

Expected: FAIL because parsers do not exist.

- [ ] **Step 3: Define canonical financial types**

```ts
export type FinancialMetric = "revenue" | "income" | "expenses";
export type MoneyText = string & { readonly __moneyText: unique symbol };

export interface FinancialMetricEvidence {
  inn: LegalEntityInn;
  reportYear: number;
  metric: FinancialMetric;
  value: MoneyText;
  sourceKind: "fns_bfo" | "fns_revexp";
  sourceRecordKey: string;
  rawFetchKey: string;
  parserVersion: string;
}
```

`parseMoneyText` accepts non-negative decimal text, converts comma to dot only when the source contract declares comma decimal formatting, rejects exponent notation, and emits exactly two fractional digits without using `number`.

- [ ] **Step 4: Implement streaming revexp parsing**

Use `saxes` to parse fixture elements/attributes for `ИННЮЛ`, `СумДоход`, and `СумРасход`. Reject INN-12 and invalid checksums. Emit separate metric evidence for income and expenses, including zero. A missing element produces no metric evidence, never an invented zero.

- [ ] **Step 5: Implement the bounded BFO fixture contract**

The fixture explicitly identifies form `0710002`, line `2110`, period 2025, unit, correction timestamp, and source record key. Select the newest correction for the requested year, require ruble-compatible units, and emit only `revenue`. Treat missing line 2110 as absent evidence.

This adapter is a fixture contract only; do not add a live BFO URL or assume the JSON is the final official machine contract.

- [ ] **Step 6: Verify malformed, zero, and missing cases**

Run: `npm test -- test/unit/audience/revexp-parser.test.ts test/unit/audience/bfo-parser.test.ts`

Expected: PASS for valid values and rejects for invalid INN, malformed decimal, wrong form, wrong year, and incompatible unit.

- [ ] **Step 7: Commit**

```bash
git add src/modules/audience/domain/financial.ts src/modules/audience/infrastructure/sources/fns-revexp src/modules/audience/infrastructure/sources/fns-bfo test/fixtures/fns-revexp test/fixtures/fns-bfo test/unit/audience/revexp-parser.test.ts test/unit/audience/bfo-parser.test.ts
git commit -m "feat: parse FNS financial fixture evidence"
```

---

### Task 6: Orchestrate runs, publish transactionally, and make replay idempotent

**Files:**

- Create: `src/modules/audience/application/ports/job-queue.ts`
- Create: `src/modules/audience/application/run-fixture-discovery.ts`
- Create: `src/modules/audience/application/replay-run.ts`
- Create: `src/modules/audience/application/publish-financial-evidence.ts`
- Create: `src/modules/audience/application/reconcile-run.ts`
- Create: `src/modules/audience/infrastructure/postgres/audience-repository.ts`
- Create: `src/shared/jobs/pg-boss-job-queue.ts`
- Create: `src/apps/worker/main.ts`
- Create: `src/apps/browser-runner/main.ts`
- Create: `test/integration/audience/fixture-run.test.ts`
- Create: `test/integration/audience/financial-publication.test.ts`
- Create: `test/integration/audience/job-delivery.test.ts`

**Interfaces:**

- Consumes: `Database`, `OrganizationSource`, `RawObjectStorage`, `OkvedRepository`, and `FinancialMetricEvidence` from Tasks 2–5.
- Produces: `runFixtureDiscovery(command): Promise<RunSummary>`, `replayRun(command): Promise<PublicationSummary>`, `publishFinancialEvidence(command): Promise<void>`, `reconcileRun(runId): Promise<ReconciliationReport>`, and the bounded CLI commands used by Task 7.

- [ ] **Step 1: Write the failing end-to-end publication test**

The test sequence is:

1. import `43.11`;
2. execute a fixture discovery with `dryRun: true`;
3. assert run/task/fetch audit exists but domain tables are empty;
4. replay the saved raw manifest with `dryRun: false`;
5. assert three companies, three run matches, and unique company/OKVED relations;
6. replay again and assert all domain counts and values are unchanged.

```ts
expect(await counts(db)).toMatchObject({
  companies: 3,
  companyOkveds: 3,
  runCompanyMatches: 3
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm run test:integration -- test/integration/audience/fixture-run.test.ts`

Expected: FAIL because orchestration and repositories do not exist.

- [ ] **Step 3: Implement crawl-run state transitions and fencing**

Only allow:

```text
pending -> running -> succeeded
                   -> failed
                   -> blocked
```

Acquire a task by atomically incrementing its fencing token and setting a lease. Every later state mutation must include `(task_id, fencing_token)` in the `WHERE` clause. A stale worker updates zero rows and must stop.

`blocked` is terminal for `captcha`, `http_403`, `soft_block`, `policy_block`, and `contract_drift`. The CLI must reject `resume` for blocked runs and instruct creation of a new run.

- [ ] **Step 4: Implement audit-first dry-run and replay-write**

`runFixtureDiscovery` creates run/task rows, invokes the browser source, persists raw objects and `source_fetches`, records rejects, and reconciles counts. With `dryRun: true`, it does not write `companies`, `company_okveds`, `run_company_matches`, or evidence tables.

`replayRun` reads only the stored manifest/checksums, re-parses without Playwright, and publishes all organization rows in one database transaction using parameterized `INSERT ... ON CONFLICT`. It must never re-fetch the source. Replay-write adds an audited `replay_write` task to the original run and sets `published_at`; it does not create a second crawl run, so repeated replay remains idempotent for `run_company_matches` as well as company data.

- [ ] **Step 5: Publish financial evidence without cross-source erasure**

In one transaction, upsert metric evidence by its natural key and then project each metric independently:

```sql
INSERT INTO audience.financial_observations (company_inn, report_year, revenue)
VALUES ($1, $2, $3::numeric)
ON CONFLICT (company_inn, report_year)
DO UPDATE SET revenue = EXCLUDED.revenue, updated_at = now();
```

Use an equivalent statement for `income` and `expenses`; never update columns that are absent from the current source. Insert evidence before the wide projection, and roll both back on error.

- [ ] **Step 6: Put pg-boss behind the job port**

```ts
export interface JobQueue {
  publish<T>(name: string, payload: T, options: { singletonKey: string }): Promise<string>;
  work<T>(name: string, handler: (job: QueuedJob<T>) => Promise<void>): Promise<void>;
}
```

Use singleton key `audience:{runId}:{taskKind}`. The job-delivery test must run the same payload twice and prove domain idempotency. pg-boss owns delivery/lease mechanics; `crawl_tasks` remains the business audit record.

- [ ] **Step 7: Implement bounded CLIs**

Required commands:

```bash
npm run audience -- fixture-discover --okved 43.11 --year 2025 --dry-run
npm run audience -- replay-write --run-id <uuid>
npm run audience -- fixture-finance --run-id <uuid> --year 2025
npm run audience -- reconcile --run-id <uuid>
npm run worker
```

The parser must reject an unknown command, live URL, missing limit, or IP mode. CLI output is structured JSON without cookies, raw contacts, credentials, or full DOM.

- [ ] **Step 8: Verify orchestration, independent finance updates, and at-least-once delivery**

Run: `npm run test:integration -- test/integration/audience/fixture-run.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/job-delivery.test.ts`

Expected: PASS. In the finance test, publish BFO revenue, then revexp income/expenses, then a newer BFO revenue; income and expenses must remain unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/modules/audience/application src/modules/audience/infrastructure/postgres/audience-repository.ts src/shared/jobs src/apps test/integration/audience/fixture-run.test.ts test/integration/audience/financial-publication.test.ts test/integration/audience/job-delivery.test.ts
git commit -m "feat: orchestrate idempotent audience ingestion"
```

---

### Task 7: Add reconciliation, fixture acceptance, and operational documentation

**Files:**

- Create: `test/e2e/audience-parser.e2e.test.ts`
- Create: `docs/architecture/audience-ingestion-source-policy.md`
- Create: `docs/runbooks/audience-parser-canary.md`
- Modify: `README.md` if it exists; otherwise create it
- Modify: `CONTEXT.md`
- Modify: `docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md`

**Interfaces:**

- Consumes: the four application use cases and `ReconciliationReport` from Task 6.
- Produces: a clean-environment fixture acceptance test, an operational runbook, and an explicit policy gate that keeps live sources disabled after this slice is complete.

- [ ] **Step 1: Write the failing reconciliation acceptance test**

The final fixture report must account for every item:

```ts
expect(report.discovery).toEqual({
  occurrences: 4,
  uniqueSourceRecords: 3,
  acceptedCompanies: 3,
  duplicates: 1,
  rejected: 0
});
expect(report.tasks.nonTerminal).toBe(0);
expect(report.financial).toEqual({ revenue: 1, income: 1, expenses: 1 });
expect(report.unexplainedSourceFetches).toBe(0);
```

- [ ] **Step 2: Run the e2e test and confirm failure**

Run: `npm test -- test/e2e/audience-parser.e2e.test.ts`

Expected: FAIL until the report and complete fixture path are wired together.

- [ ] **Step 3: Implement reconciliation invariants**

Fail the run instead of reporting success when:

- any task is non-terminal;
- a discovered occurrence is neither accepted, duplicate, nor rejected;
- a published organization/metric lacks evidence;
- evidence references a missing raw fetch/checksum;
- a successful browser run lacks an explicit end marker or declared limit reason;
- financial projection differs from its newest selected evidence.

- [ ] **Step 4: Document the source-policy gate and canary operation**

The policy document must state that fixture mode is currently permitted and live List-Org/BFO are disabled. It must record the required owner, decision date/expiry, allowed routes/actions, policy checksum, rate/concurrency limits, and terminal block reasons before live activation.

The runbook must cover local startup, migration, OKVED import, dry-run, artifact inspection, replay-write, fixture finance, reconciliation, cleanup, common failures, and the rule that a blocked run is never resumed.

- [ ] **Step 5: Run the complete clean-environment acceptance sequence**

```bash
docker compose down -v
docker compose up -d postgres minio
npm ci
npx playwright install chromium
npm run migrate:up
npm run build
npm test
npm run migrate:down
npm run migrate:up
```

Expected: all services healthy, build and tests pass, down/up migration succeeds, and no test contacts a non-loopback origin.

- [ ] **Step 6: Inspect the database and raw storage**

Verify manually with read-only queries that:

- repeated fixture replay leaves three companies and three `(company_inn, okved_code)` relations;
- the duplicated result occurrence remains visible in evidence/reconciliation;
- `revenue=125000.00`, `income=150000.00`, `expenses=0.00` for the fixture company/year;
- every non-NULL metric has evidence and a raw checksum;
- dry-run rows did not leak into domain tables.

- [ ] **Step 7: Update project decisions and pilot-plan status**

Record the executable slice, exact verification commands, unresolved live source gates, and the fact that IP remains a separate second-stage plan. Do not mark live canary complete.

- [ ] **Step 8: Request a code review and fix findings**

Use the `code-review` skill against the full branch diff. Re-run targeted tests after each fix and the complete acceptance sequence after the final fix.

- [ ] **Step 9: Commit**

```bash
git add test/e2e docs/architecture/audience-ingestion-source-policy.md docs/runbooks/audience-parser-canary.md README.md CONTEXT.md docs/plans/2026-08-24-001-feat-okved-parser-pilot-plan.md
git commit -m "docs: add OKVED parser fixture canary runbook"
```

---

## Completion Gate

Before claiming completion, invoke `verification-before-completion` and provide fresh evidence for:

- `npm run build`;
- the full Vitest suite;
- migration down/up;
- fixture browser origin isolation;
- dry-run followed by replay-write and a second idempotent replay;
- independent financial metric publication;
- reconciliation with zero unexplained records/tasks;
- `git status --short`, explicitly preserving unrelated pre-existing worktree changes.

The first executable slice is complete only when fixture acceptance passes. Live List-Org discovery, live BFO access, full 967-code traversal, and IP support remain separate gated work.
