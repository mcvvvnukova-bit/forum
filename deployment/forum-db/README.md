# Forum database operations

The main database `forum` and legacy authentication database `forum_sber_sandbox` have separate schema/grant boundaries. The main public-schema migration does not authorize switching the running authentication store or connecting the profile fixture. Current target/roles/ledger/backup must be freshly verified before any database operation.

The historical September15 observation is preserved by source pins and private/history originals. Needed product/profile decisions are extracted to Outline through [the migration register](../../artifacts/repository-audits/document-migration-manifest.json); deployment records are not current requirements or proof of a fresh apply.

## Owned entrypoints and checks

[apply-public.psql](apply-public.psql) runs migrations001–003 in one transaction with `lock_timeout`, `statement_timeout`, advisory locking and the migration ledger. [apply-profiles.psql](apply-profiles.psql) is the compatibility redirect to that entrypoint. It refuses conflicting public/legacy ledgers and inconsistent consolidation markers. Original migrations remain unchanged in [the API owner](../../apps/api/migrations/003_public_schema.sql).

From the repository root, using an explicitly selected authorized schema-owner connection:

```sh
psql -X -v ON_ERROR_STOP=1 -d forum -f deployment/forum-db/apply-public.psql
```

Do not copy migrator credentials into the runtime role. Main `public` grants in [grant-runtime.sql](../forum-api/grant-runtime.sql) are not adapted to sandbox by a name substitution. The legacy API migrator rejects a main `public.schema_migrations` installation rather than recreate IAM.

[bootstrap](../../scripts/deployment/forum-db/bootstrap_forum_db.sh) and [runtime-role configuration](../../scripts/deployment/forum-db/configure_forum_app_role.sh) retain explicit ownership. Before applying verify current database/user/schema/ledger/role and preserve a private restorable dump plus ownership/ACL evidence. Check grants with isolated synthetic data rather than actual user payloads.

SQL checks: [profiles.sql](tests/profiles.sql), [public-schema.sql](tests/public-schema.sql), [role contract](tests/test_configure_role_contract.py). Restore and migration checks must cover clean install, repeat apply, conflict refusal, transaction rollback, schema/table/function/sequence identity, ownership/ACL and separate sandbox-role denial. Historical test counts are not a passing result for a changed candidate.

## Recovery

Application rollback preserves additive identity data. Destructive down-migrations are not supplied by the API authentication owner. A database rollback/forward fix requires a scoped task, validated restorable backup and explicit target; `--no-owner --no-privileges` restore proves readability but not ownership/ACL recovery. Record commands/results and source→apply→verified-schema evidence according to [release requirements](../release.md), keeping database dumps and personal values private.
