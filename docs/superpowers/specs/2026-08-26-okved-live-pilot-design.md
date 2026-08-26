# Bounded live pilot for OKVED 43.11

## Status

Approved in conversation on 2026-08-26. This design extends the verified fixture-only audience parser with one bounded live pilot. It does not authorize bulk traversal or general-purpose scraping.

## Goal

Run a single auditable pilot that:

1. uses the visible List-Org advanced-search browser UI for OKVED `43.11`;
2. selects the first 10 unique legal entities in the site's default result order;
3. writes those organizations and their `43.11` relations to PostgreSQL;
4. loads 2025 `revenue`, `income`, and `expenses` from official FNS sources;
5. records immutable raw provenance and reconciles the run.

The pilot includes inactive legal entities if they occur in the first 10. Individual entrepreneurs are excluded. A selected organization is not replaced merely because some or all 2025 financial data is unavailable.

## Fixed financial mapping

- `revenue` comes only from FNS BFO form `0710002`, line `Ф2.2110`.
- `income` comes only from the FNS `revexp` open-data release.
- `expenses` comes only from the FNS `revexp` open-data release.

Missing, restricted, or legitimately absent values are explicit audited `no_data` outcomes. They are never converted to zero.

## Command and activation contract

Add one public command with a deliberately narrow contract:

```text
audience live-pilot --okved 43.11 --year 2025 --max-companies 10
```

The command rejects any other OKVED, year, or company limit in the first live-pilot release. It requires all of:

```text
APP_MODE=live
LIST_ORG_LIVE_ENABLED=true
FNS_LIVE_ENABLED=true
```

The command does not accept caller-provided source URLs, cookies, proxy settings, IP controls, concurrency controls, or arbitrary browser scripts. Existing fixture commands remain fixture-only and retain their current behavior.

The first pilot always uses a visible browser. Headless live execution is out of scope.

## Components

### Live pilot orchestrator

The orchestrator owns the bounded state machine:

1. validate the fixed command and live feature gates;
2. create one run scoped to `43.11`, 2025, 10 companies, and the three required financial metrics;
3. perform evidence-only List-Org discovery;
4. require exactly 10 accepted unique legal-entity INNs;
5. replay the accepted companies and OKVED relations into PostgreSQL;
6. stage and publish financial outcomes per company;
7. reconcile the run and emit a terminal report.

The orchestrator reuses the current raw bundle, task fencing, replay, publication, and reconciliation boundaries. It does not create a parallel persistence model.

### List-Org live browser adapter

The adapter navigates only through the public browser UI at `https://www.list-org.com`:

- open `/search` in one visible browser context;
- fill the advanced-search OKVED field with `43.11`;
- submit the form through its visible Search button;
- inspect results in the site's default order;
- open company cards sequentially and validate the legal-entity INN;
- skip duplicate INNs and continue until 10 unique legal entities are accepted.

The adapter must not use the Excel export link or reverse-engineered internal endpoints. It operates one page and one action at a time, waits for observable navigation readiness, and does not parallelize requests.

Existing browser isolation, canonical URL validation, durable action recording, sanitization, inert screenshot rendering, and immutable S3 manifest verification remain mandatory for live evidence.

### FNS `revexp` adapter

The adapter discovers the current official `7707329152-revexp` release through FNS metadata rather than hard-coding a dated archive URL. It must verify that the release describes 2025 data and record:

- metadata page and final archive URL;
- XSD/structure version;
- capture time and response metadata;
- archive checksum.

The archive is downloaded once from the official FNS file host, parsed as a stream, and filtered to the 10 target INNs. The existing `revexp` domain parser remains the mapping boundary for `income` and `expenses`.

### FNS BFO browser adapter

For each of the 10 INNs, the adapter uses the public visible UI at `https://bo.nalog.gov.ru`:

- search by INN;
- select annual period 2025;
- open the organization's report through the user-visible flow;
- obtain the official per-organization report offered by that flow;
- validate INN, report year, form `0710002`, unit, correction identity, and source timestamp;
- map only line `2110` to `revenue`.

The paid subscription REST API is not required for this pilot. The adapter does not call undocumented application endpoints directly.

## Origin and transport policy

Live traffic is restricted to HTTPS and an explicit source-owned allowlist:

- `www.list-org.com` for List-Org navigation;
- `bo.nalog.gov.ru` for BFO navigation and user-visible report retrieval;
- the official `nalog.gov.ru` and `file.nalog.ru` hosts required to resolve and download the `revexp` release.

Redirects, popups, downloads, WebSockets, service workers, or requests outside the exact policy are blocked and recorded. A BFO or `revexp` download is allowed only when initiated by the corresponding approved source adapter and when its final URL remains on the source's allowlist.

No proxy, IP rotation, CAPTCHA solver, third-party anti-bot service, or request flooding is permitted.

## Publication and transaction boundaries

List-Org discovery first writes only audit and immutable raw evidence. Publication begins only after the discovery stage has exactly 10 accepted unique legal-entity INNs.

Company and `company_okved` publication uses the existing replay boundary and must leave all 10 relations committed or none of them committed for this pilot.

