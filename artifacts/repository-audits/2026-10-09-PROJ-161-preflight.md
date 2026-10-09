# PROJ-161: implementation and database preflight

Recorded on 9 October 2026. Implementation source: `446255e49d790f7ef02575109cc417aa97c42e9c`, based on `e6a910c4aa7f5795a1c178a47c64a1dc5aea9875` (PR #30).

**State: prepared; live application blocked.** Migration 006 has been applied only to an isolated restored copy. Main `forum`, the active DEV API and the served DEV web release have not been changed by this task. This preflight receipt does not establish publication.

## Implemented contract

- `persons` has ordinary canonical profile columns and optional deprecated Sber metadata. The required Sber ownership link, generated provider constant and required source snapshot have been removed. `identity_providers` and `identity_profiles` separately record configured identity sources, ownership, scopes and received times.
- New authentication creates a user, person, external identity/source record and session without a participant, provider grant or ParticipantRegistered event. Active personal accounts receive baseline `individual`; absent, revoked or deactivated personal business participation does not invalidate their personal session/profile.
- Company registration, organization membership, administrator authority and scoped employee grants have separate states, provenance and effective times. Effective business access requires all relevant active states and independently confirmed administrator authority. Grant/membership/authority revocation leaves the personal account available.
- Existing IDs, person values, participants, grants, sessions and events are preserved. Provider linking never uses contact equality. Future provider adapters and company workflow/UI integration are separate work; no additional real provider has been connected here.

## Verified source and tests

API 82/82, affected frontend 30/30, real network-isolated PostgreSQL ACL contracts 14/14, full verification 115/115, the current operational validator (354 provenance entries), build/typecheck and strict repository layout passed. The 115-test run took 721,311 ms locally. Separate RED scenarios discriminated mandatory participation, false readiness and broken provenance before fixes.

Scoped independent review closed four Important findings (readiness, portable test endpoint, provisioning fixtures/preflight, ownership chain), a documentation correction and the CI timeout fix. The final source changes in 446255 are only the layout timeout from 20 to 40 minutes and the corresponding ownership pins; all tests and other job limits remain enabled and unchanged. Relevant ownership/quality contracts 12/12 passed after that fix.

## Restored-database and actual-image evidence

The full custom-format `forum` backup, globals, original row-content hashes, object owners and ACL snapshots are stored privately under a task-specific 0700 server directory; files are 0600. A restore into isolated `forum_proj161_restore_test` initially matched every public table's counts/content and original owners/ACLs. PUBLIC CONNECT is revoked on that clone.

Reviewed migration 006 was clone-applied through the owner entrypoint. Every original public column value remained identical; original owners and ACLs remained identical except removal of the obsolete personal-participant function. Added objects/column grants were additive. A second owner-entrypoint application changed no original data and left one 006 ledger entry.

- Migration 006 SHA256: `6fe84ea063406bc8ec9033a62217df98e99e84bfe9d49274cf1e1366653be6c4`.
- Canonical root lock SHA256: `6129529b156384a535b93bcdba332a9d97aff14f50e96b7ba996e4dabb69da38`.
- Built candidate: `astforum/forum-api:proj161-446255e4`.
- Candidate immutable image ID: `sha256:83c15099de0d784f69db80e3c5397204648945ae0b52414f2b2a62cdf9ee4049`.
- Image revision label matches source 446255; actual image runtime is Node v24.21.0. Local/CI tests used Node v24.18.1, both within the declared Node 24 range.

The actual candidate image was exercised against the restored clone with SQL current_user `forum_app_role`. A clone-only configured second provider created a profile/session with `participant=null`, baseline `individual` and no business membership. Independently edited canonical values survived returning authentication; readiness returned 200. Synthetic accounts exist only in that clone, never in main `forum`.

Candidate configuration was privately compared with the active container and previous effective Compose configuration: application environment, read-only secret mount, networks, proxy/DNS settings, security options and healthcheck are preserved. General-reference-table ACLs are outside the migration delta and must remain intact; the fresh-install blanket grant script is not used live. Runtime ledger access is `SELECT(name)` only.

## Current live state and publication gate

Latest direct verification: main `forum` has no 006 ledger marker; active API remains `astforum/forum-api:proj160-a03cab0c`, healthy. The existing served DEV web source is `e6a910c4aa7f5795a1c178a47c64a1dc5aea9875`. Its 49 artifact files matched mounted/origin/HTTPS hashes; the existing gateway cookie still works and grants no personal account API access (session/profile 401). Production and independently owned files have not been modified.

Source 3232 CI run [37934454944](https://github.com/mcvvvnukova-bit/forum/actions/runs/37934454944) passed nine component jobs. Layout exceeded its 20-minute job budget and was canceled before reporting assertions. The run is not successful as a whole. Its exact DEV build artifact 11618270585 was downloaded and validated for preparation only; it has not been published.

Source 446255 CI run [37939236946](https://github.com/mcvvvnukova-bit/forum/actions/runs/37939236946) failed before any job steps started. GitHub's check annotation states that recent account payments failed or its spending limit must be increased. No billing setting has been changed. There is no accepted successful CI run/artifact for 446255, so main migration, service recreation and DEV web publication remain pending.

After CI becomes available, select the exact successful source/run/artifact, refresh the private backup and target/config comparisons, and use the existing atomic DEV publisher with retained assets, verified rollback and origin/HTTPS/IAB proof. Publish the compatible frontend before changing the API so new participant-free sessions do not reach the preceding frontend guard. Its baseline/legacy-participant compatibility is covered by the existing intent tests.

The previous API image cannot fully support newly created accounts without personal participants. Application recovery after additive migration must use an explicitly pinned compatible image and retain all newly acquired data; neither fabricate participants/authority nor undo the schema by deleting data.

## Reviewable delivery

[PR #32](https://github.com/mcvvvnukova-bit/forum/pull/32), [PROJ-161](https://roadmap.astforum.ru/work_packages/PROJ-161). GitHub linkage is verified under Кузьмина (ID 8) for PROJ-161, parent PROJ-35 and related PROJ-38/40/44/45/46. The PR remains a draft while the required publication gate is blocked.

Private backup contents, credentials, person/session/provider values, full raw operational inventories and gateway cookies are excluded from this receipt and Git.
