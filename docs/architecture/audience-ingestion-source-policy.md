# Audience ingestion source policy

## Decision

Fixture mode is the only authorized execution mode for the audience parser.
Both historical live-pilot authorizations are consumed; no live exception is
currently active.

- The List-Org browser source may access only the fixture server origin on
  loopback.
- FNS BFO and revexp data may be read only from repository fixtures.
- Live List-Org discovery and live FNS access are disabled because the current
  production policy is consumed.
- A blocked run is terminal and is never resumed. A new run requires an applicable
  authorization after the cause is reviewed.
- IP or proxy selection is not part of this slice. It remains a separate stage-2 decision.

The first bounded live-pilot authorization was consumed on 2026-08-26. The
distinct v2 authorization was consumed by its sole terminal command on
2026-08-27. Their immutable history is preserved below.

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

## Consumed second live-pilot exception

This distinct one-shot authorization terminated as `blocked` with
`policy_block`. It is historical evidence, not permission for another command.

| Field | Reviewed value |
|---|---|
| Status | `consumed` at `2026-08-27T08:39:58Z` |
| Accountable owner | `Veronica — АСТ Форум repository operator` |
| Scope key | `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02` |
| Reviewed at | `2026-08-27T09:40:50+03:00` |
| Expires at | `2026-08-27T21:40:50+03:00` |
| Command | `audience live-pilot --okved 43.11 --year 2025 --max-companies 10` |
| Run scope | OKVED `43.11`; year `2025`; `dryRun=true`; at most 2 pages; exactly 10 accepted legal entities; active and inactive entities; `revenue`, `income`, and `expenses` |
| Reviewed origins, routes, actions, limits, and retention | Exactly the v1 contract enumerated above: no added origin, route, action, concurrency, or retention exception |
| Active guard checksum | `59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542` |
| Consumed runtime checksum | `87f9294a8c9175d754757bb55ad6bc470dae379575079fd60d851d4e3165adae` |
| Terminal result | Run `8da208ea-2bff-44a6-a94f-431bbe5f97e7`; `blocked` / `policy_block`; command exit code `1` |

The v2 guard is keyed by its v2 scope key and preserves the active checksum
above. The current runtime binds the consumed checksum and rejects before public
resource construction. No third attempt is authorized.

## Live activation gate

Each future live source needs a new explicit approved record. Approval for one
source does not enable another. The record must name an accountable owner,
decision and expiry dates, exact methods and routes, actions, fixed request and
concurrency limits, terminal responses, retention rules, and an immutable
checksum. Until all fields are reviewed, the source stays disabled in
configuration, deployment, CLI, worker, and network policy. There is no current
exception.

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

- Any new Live List-Org or FNS authorization; this includes any third attempt.
- Full traversal of all 967 selected codes.
- Stage-2 IP strategy, if separately justified and approved.
- Production retention, deletion, and legal-hold automation.
