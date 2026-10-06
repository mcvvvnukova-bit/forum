# Independent public-schema review — 2026-09-15

**Verdict:** Migration and runner changes approved by static review. Production application remains subject to the planned restored-database and privilege-preservation checks performed by the primary agent.

Reviewed `apps/api/migrations/003_public_schema.sql`, both deployment entrypoints, `apps/api/src/migrate.ts`, and its unit test against migrations 001/002 and `docs/superpowers/plans/2026-09-15-public-schema.md`.

No substantive correctness or security defects found in that scope. The migration moves the twelve source tables and seven functions using identity-preserving operations; rewrites all three known PL/pgSQL bodies with schema-qualified table references; leaves generated expressions, foreign keys and trigger bindings attached to the same objects; and removes source schemas without CASCADE. The runner uses a single transaction, migration lock and timeouts, rejects conflicting ledgers, and recognizes a completed rerun. The legacy migrator rejects a consolidated installation before creating IAM objects and releases the connection after rollback.

The adjacent validation issue in `deployment/forum-db/tests/profiles.sql:38` is resolved: the generated-column assertion now filters `table_schema='public'`.

Follow-up static review also approved `deployment/forum-db/tests/public-schema.sql`, `snapshot.sql`, `seed-public-transition.sql`, and `deployment/forum-api/grant-runtime.sql`. The snapshot normalizes the intended namespace move while retaining object identities, ACLs, data fingerprints and sequence state; the committed synthetic fixture is restricted to database names ending in `_test`; and runtime grants enumerate only the intended application tables, identity sequence and seven functions after checking migration 003. No broad privileges are granted over existing public objects. No unresolved correctness or security findings remain in the reviewed SQL. The primary agent was also asked to clarify the historical Sandbox grant-script description in `deployment/forum-api/README.md` during the planned documentation update.

This review did not access the live database or independently execute SQL. Actual OID/ACL/data/sequence preservation, effective runtime permissions, rollback behavior, repeated application and Sandbox isolation must be established by the primary agent's restored-database checks. The existing Sandbox API integration gap is outside this database consolidation scope.
