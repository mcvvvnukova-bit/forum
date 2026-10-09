# GitNexus Engineering Plan

> Task: PROJ-156 — consolidate Sber authentication into the main Forum database.
> Evidence verified at commit f0a8d54f3a1d293b218ed9f7cb220b18929960b4. CLI index matches source; MCP reports stale cache despite forced refresh, so graph findings are source-weighted.
> Evidence provenance schema 2; exact generated plan path excluded.

## 1. Objective
Transfer necessary authentication data to forum.public, switch the dev API and delete forum_sber_sandbox after verification.

## 2. Current Behaviour
[verified] AuthStore hardcodes iam, party, integration and audit tables (apps/api/src/iam/auth-store.ts:14). Health readiness probes iam.users (apps/api/src/app.ts:20).
[verified] Owner migrator rejects public installations (apps/api/src/migrate.ts:13). Real preflight: 2 source users/identities/participants/grants; 13 sessions/audit rows; 2 outbox rows. Main public identity tables are empty; 89 regions remain.

## 3. Relevant Architecture
[verified] Migration002 requires empty legacy identity tables and adds validated persons, membership foreign keys and deferred personal-participant constraints (apps/api/migrations/002_profiles.sql:1).
[verified] Migration003 moves identity objects into public (apps/api/migrations/003_public_schema.sql). Existing main grants authorize restricted forum_app; keep runtime separate from owner.

## 4. GitNexus Findings
[graph] impact(AuthStore, upstream, depth3): HIGH, five direct dependents: controller import, constructor, callback, session, logout; source confirms these accesses.
[graph] trace(AuthRuntime→AuthStore) reaches constructor. impact(createIndividualParticipant) reaches authenticate; migrate callers in tests need source supplement. api_impact reports two session consumers, with unconfirmed runtime metadata.
Graph cache disagrees with CLI freshness; it is navigation only. Source and integration checks govern implementation.

## 5. Statement-Level PDG Findings
PDG symbol probe could not resolve the qualified method; UID probe returned no edges. No PDG safety claim is made.
[verified] authenticate locks sorted subjects and commits session/account atomically; retain this order and rollback behavior (auth-store.ts:27-71).

## 6. Proposed Changes
[verified] Adapt AuthStore and participant helpers to public; identity must precede person, person precedes personal participant, membership precedes individual grant. Existing revoked membership must deny login/session without silently reactivating it.
[verified] Add public-only migration005 for individual role and matching-kind guard. Preserve original001–004 bytes. Adapt migrate for empty full installation, existing003 upgrades and explicit refusal of populated legacy layouts.
Add an owner import entrypoint: consume a private source export into temporary staging tables, reject nonempty target/unknown providers/ambiguous identity snapshots, preserve IDs/timestamps/columns, build minimal validated persons from verified reduced claims and memberships, copy data transactionally, advance outbox sequence, retain source ledger in a private receipt.
Add exact-path PROJ-156 ownership layer on top of immutable historical receipts, with tamper tests. Update current operational README and consolidation runbook.

## 7. Implementation Sequence
1. Commit this plan; add failing public/profile/membership/import tests.
2. Implement public store and owner migration; keep API routes and response shapes stable.
3. Implement strict transactional transfer and tests; finalize ownership receipt once source settles.
4. Run API, SQL, governance and CI checks; commit/push PR linked to PROJ-156 and parent PROJ-35.
5. Restore private backups with ownership/ACLs in an isolated PostgreSQL18.6 instance; build API from accepted commit.
6. Freeze old API, take final source dump/export, import main under owner and switch runtime to forum_app; verify counts/fingerprints/constraints/readiness and existing Sber user session.
7. Verify fresh Sber79010000001 sign-in; retire old consumers and drop source. Confirm old DB absence and continued main API function; save sanitized release evidence.

## 8. Test Strategy
[verified] Existing API auth tests use real PostgreSQL and mTLS fixture; expand registration, alias/repeat, concurrent login, blocked identity, rollback and membership cases. Migrator tests cover explicit layout refusal.
New importer tests exercise exact UUID/session preservation, source profile/timestamp validation, conflict refusal and transaction rollback. Owner/full dump restoration checks must preserve ACL/ownership, not use no-owner shortcuts.

## 9. Risk and Impact Analysis
HIGH store risk affects callback/session/logout/constructor and import; keep public response stable and verify all callers. Failed transfer or cutover retains source DB and backup; source deletion occurs only after runtime/browser/database evidence passes. No credentials go into Git or logs.

## 10. Files Expected to Change
API store, participant helper, app readiness, migrator, auth/migration/browser test SQL, migration005, import entrypoint/test, API/DB operational docs and verification ownership checks. Historical migrations and unrelated directory tables remain intact.

