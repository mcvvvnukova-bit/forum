# Profiles database implementation plan

**Goal:** Create the approved persons, organizations, participants and memberships structure in the existing PostgreSQL database `forum`.

**Architecture:** Reuse the unchanged identity foundation `001_sber_identity.sql`, then apply `002_profiles.sql`. Move the empty participant table into `profiles`. One user can own one personal participant and hold independent memberships/roles in multiple organizational participants. The user explicitly authorized creation in the working database on 2026-09-15.

**Tech stack:** PostgreSQL 18.6, SQL migrations, psql, existing SSH/Docker maintenance access.

**Status:** Completed 2026-09-15. All three tasks are complete. The isolated behavioral
checks, app-role execution, idempotence, transactional rollback and backup restore
passed. Both migrations committed in `forum` at 14:30:01 UTC. The original public
schema/counts and Sandbox remained unchanged. See
[deployment record](../../../deployment/forum-db/PROFILES-DEPLOYMENT.md).

## Constraints

- Live inspection found only nine `public` business/directory tables and no `iam`, `party` or `profiles` schemas. Companies count is zero. Do not modify those public tables or existing default privileges.
- Keep Sandbox and the deployed authentication application unchanged. This delivery creates database structures; provider onboarding, switching contexts and backend integration are separate work.
- Preserve all 30 Sber package attributes and the documented extra `address`; use stored generated columns over one validated JSON snapshot to avoid inconsistent copies.
- A physical participant is always a provider and only its owner can be a member. Organizations support customer/provider participants. Legal-entity/entrepreneur identity and role grants are separate from a person's Sber identity.
- Existing nonempty identity data is a hard precondition failure for this first rollout; do not invent a backfill or move test identities into production.

## Task 1 — Behavioral SQL checks

Create `deployment/forum-db/tests/profiles.sql`. Run it against an isolated PostgreSQL 18 container with only migration 001; expect the explicit assertion that `profiles.persons` is missing to fail.

Verify full profile field projection, nested data, leading zeroes, missing-vs-false self-employment, ISO and documented dotted birthdate, foreign-key identity ownership, personal role restrictions, two organizational memberships, scoped access revocation, duplicate prevention and transaction rollback. Use synthetic fixtures only. All successful fixture writes are inside a transaction ending in `ROLLBACK`.

## Task 2 — Migration and repeatable entrypoint

Create `apps/api/migrations/002_profiles.sql` and `deployment/forum-db/apply-profiles.psql`. The entrypoint uses the existing `iam.schema_migrations` ledger and `forum-auth-migrations` advisory lock; applies 001 only when absent, then 002, recording both in the same transaction. Set lock timeout 5 seconds and statement timeout 60 seconds.

Create `profiles.persons`, `profiles.organizations`, move `party.participants` to `profiles.participants`, create `profiles.participant_memberships`, extend `iam.role_assignments` and link grants to memberships. Index foreign keys and unique identities. Add role/ownership constraints and immutable association checks. New table indexes may be built normally because no readers/writers use these new tables during transactional creation.

Use schema-owner execution. Explicitly grant the existing `forum_app_role` required DML without DDL or table deletion. Do not grant the Sandbox runtime access. Revoke public function execution and grant required validation/trigger helpers to the app role.

Run the SQL checks after migration, rerun the entrypoint to prove idempotence, and test rollback by wrapping both migrations in a transaction ending in `ROLLBACK` in a separate empty test database. Confirm data/catalogs remain absent afterward.

## Task 3 — Backup, apply, verify

Make a root-only custom-format `pg_dump` of `forum`, verify with `pg_restore --list`, save a schema-only dump and table counts. Stage only the two migration files and psql entrypoint under `/opt/forum-db/releases/20260915-profiles/`.

Run the entrypoint inside `outline-postgres-1` as `outline`, database `forum`. Verify migration ledger, new tables, generated columns, foreign keys, permissions, zero real identity rows and unchanged original public table counts/schema. Verify the separate Sandbox still has its original schema/ledger and the dev API remains healthy.

Record results and backup path in `deployment/forum-db/PROFILES-DEPLOYMENT.md`; update requirements/domain glossary with the approved multi-organization model. Remove the isolated test container. No automatic destructive down-migration after accepting user registrations: stop writes and use a reviewed restore if disaster recovery is needed; the migration transaction itself rolls back on failure.
