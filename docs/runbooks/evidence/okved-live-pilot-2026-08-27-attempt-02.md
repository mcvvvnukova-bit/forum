# OKVED 43.11 live-pilot evidence — attempt 02

## Authorization and terminal outcome

- Active policy checksum: `59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542`
- Consumed policy checksum: `87f9294a8c9175d754757bb55ad6bc470dae379575079fd60d851d4e3165adae`
- Scope key: `okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02`
- Live-command executions: `1`
- Command exit code: `1`
- Safe terminal message: `live pilot discovery blocked`
- CAPTCHA status: not encountered
- Guard consumption timestamp: `2026-08-27T08:39:47.039066Z`
- Terminal policy-consumption timestamp: `2026-08-27T08:39:58Z`
- Run ID: `8da208ea-2bff-44a6-a94f-431bbe5f97e7`

The run and its sole `live_discovery` task are terminally `blocked` with reason
`policy_block`. No replay, revexp, finance, publication, or reconciliation phase
started. This terminal result does not authorize another attempt.

## Run-scoped audit

| Audit field | Actual |
|---|---:|
| Companies | 0 |
| OKVED 43.11 company relations | 0 |
| Successful `live_discovery` tasks | 0 |
| Successful `live_revexp_capture` tasks | 0 |
| Successful `live_finance` tasks | 0 |
| Terminal 2025 metric outcomes | 0 |
| Non-terminal tasks | 0 |
| Source fetches | 1 |
| Financial evidence rows | 0 |
| Committed upload intents | 1 |
| Unexplained upload intents | 0 |
| Unexplained source fetches | 0 |
| Reconciliation | not reached; run terminally blocked |
| Published | false |

No ordered company INNs or financial metric outcomes exist because discovery
blocked before accepting a company.

## Source attempt and immutable evidence

| Source | Record key | Attempt state | Object key | SHA-256 |
|---|---|---|---|---|
| `list-org-live` | `page:1` | `policy_block`; upload committed | `raw/8da208ea-2bff-44a6-a94f-431bbe5f97e7/list-org-live/a2f8f6f63353649dfbd7c04a3442e6e7487a0fbb2a67f1351cfe095df20437b2/manifest.json` | `a2f8f6f63353649dfbd7c04a3442e6e7487a0fbb2a67f1351cfe095df20437b2` |

The run-scoped MinIO audit verified the manifest checksum, identity, and retained
projection artifact checksum without displaying evidence payloads. Verified
source-fetch objects: `1`.

## Historical preservation

- Preserved v1 canonical row hash:
  `692da1674d45db5c34307a52611c66ecea4eff776d7592e802c7e6e38d5ad1f8`
- Preserved v1 evidence-file hash:
  `5fec20c18307f8b6cc1aa720da3dc4b8a90e00443138e4d58cf763bcae90a6a6`

Both hashes matched before and after attempt 02. The historical v1 evidence file
was not edited.

## Data minimization

This record contains no page body, query string, request or response header,
credential, cookie, browser session, CAPTCHA content, screenshot, or stack trace.
