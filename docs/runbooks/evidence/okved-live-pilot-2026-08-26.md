# Bounded OKVED live-pilot evidence — 2026-08-26

## Result

- Live attempts: `1`
- Fixed command contract: OKVED `43.11`, year `2025`, maximum companies `10`
- Command exit code: `1`
- Public terminal result: `operation failed`
- Run ID: `50b2909b-0171-45d6-ae17-7c805ff49be6`
- Durable run state: `running`
- Durable terminal reason: absent
- CAPTCHA interaction: none observed; no operator input was sent
- Outcome: failed before durable discovery completion
- Replacement run: not created

The attempt did not reach a terminal reconciled state. It published no company,
OKVED, or financial data. It stored no run-scoped raw object.

## Pre-live gates

| Gate | Result |
| --- | --- |
| Initial owned-database snapshot | 0 runs, 0 tasks, 0 source fetches, 0 companies, 0 relations, 0 financial observations |
| Migration down on PostgreSQL host port 5433 | exit 0 |
| Migration up on PostgreSQL host port 5433 | exit 0 |
| Full fixture suite | 27 files and 622 tests passed |
| TypeScript build | exit 0 |
| Compose ownership | `okved-parser` PostgreSQL and MinIO containers healthy |
| Published service ports | PostgreSQL 5433; MinIO 9000 and 9001, all on loopback |
| Database identity | client port 5433; database and role both `okved`; migration present |
| MinIO bucket | `okved-raw` accessible |
| Headed browser | visible Chromium launch succeeded against `about:blank` |
| Exact BFO label contract | both required labels present in strict source reads and projection selectors |
| Approved entry-point metadata | all three HTTPS HEAD checks returned 200 |
| Preflight database snapshot | all relevant counts remained 0 |

The non-live suite used fixture gates and loopback service endpoints. No public
collection ran before the single approved attempt. The preflight did not download
a response body or follow a redirect.

## Ordered companies and financial outcomes

No discovery candidate reached durable completion.

- Ordered INNs: none
- 2025 revenue outcomes: `0`
- 2025 income outcomes: `0`
- 2025 expenses outcomes: `0`
- Published metric values: `0`
- Positively evidenced `no_data` outcomes: `0`
- Source-attempt records: `0`

The BFO live flow was not reached. The two required exact visible-label contracts
were verified statically in the reviewed adapter and strict selectors; the
attempt produced no live BFO label observation.

## Durable SQL audit

| Count | Value |
| --- | ---: |
| Crawl runs | 1 |
| Crawl tasks | 1 |
| Non-terminal tasks | 1 |
| Successful live discovery tasks | 0 |
| Successful live finance tasks | 0 |
| Source fetches | 0 |
| Companies | 0 |
| Company/OKVED relations | 0 |
| Run/company matches | 0 |
| Organization evidence rows | 0 |
| Financial evidence rows | 0 |
| Financial observations | 0 |
| Terminal 2025 company/metric outcomes | 0 |
| Out-of-scope financial evidence | 0 |

The sole task is `live_discovery`, state `running`, attempt count `1`, fencing
token `1`. It has no result, error, CAPTCHA action, or completed timestamp. Its
five-minute lease was still active at the audit time.

## Raw and immutable-evidence audit

| Source | Database rows | Run-scoped MinIO objects |
| --- | ---: | ---: |
| List-Org live browser | 0 | 0 |
| FNS BFO live browser | 0 | 0 |
| FNS `revexp` archive | 0 | 0 |
| Unexpected source kinds | 0 | 0 |

- Run-scoped object prefix count: `0`
- Manifests verified: `0`
- Artifact checksum mismatches: `0`
- Unexplained raw objects: `0`
- Safe object keys/checksums: none

There were no durable raw bytes to verify. The preserved MinIO volume contains no
object under this run's prefix.

## Reconciliation

- Successful reconciliation: `false`
- Expected companies / actual: `10 / 0`
- Expected `43.11` relations / actual: `10 / 0`
- Expected successful finance tasks / actual: `10 / 0`
- Expected terminal metric outcomes / actual: `30 / 0`
- Expected non-terminal tasks / actual: `0 / 1`
- Expected `revexp` archives / actual: `1 / 0`

The original command did not reach the reconciliation phase. A separate read-only
reconciliation invocation also exited 1 because its CLI wrapper closed the shared
database resource before the asynchronous repository operation completed. No
second source collection or live attempt occurred.

## Failure classification and concerns

The production CLI lifecycle is the evidence-backed failure boundary. The live
and reconciliation switch branches return asynchronous operations from inside a
resource-owning `try/finally`. The `finally` closes PostgreSQL and raw storage
before those returned operations settle. The direct orchestrator tests bypass
this wrapper, so the full non-live suite did not expose the production lifecycle
failure.

Consequences observed in this attempt:

- the run and discovery task were created and leased;
- the shared database resource then became unavailable;
- the command exited before discovery evidence or terminalization;
- the run and task remained non-terminal;
- no raw, organization, relation, or financial record was published.

Task 8 permits documentation and evidence changes only. No code or database state
was altered to mask the failure. A code fix, regression test for the production
CLI resource lifetime, cleanup policy for the stranded task, and any new live run
require a separate explicit instruction.

## Shutdown

- Scoped Compose shutdown: exit 0
- Containers removed: owned PostgreSQL and MinIO only
- Scoped network removed: yes
- Volume deletion flag used: no
- Preserved volumes: `okved-parser_postgres_data`, `okved-parser_minio_data`

The failed run, stranded task, and absence of run-scoped raw objects remain
recoverable in the preserved owned volumes.
