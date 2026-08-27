# Second bounded OKVED live-pilot authorization design

**Date:** 2026-08-27

**Status:** approved for specification by the repository operator

**Base implementation:** `0c9313c4313f64eb977078f9339643453564bd86`

## Objective

Authorize one replacement live-pilot attempt after the first authorized attempt
failed before discovery because of the subsequently fixed CLI resource-lifecycle
defect. The replacement keeps the same business scope:

- OKVED `43.11`;
- report year `2025`;
- first 10 unique legal entities in List-Org default order;
- active and inactive entities included;
- individual entrepreneurs and duplicate INNs skipped with audited outcomes;
- `revenue` from BFO form `0710002`, line `2110`;
- `income` and `expenses` from official FNS `7707329152-revexp`.

The authorization does not permit a third attempt, a changed command, another
database, another object store, additional origins, hidden APIs, exports,
proxies, CAPTCHA solvers, or headless live execution.

## Decision

Use a new in-code policy authorization rather than a runtime token, file, or CLI
flag. The authorization has two committed snapshots: the reviewed active
snapshot used for the attempt and the terminal consumed snapshot written after
it. This preserves the fixed public command and checksum boundary.

The previous policy and failed run remain immutable historical evidence. The
new policy receives a distinct identity:

- policy version: `2`;
- scope key:
  `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02`;
- owner: `Veronica — АСТ Форум repository operator`;
- reviewed at: `2026-08-27T09:40:50+03:00`;
- expires at: `2026-08-27T21:40:50+03:00`;
- initial status: `active`;
- command: `audience live-pilot --okved 43.11 --year 2025 --max-companies 10`;
- runtime: PostgreSQL exactly `127.0.0.1:5433/okved`, MinIO exactly
  `http://127.0.0.1:9000`, bucket exactly `okved-raw`.

The checksum is the lowercase SHA-256 of the exact canonical JSON policy
document, using the existing checksum function. The implementation and policy
documentation record the resulting exact checksum. A checksum mismatch,
non-active status, or clock value after the expiry blocks before PostgreSQL,
S3, browser, guard, or run construction.

## Historical evidence boundary

Run `50b2909b-0171-45d6-ae17-7c805ff49be6` and its non-terminal discovery task
remain unchanged. No repair, terminalization, deletion, or reuse is allowed.
The 2026-08-26 evidence report remains byte-for-byte historical evidence.

Policy v1 remains recorded as consumed. Policy v2 uses its own scope key and
durable guard row. The guard does not reinterpret v1 as v2 and does not make
the previous run disappear from database audits.

## Execution flow

### Before live access

1. Add policy v2 and its exact checksum; preserve policy v1 as consumed history.
2. Add expiry validation before client construction.
3. Add RED/GREEN tests for v1 rejection, v2 activation, expiry, checksum,
   concurrency, and one-shot consumption.
4. Independently review the policy diff and run the complete non-live gate.
5. Start only the tracked `okved-parser` services and apply migrations 002 and
   003 to the preserved database. Migration changes schema only; it does not
   alter the first run or task.
6. Audit the old run, database identity, MinIO identity, headed-browser
   availability, and current approved entry points.

### The single replacement attempt

Execute exactly once:

```bash
APP_MODE=live LIST_ORG_LIVE_ENABLED=true FNS_LIVE_ENABLED=true DATABASE_URL=postgresql://okved:okved-local-password@127.0.0.1:5433/okved S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=okved-raw S3_ACCESS_KEY_ID=okved-local S3_SECRET_ACCESS_KEY=okved-local-secret npm run audience -- live-pilot --okved 43.11 --year 2025 --max-companies 10
```

The guard consumes policy v2 before the run UUID and before source access. A
crash after guard acquisition still consumes the attempt.

The browser stays headed and sequential. If CAPTCHA appears, the same browser
session remains open while the operator solves it manually. The command resumes
only after `continue`. `abort`, EOF, failed revalidation, `403`, soft block,
contract drift, transport block, or policy violation ends the run as `blocked`.

No terminal result authorizes an automatic replacement.

### After the terminal result

1. Audit the exact new run ID and its PostgreSQL/S3 provenance.
2. Record success or failure in a new sanitized evidence report without
   rewriting the first report.
3. Commit the terminal policy-v2 snapshot with status `consumed`, record its
   consumption timestamp, and recompute its checksum. Preserve the active
   snapshot checksum in the policy history and guard row, and record both
   checksums in the policy documentation. Runtime remains disabled on fresh and
   preserved databases.
4. Stop owned services without `-v`; preserve both volumes.

If the command has not started before the expiry timestamp, change nothing and
request a new explicit authorization. Do not extend the expiry in place.

## Success and audit invariants

A successful replacement pilot requires all of the following for the new run:

- exactly 10 ordered unique legal-entity INNs;
- exactly 10 run-scoped `43.11` relations;
- exactly one successful `live_discovery` task;
- exactly one verified `live_revexp_capture` task and archive;
- exactly 10 successful company-owned `live_finance` tasks;
- exactly 30 terminal 2025 metric outcomes;
- each value or `no_data` linked to exact verified raw provenance;
- zero unexplained run-scoped uploads or source fetches;
- zero non-terminal tasks;
- successful reconciliation and a sanitized terminal report.

Failure remains valid evidence but does not meet the data-loading objective. It
must still leave the v2 attempt consumed and all created tasks terminal or
durably explained.

## Testing and review

The implementation must prove without public traffic:

- consumed v1 cannot activate;
- active, unexpired, checksum-valid v2 reaches the guard;
- expired or modified v2 fails before any client constructor;
- two concurrent v2 callers acquire at most one guard;
- an existing v1 run does not consume the distinct v2 scope;
- one v2 guard rejects every later v2 call on the same database;
- fixture and reconciliation commands are unchanged;
- migrations 001–003 remain reversible on a disposable database;
- the full non-live suite and TypeScript build pass.

The live attempt occurs only after an independent task review is clean. No code
or selector adjustment is allowed during the live command. Any observed public
contract drift ends the attempt and requires a new explicit decision.