Financial publication is isolated per company. The three required metric outcomes for one company are validated together and then committed through the existing financial publication contract. One company's `no_data` does not replace that organization or prevent other companies from publishing. Unexplained absence of an outcome blocks reconciliation.

Every published value points to financial evidence, an audited source attempt, and immutable raw provenance. Every `no_data` outcome points to an audited successful source attempt that proves legitimate absence or restricted availability.

## CAPTCHA and blocking behavior

Ordinary browser forms and navigation are automated. CAPTCHA is not solved automatically.

When either source presents CAPTCHA or an explicit human-verification challenge:

1. the adapter records a durable `captcha_waiting` policy event while the run remains non-terminal, without storing the challenge contents as reusable bypass material;
2. the visible browser remains open at the challenge;
3. the CLI asks the operator to complete the challenge manually and explicitly confirm continuation;
4. after confirmation, the adapter revalidates the current origin and page identity before resuming the same session.

A closed browser, operator abort, failed revalidation, `403`, soft block, or contract drift transitions the run from `captcha_waiting` to terminal `blocked`. The system does not automatically create a replacement run.

## Retry and failure policy

- A transient network error or source `5xx` may be retried at most twice, sequentially, with bounded delay.
- CAPTCHA, `403`, soft block, origin-policy failure, contract drift, invalid INN, wrong report year, or malformed evidence is never blindly retried.
- Duplicate List-Org INNs are recorded and skipped while preserving result order.
- Fewer than 10 accepted unique legal entities leaves only audit/raw discovery state; no companies are replayed.
- An unavailable or restricted 2025 financial report creates `no_data` only when the adapter has positive source evidence for that outcome.
- A source failure is not `no_data`; it leaves the corresponding financial task failed or blocked.

## Privacy and evidence

Browser artifacts pass through the existing sensitive-value collection and sanitizer before durable storage. Raw live HTML, screenshots, URLs, action records, and downloads must satisfy the same fail-closed manifest and replay verification used by fixture mode.

Only domain fields required by the current schema are published. Cookies, session storage, CAPTCHA material, authorization data, request headers, and unrelated page content are excluded from durable evidence.

FNS source files are stored in source-specific immutable S3 prefixes with checksums and parser versions. Temporary browser downloads are removed after verified storage.

## Testing

### Unit tests

Cover:

- exact live command grammar and fixed bounds;
- independent List-Org and FNS live gates;
- source allowlists and redirect/download policy;
- first-10 legal-entity selection with duplicate INNs;
- CAPTCHA/manual-resume state transitions;
- actual 2025 BFO format parsing and `Ф2.2110` mapping;
- 2025 `revexp` release metadata validation and streaming selection;
- `published`, `no_data`, `failed`, and `blocked` financial outcomes.

### Integration tests

Run all live components against local contract servers and sanitized source-shaped fixtures. Cover:

- one complete 10-company run;
- inactive legal entities retained in result order;
- duplicate List-Org results;
- fewer than 10 accepted companies;
- CAPTCHA pause and manual continuation;
- foreign-origin redirects and disallowed downloads;
- restricted BFO report, missing metric, wrong INN/year, correction ordering, and malformed source;
- partial source failure without false `no_data`;
- atomic company/OKVED replay and per-company financial publication.

Tests never access live sites.

### End-to-end acceptance

Before the live pilot:

1. run migration down/up on owned PostgreSQL port 5433;
2. run the complete fixture suite and dedicated audience e2e suite;
3. build the project and audit the protected files;
4. verify that PostgreSQL and MinIO belong to the isolated `okved-parser` Compose project.

After the pilot, SQL and raw-storage audits must prove:

- exactly 10 unique run companies;
- exactly 10 run-scoped relations to `43.11`;
- a terminal outcome for every company/metric pair for 2025;
- provenance for every value and every legitimate `no_data`;
- no unexplained raw object, evidence row, non-terminal task, or out-of-scope year;
- successful reconciliation.

The terminal report lists the run ID, the 10 INNs, each metric value or `no_data`, source-attempt status, and reconciliation counts. It must not print sensitive browser/session material.

## Operational sequence

Implementation and non-live tests are committed before live access. The first real run then uses the owned local PostgreSQL 5433 and MinIO 9000/9001 volumes. No production database, remote publication, merge, or deployment is part of the pilot.

The live command runs once. It does not traverse additional OKVED codes, replace organizations with missing finance, or continue past the 10-company bound.

## Out of scope

- individual entrepreneurs;
- more than one OKVED or more than 10 organizations;
- background/headless live collection;
- bulk List-Org export;
- paid BFO subscription API;
- CAPTCHA automation;
- proxies or IP rotation;
- live retries that create replacement runs;
- deployment, scheduling, or production database writes.

## Official source references

- List-Org advanced search: `https://www.list-org.com/search`
- FNS BFO resource: `https://bo.nalog.gov.ru/`
- FNS BFO subscription service: `https://bo.nalog.gov.ru/subscriptions-service`
- FNS `revexp` dataset metadata: `https://www.nalog.gov.ru/opendata/7707329152-revexp/`
