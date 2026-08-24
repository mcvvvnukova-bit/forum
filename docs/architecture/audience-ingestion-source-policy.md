# Audience ingestion source policy

## Decision

Only fixture mode is permitted for the audience parser.

- The List-Org browser source may access only the fixture server origin on loopback.
- FNS BFO and revexp data may be read only from repository fixtures.
- Live List-Org discovery is disabled.
- Live FNS BFO access is disabled.
- A blocked run is terminal and is never resumed. Start a new run after the cause is reviewed.
- IP or proxy selection is not part of this slice. It remains a separate stage-2 decision.

This policy records no live canary, external authorization, or permission to contact a live source.

## Enforced fixture controls

The executable rejects live URLs, IP and proxy controls, unbounded traversal, and fixture mode
with `LIST_ORG_LIVE_ENABLED=true`. Chromium allows the declared loopback fixture origin and blocks
all other request origins. Fixture discovery requires explicit page and company limits.

Terminal block reasons are:

- `captcha`
- `http_403`
- `soft_block`
- `policy_block`
- `contract_drift`

These reasons do not authorize retries against the same run.

## Live activation gate

Each live source needs its own approved record. Approval for one source does not enable another.
Until every field below is complete and reviewed, the source stays disabled in configuration,
deployment, CLI, worker, and network policy.

| Required field | Live List-Org | Live FNS BFO |
|---|---|---|
| Named accountable owner | Unassigned; gate not met | Unassigned; gate not met |
| Decision date | Not approved | Not approved |
| Decision expiry or review date | Not approved | Not approved |
| Authorized routes and HTTP methods | Not approved | Not approved |
| Authorized browser or API actions | Not approved | Not approved |
| Immutable policy checksum | Not issued | Not issued |
| Requests-per-time-window limit | Not approved | Not approved |
| Maximum concurrency | Not approved | Not approved |
| Raw, evidence, and log retention periods | Not approved | Not approved |
| Terminal block reasons and operator action | Fixture list only; live decision absent | Fixture list only; live decision absent |
| Credentials and secret owner, if required | Not approved | Not approved |
| Legal and source-terms approval reference | Not approved | Not approved |

The approved record must name exact routes. Wildcards such as an entire origin are insufficient.
It must enumerate permitted actions, including navigation, form submission, pagination, downloads,
and any retry. It must define fixed rate and concurrency values, not “reasonable use.”

The policy checksum must cover the approved owner, dates, expiry, routes, actions, limits,
terminal responses, and retention rules. Runtime configuration must reference that checksum.

## Activation and expiry behavior

Activation requires a code change and review after the source record is approved. There is no
runtime escape hatch in this slice. On expiry, checksum mismatch, missing owner, or missing route,
the source remains disabled and the attempted run ends with `policy_block`.

CAPTCHA, HTTP 403, soft blocking, contract drift, and policy blocking are terminal. Operators must
not resume the run, rotate an IP, add a proxy, or broaden a route. They must preserve evidence,
notify the named owner, and create a new run only after a new valid decision permits it.

## Future decisions outside this slice

- Live List-Org source authorization and canary design.
- Live FNS BFO transport and authorization.
- Full traversal of all 967 selected codes.
- Stage-2 IP strategy, if separately justified and approved.
- Production retention, deletion, and legal-hold automation.
