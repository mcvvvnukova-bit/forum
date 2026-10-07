# Public Schema Consolidation Implementation Plan

Исторический технический план от 2026-09-15. Статусы и результаты ниже относятся к исходному наблюдению, не подтверждают текущий runtime и не разрешают новый запуск или публикацию. Перед исполнением сверить актуальный код, канонические требования и отдельно разрешённую задачу.

Действующие требования: [IAM.01.01: Регистрация пользователя через Сбер ID](https://docs.astforum.ru/doc/iam0101-registraciya-polzovatelya-cherez-sber-id-NhU2UVa44I).

Происхождение: `docs/superpowers/plans/2026-09-15-public-schema.md`, SHA-256 `cd4b5e2d88d16d87ec801c10d740fa7381a45fd27da36b7230ae892b53749bd2`. Проверка сохранения указана в [реестре миграции](../../artifacts/repository-audits/document-migration-manifest.json).

> **For agentic workers:** Use superpowers:executing-plans for the sequential database rollout, with a bounded independent SQL review before production application.

**Goal:** Move every application object in the working `forum` database into `public`, as explicitly requested by the user.

**Architecture:** Migration 003 moves existing objects with `ALTER ... SET SCHEMA`, preserving data, object identities, dependencies and object privileges. Replace schema-qualified references inside moved PL/pgSQL bodies, move the migration ledger, and drop the empty source schemas without CASCADE. Preserve migrations 001/002 as historical migrations.

**Tech Stack:** PostgreSQL 18.6, psql, SQL, existing SSH/Docker maintenance access.

## Global Constraints

- Only the `forum` database is in scope. System schemas and other databases, including `forum_sber_sandbox`, remain intact.
- Initial inventory: 21 application tables, seven profile functions, one existing public function, and one owned outbox sequence; schemas `public`, `iam`, `profiles`, `audit`, `integration`.
- Preserve table ACLs, data, generated expressions, constraints, trigger bindings and sequence values. No compatibility schemas or views recreating old namespaces.
- Existing API already requires integration with migration 002 and runs separately on Sandbox. Do not expand this database task into full onboarding implementation or deploy a changed API. Guard its legacy migrator against accidentally recreating `iam` in a consolidated database.
- Work in the current task directory: the database deployment and API files from the preceding authorized work are uncommitted/untracked here. A checkout from committed HEAD would omit the actual migration baseline. Do not commit unrelated files or alter another worktree.
- User authorization covers the reviewed and tested live migration; no additional approval checkpoint is required.

### Task 1: Migration and repeatable entrypoint

Files: `apps/api/migrations/003_public_schema.sql`, `deployment/forum-db/apply-public.psql`, `deployment/forum-db/apply-profiles.psql`.

- [x] Assert no source/public relation or function-signature collisions before changing anything.
- [x] Move all 12 tables from the four source schemas using `ALTER TABLE ... SET SCHEMA public`. Owned sequences and indexes move with their tables.
- [x] Move seven functions and replace references to `profiles.participants`/`profiles.persons` in the three trigger-function bodies with `public` references.
- [x] Drop only empty source schemas using `DROP SCHEMA ...` without CASCADE. Preserve object ACLs and public CREATE restrictions.
- [x] Apply 001/002 when needed, then 003, under the existing advisory lock and a single transaction. Use `public.schema_migrations` after the move and reject simultaneous legacy/public ledgers. Make both deployment entrypoints safe to rerun.

### Task 2: Behavioral and migration checks

Files: `deployment/forum-db/tests/profiles.sql`, `deployment/forum-db/tests/public-schema.sql`, `apps/api/src/migrate.ts`, `apps/api/test/migrate.test.ts`.

- [x] Restore a fresh real backup into an isolated PostgreSQL 18 container without published ports.
- [x] Confirm the new public-schema assertion fails before 003.
- [x] Seed synthetic person/organization/member/role/audit/outbox records only in the copy; save row fingerprints, object OIDs, ACLs and sequence state.
- [x] Run 003 inside BEGIN/ROLLBACK, confirm original schemas remain; then apply the entrypoint twice and verify preservation and no legacy namespaces or stale function references.
- [x] Run the full existing profile behavior suite against public, also as the runtime role. Verify grants are unchanged and Sandbox role gains no table/function privileges.
- [x] Guard the legacy API migrator when `public.schema_migrations` exists; unit-check rollback/release and absence of legacy DDL. Typecheck/build the API; no API schema rewrite or deployment in this task.
- [x] Independently review the migration and results; resolve substantive findings before production.

### Task 3: Apply and record

Files: `deployment/forum-db/PUBLIC-DEPLOYMENT.md`, existing deployment/requirements documents and API README.

- [x] Save a root-only custom-format backup, a schema dump, table fingerprints/counts, object ACL/OID/constraint snapshots and Sandbox baseline immediately before deployment.
- [x] Stage exact SQL files under `/opt/forum-db/releases/20260915-public/`; apply against `forum` as its schema owner and capture the log.
- [x] Verify only `public` remains among application schemas, all 21 tables exist, all non-ledger fingerprints and object identities/ACLs match, ledger includes 003, and FK/trigger/function/sequence checks pass. Compare Sandbox snapshot and API health.
- [x] Update current documentation to public names, retaining historical deployment records with supersession notes; record backup path/hash and limitations.
- [x] Remove only the test container and temporary copies created for this task. Check the final diff; leave all unrelated work intact.

## Completion record

Completed 2026-09-15 at 18:57:28 UTC. Migration 003 committed in forum; only public remains among application schemas, with 21 tables. Live before/after snapshots match after normalizing the intended namespace change and excluding the new migration marker. Populated-copy, rollback, repeat, fresh-install, name-collision, owner/runtime behavior and grant-preservation checks passed. API typecheck/build and legacy-migrator test passed. Independent SQL review approved. Sandbox schema, migration ledger and user count are unchanged; deployed API remains healthy. Test container and temporary files removed. See deployment/forum-db/PUBLIC-DEPLOYMENT.md for backup and evidence.
