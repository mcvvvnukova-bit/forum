# Audience ingestion source policy

## Decision

Fixture mode is the only currently authorized execution mode for the audience
parser.

- The List-Org browser source may access only the fixture server origin on loopback.
- FNS BFO and revexp data may be read only from repository fixtures.
- Live List-Org discovery is disabled.
- Live FNS BFO access is disabled.
- A blocked run is terminal and is never resumed. A new run requires an applicable
  authorization after the cause is reviewed.
- IP or proxy selection is not part of this slice. It remains a separate stage-2 decision.

One bounded live-pilot authorization was reviewed and consumed on 2026-08-26. Its
record is below. It grants no permission for another live attempt.

## Enforced fixture controls

The executable rejects live URLs, IP and proxy controls, unbounded traversal, and fixture mode
with `LIST_ORG_LIVE_ENABLED=true`. Chromium allows the declared loopback fixture origin and blocks
all other request origins. Fixture discovery requires explicit page and company limits.

Terminal block reasons are:

- `captcha`
- `captcha_aborted`
- `http_403`
- `http_failure`
- `soft_block`
- `policy_block`
- `contract_drift`
- `transport_failure`
- `duplicate_conflict`

These reasons do not authorize retries against the same run.

## Consumed live-pilot exception

The following record is the exact one-shot exception reviewed for the 2026-08-26
attempt. The runtime binds it to an immutable SHA-256 checksum and a durable
scope guard.

| Field | Reviewed value |
|---|---|
| Status | `consumed` on 2026-08-26 |
| Accountable owner | `Veronica — АСТ Форум repository operator` |
| Scope key | `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26` |
| Command | `audience live-pilot --okved 43.11 --year 2025 --max-companies 10` |
| Run scope | OKVED `43.11`; year `2025`; `dryRun=true`; at most 2 pages; exactly 10 accepted legal entities; active and inactive entities; `revenue`, `income`, and `expenses` |
| Owned runtime | PostgreSQL exactly `127.0.0.1:5433/okved`; MinIO exactly `http://127.0.0.1:9000`; bucket exactly `okved-raw` |
| Immutable checksum | `b148497ffd55d725079055e19b85aa997017ccda51c1557ba23dc5d49c18a24a` |
| Retention | Immutable minimized raw evidence; no screenshots, action traces, CAPTCHA, cookies, or session material |

The reviewed public origins were exactly:

- `https://www.list-org.com`
- `https://bo.nalog.gov.ru`
- `https://www.nalog.gov.ru`
- `https://file.nalog.ru`

The reviewed routes and route contracts were exactly:

- `https://www.list-org.com/search`
- `https://www.list-org.com/company/<visible-id>`
- `https://bo.nalog.gov.ru/`
- one exact visible, same-origin BFO GET form or link destination, authorized
  one-shot and revalidated after navigation
- `https://www.nalog.gov.ru/opendata/7707329152-revexp/`
- `https://file.nalog.ru/opendata/7707329152-revexp/<validated-2025-archive>.zip`

The reviewed actions and limits were:

- two List-Org result pages and 12 sequential organization-card inspections
- 10 sequential BFO 2025 report inspections
- one revexp metadata resolution and one archive download
- one concurrent browser request and one concurrent archive request
- 268,435,456 compressed archive bytes and 1,073,741,824 expanded archive bytes
- 12 source occurrences yielding 10 accepted companies after the explicit
  individual-entrepreneur and duplicate-INN skips

The exception does not authorize an origin wildcard, an arbitrary same-origin
path, another command, or a replacement attempt. A prior scoped attempt in any
state consumes the scope.

## Live activation gate

Each future live source needs a new explicit approved record. Approval for one
source does not enable another. The record must name an accountable owner,
decision and expiry dates, exact methods and routes, actions, fixed request and
concurrency limits, terminal responses, retention rules, and an immutable
checksum. Until all fields are reviewed, the source stays disabled in
configuration, deployment, CLI, worker, and network policy.

Wildcards such as an entire origin are insufficient. A future record must
enumerate navigation, form submission, pagination, downloads, and retries. It
must define fixed values rather than “reasonable use.”

## Activation and expiry behavior

Activation requires a code change and review after a new source record is
approved. There is no runtime escape hatch. A consumed scope, checksum mismatch,
missing owner, or missing route leaves the source disabled and ends an attempted
run with `policy_block`.

All terminal block reasons listed above forbid resuming the run, rotating an IP,
adding a proxy, or broadening a route. Operators preserve evidence, notify the
named owner, and create a new run only after a new valid decision permits it.

## Future decisions outside this slice

- Any new Live List-Org or FNS authorization after the consumed 2026-08-26 scope.
- Full traversal of all 967 selected codes.
- Stage-2 IP strategy, if separately justified and approved.
- Production retention, deletion, and legal-hold automation.