## 11. Reusable Implementation Context
```json
{
  "implementation_context": {
    "task_summary": "PROJ-156: consolidate Sber authentication into forum.public and retire source database",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "f0a8d54f3a1d293b218ed9f7cb220b18929960b4",
      "generated_plan_path": "docs/plans/2026-10-08-gitnexus-plan-main-forum-auth-migration.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
      },
      "cited_path_manifest": [
        {
          "path": "apps/api/migrations/002_profiles.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
          "index_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
          "worktree_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/migrations/003_public_schema.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8fe879b923a85b9e5331a84a473e45e1bd2901db7ee40463072653a30136cd8f",
          "index_digest": "sha256:8fe879b923a85b9e5331a84a473e45e1bd2901db7ee40463072653a30136cd8f",
          "worktree_digest": "sha256:8fe879b923a85b9e5331a84a473e45e1bd2901db7ee40463072653a30136cd8f",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/app.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ce1b222c87830245d82178deea625f357cb9655674754e9d15449a9761d6ccc9",
          "index_digest": "sha256:ce1b222c87830245d82178deea625f357cb9655674754e9d15449a9761d6ccc9",
          "worktree_digest": "sha256:ce1b222c87830245d82178deea625f357cb9655674754e9d15449a9761d6ccc9",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/iam/auth-store.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:bb5155f1585ac209e5814074563ab9cc4a9a5931af9ae85f5ab339ac833b9840",
          "index_digest": "sha256:bb5155f1585ac209e5814074563ab9cc4a9a5931af9ae85f5ab339ac833b9840",
          "worktree_digest": "sha256:bb5155f1585ac209e5814074563ab9cc4a9a5931af9ae85f5ab339ac833b9840",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/migrate.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:533b805fbd9e48e3cbfa0f28a16b12e23f042443552f312b2676f0e73b20d931",
          "index_digest": "sha256:533b805fbd9e48e3cbfa0f28a16b12e23f042443552f312b2676f0e73b20d931",
          "worktree_digest": "sha256:533b805fbd9e48e3cbfa0f28a16b12e23f042443552f312b2676f0e73b20d931",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/party/individual-participant.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1c084c9fc90293710a0c914292825bcc10dba1db6cf7574c65a29b94e658cc74",
          "index_digest": "sha256:1c084c9fc90293710a0c914292825bcc10dba1db6cf7574c65a29b94e658cc74",
          "worktree_digest": "sha256:1c084c9fc90293710a0c914292825bcc10dba1db6cf7574c65a29b94e658cc74",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/test/auth.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7a8dbf9be714b3b2e5f96e77fcdde7b5e9ce03c27365dbf61a21feceac86dda6",
          "index_digest": "sha256:7a8dbf9be714b3b2e5f96e77fcdde7b5e9ce03c27365dbf61a21feceac86dda6",
          "worktree_digest": "sha256:7a8dbf9be714b3b2e5f96e77fcdde7b5e9ce03c27365dbf61a21feceac86dda6",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/test/migrate.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6f224d2ec4d2e96ad330ea937901a3943ed52cc7275697ff9dbddb8dec04df52",
          "index_digest": "sha256:6f224d2ec4d2e96ad330ea937901a3943ed52cc7275697ff9dbddb8dec04df52",
          "worktree_digest": "sha256:6f224d2ec4d2e96ad330ea937901a3943ed52cc7275697ff9dbddb8dec04df52",
          "untracked_digest": "absent"
        },
        {
          "path": "deployment/forum-db/README.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:365a2557150ec22de4ad8e9bd13b9e4e3a35ad3b80272f3b2fbd014d04b1cf74",
          "index_digest": "sha256:365a2557150ec22de4ad8e9bd13b9e4e3a35ad3b80272f3b2fbd014d04b1cf74",
          "worktree_digest": "sha256:365a2557150ec22de4ad8e9bd13b9e4e3a35ad3b80272f3b2fbd014d04b1cf74",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/verification/check-operational-sources.py",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c5b192ab893ace0bcb765af3384f32d0c01212486d5b95b8d44448d4c0c15384",
          "index_digest": "sha256:c5b192ab893ace0bcb765af3384f32d0c01212486d5b95b8d44448d4c0c15384",
          "worktree_digest": "sha256:c5b192ab893ace0bcb765af3384f32d0c01212486d5b95b8d44448d4c0c15384",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/verification/checks.test.mjs",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:164486026f2c52129a64821e35d86bfce1fc9d43ea5afeb57336c296b7bd03e6",
          "index_digest": "sha256:164486026f2c52129a64821e35d86bfce1fc9d43ea5afeb57336c296b7bd03e6",
          "worktree_digest": "sha256:164486026f2c52129a64821e35d86bfce1fc9d43ea5afeb57336c296b7bd03e6",
          "untracked_digest": "absent"
        }
      ]
    },
    "acceptance_criteria": [
      "Preserve every source identity UUID, session, audit and outbox row",
      "Run API as restricted forum_app on forum.public",
      "Prove repeat/new/blocked login and membership revocation",
      "Restore both private backups and delete source only after cutover verification"
    ],
    "primary_symbols": [
      {
        "symbol": "AuthStore",
        "file": "apps/api/src/iam/auth-store.ts",
        "lines": "10-94",
        "role": "transactional authentication/session store"
      },
      {
        "symbol": "createIndividualParticipant",
        "file": "apps/api/src/party/individual-participant.ts",
        "lines": "4-9",
        "role": "personal participant creation"
      },
      {
        "symbol": "migrate",
        "file": "apps/api/src/migrate.ts",
        "lines": "7-32",
        "role": "owner migration entrypoint"
      }
    ],
    "related_symbols": [
      "AuthRuntime constructor",
      "AuthController.callback",
      "AuthController.session",
      "AuthController.logout",
      "HealthController.ready"
    ],
    "execution_path": [
      "Verify Sber identity",
      "Lock subject aliases",
      "Persist identity, person, personal participant, membership and individual grant atomically",
      "Issue opaque session",
      "Require active user and membership for existing sessions"
    ],
    "pdg_constraints": [],
    "architectural_patterns": [
      "Explicit SQL transactions and owner-run migrations; no ORM",
      "public persons are validated profile snapshots; memberships precede scoped grants"
    ],
    "files_to_modify": [
      {
        "file": "apps/api/src/iam/auth-store.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "apps/api/src/party/individual-participant.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "apps/api/src/app.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "apps/api/src/migrate.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "apps/api/test/auth.test.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "apps/api/test/migrate.test.ts",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "deployment/forum-db/README.md",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "scripts/verification/check-operational-sources.py",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      },
      {
        "file": "scripts/verification/checks.test.mjs",
        "intended_change": "Adapt SQL, tests or operational ownership for consolidated public schema"
      }
    ],
    "tests": [
      {
        "file": "apps/api/test/auth.test.ts",
        "scenarios": [
          "new/returning/blocked identities on public",
          "profile and membership persistence",
          "revoked membership cannot login/use old session"
        ]
      },
      {
        "file": "apps/api/test/consolidation.test.ts",
        "scenarios": [
          "import full legacy data without ID changes",
          "replay refused/conflicting target rolls back",
          "unknown or invalid profile fails without partial import"
        ]
      },
      {
        "file": "apps/api/test/migrate.test.ts",
        "scenarios": [
          "empty public install and repeat apply",
          "populated legacy installation rejected"
        ]
      }
    ],
    "verification_commands": [
      "npm run typecheck -w @astforum/api",
      "npm test -w @astforum/api",
      "npm run check:layout",
      "node --test scripts/verification/checks.test.mjs"
    ],
    "risks": [
      "AuthStore impact HIGH: callback/session/logout/constructor/import require regression coverage",
      "Source and destination schemas differ; do not run 002 against populated source",
      "Stop old API writes before final snapshot and import; preserve sessions and sequence",
      "Drop database is final irreversible stage after verified backups and main-runtime test"
    ],
    "assumptions": [
      "Current destination identity tables are empty; recheck within locked import transaction",
      "Current source identities include matching verified sub and real authentication timestamps; reject unsupported providers or ambiguous snapshots"
    ],
    "open_questions": [],
    "avoid": [
      "Do not alter migrations001-004 or historical ownership receipts",
      "Do not invent Professional fields or identity timestamps",
      "Do not expose credentials, dumps or cookies",
      "Do not publish production UI or remove unrelated databases/data",
      "Do not repeat completed source discovery"
    ]
  }
}
```

## 12. Assumptions and Open Questions
[assumed] Destination remains empty and source shape unchanged until freeze: recheck under transaction lock before import. Historical source requested scopes are unknown; keep empty array and retain only actual snapshot fields/timestamps.
Production frontend promotion and Professional-profile expansion are outside this task.

## 13. Definition of Done
Committed/pushed PR and verified OpenProject links; all checks pass; main runtime uses forum_app on public; identities/sessions/audit/outbox and directory data preserved; fresh real test login succeeds; restorable private backups exist; forum_sber_sandbox is absent and no active service depends on it.
