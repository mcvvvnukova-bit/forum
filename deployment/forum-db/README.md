# Forum database operations

The API authentication store is `forum.public`, using restricted runtime login `forum_app`. Sber provider test/production mode is independent of the database name. PROJ-156 explicitly authorizes transferring the legacy `forum_sber_sandbox` data and deleting that database after verified cutover. Current target/roles/ledger/backup must still be freshly verified before any database operation.

The historical September15 observation is preserved by source pins and private/history originals. Needed product/profile decisions are extracted to Outline through [the migration register](../../artifacts/repository-audits/document-migration-manifest.json); deployment records are not current requirements or proof of a fresh apply.

## Owned entrypoints and checks

[apply-public.psql](apply-public.psql) runs migrations001–003,005 and006 in one transaction with `lock_timeout`, `statement_timeout`, advisory locking and the migration ledger. [apply-profiles.psql](apply-profiles.psql) is the compatibility redirect to that entrypoint. It refuses conflicting public/legacy ledgers and inconsistent consolidation markers. Original migrations remain unchanged in [the API owner](../../apps/api/migrations/003_public_schema.sql).

From the repository root, using an explicitly selected authorized schema-owner connection:

```sh
psql -X -v ON_ERROR_STOP=1 -d forum -f deployment/forum-db/apply-public.psql
```

Do not copy migrator credentials into the runtime role. Main `public` grants in [grant-runtime.sql](../forum-api/grant-runtime.sql) are not adapted to sandbox by a name substitution. The API owner migrator installs001–003,005 and006 on a clean database or applies missing005/006 to a consolidated public layout; it rejects existing legacy ledgers rather than attempt migration002 on populated users.

## Historical PROJ-156 legacy authentication transfer and cutover

The following records the completed PROJ-156 transfer contract; its migration005 precondition belongs to that historical release. Current deployment and readiness require006. The importer retains005 compatibility and also supports the upgraded005/006 layout.

1. Verify database names, owners, ledgers, table inventory, counts, runtime consumers and grants. Save private full custom-format dumps of both databases plus runtime/credential-file configuration. Restore both into isolated PostgreSQL with the original owner and grant roles; do not use `--no-owner` or `--no-privileges` as recovery proof.
2. Build the exact checked/committed API source. Apply the public migration005 explicitly as owner; keep original001–004 unchanged. Verify the existing `forum_app` allowlist and isolation without resetting its password or widening database access.
3. Stop the old authentication API before the final source snapshot/export. Save a final private source dump, then run [export-legacy-auth.psql](export-legacy-auth.psql) through `psql -X -q -At -v ON_ERROR_STOP=1` on the source. Redirect stdout into a `0600` private JSON file. It contains sensitive authorization state and session hashes and must never enter Git or public evidence.
4. Execute `node dist/consolidate-auth.js /private/owner-url /private/source.json` from the accepted API image. Both input files must be private; owner URL must select `forum`. The importer requires migration005, locks the identity tables, refuses a nonempty destination/unknown source shapes or ambiguous profiles, compares every original typed column and commits once. It preserves all eight data tables; it builds persons from recorded verified snapshot times and adds personal memberships. Requested historical scopes remain empty because no historical scope evidence was recorded. The existing main migration ledger remains authoritative; keep the source ledger in the private snapshot.
5. Switch the runtime database URL file to `forum`/`forum_app`, keeping the other Sber, cookie, TLS, DNS and callback settings. Start the accepted image, verify readiness and runtime `current_database()/current_user`, unchanged source-column fingerprints/counts, referential constraints, unchanged directory data, existing sessions, and a fresh Sber test-account login. Keep credentials and real user data private.
6. Before dropping the source, verify no service, job, prepared transaction, replication slot or subscription depends on it. Close only the identified source connections, including idle administrative sessions. Delete `forum_sber_sandbox` only after the completed checks and explicit task authorization. Confirm its absence from `pg_database` and continued main API/browser function. Preserve final dump/export and rollback configuration.

Before source deletion, a failed cutover stops the new API, restores its previous configuration/image and resumes the retained source. Imported main data is additive; do not delete it to roll back an application. After deletion, recovery requires the final verified source dump and original owner/ACL roles. Record component revisions and sanitized runtime evidence according to [release requirements](../release.md).

[bootstrap](../../scripts/deployment/forum-db/bootstrap_forum_db.sh) and [runtime-role configuration](../../scripts/deployment/forum-db/configure_forum_app_role.sh) retain explicit ownership. Before applying verify current database/user/schema/ledger/role and preserve a private restorable dump plus ownership/ACL evidence. Check grants with isolated synthetic data rather than actual user payloads.

SQL checks: [profiles.sql](tests/profiles.sql), [public-schema.sql](tests/public-schema.sql), [role contract](tests/test_configure_role_contract.py). Restore and migration checks must cover clean install, repeat apply, conflict refusal, transaction rollback, schema/table/function/sequence identity, ownership/ACL and separate sandbox-role denial. Historical test counts are not a passing result for a changed candidate.

## Current person and membership migration

Apply006 as schema owner after a verified restorable backup. It preserves canonical
person values and recorded source timestamps, backfills explicit legacy provenance,
and keeps existing grants active. New accounts need no participant. Runtime profiles
read canonical data; returning login updates provider snapshots independently.
Corporate registration, membership, administrator authority and scoped grant state
have separate bases and lifecycles; a company creator receives no implicit authority.

[grant-runtime.sql](../forum-api/grant-runtime.sql) reconciles a fresh installation's
explicit allowlist and requires006 before any mutation. For an existing installation
with unrelated reference-table ACLs, use a reviewed narrow incremental grant transaction
for the new tables/functions, SELECT(name) ledger read and UPDATE(status,revoked_at)
columns; do not apply the blanket public ACL reconciliation to those live policies.
Readiness must reject missing006 or any of these required source/grant write privileges.

## Recovery

Application rollback preserves additive identity data. Destructive down-migrations are not supplied by the API authentication owner. A database rollback/forward fix requires a scoped task, validated restorable backup and explicit target; `--no-owner --no-privileges` restore proves readability but not ownership/ACL recovery. Record commands/results and source→apply→verified-schema evidence according to [release requirements](../release.md), keeping database dumps and personal values private.
