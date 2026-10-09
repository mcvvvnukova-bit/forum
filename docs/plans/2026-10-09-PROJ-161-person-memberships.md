# PROJ-161 Independent person account and company access implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and review. Execute the authorized scope without another approval round.

**Goal:** A person can own an account and authenticate without a Sber-specific profile or a personal provider participant; company registration, membership, administrator authority and business grants are independently represented and checked.

**Architecture:** Preserve public.users IDs and the persons(user_id) primary key. Add migration006 after migration005. Canonical person attributes become ordinary columns; provider snapshots have their own source records. Keep nullable deprecated Sber metadata temporarily so the previous deployed image can be selected for application rollback. Personal contractors remain optional business participants. Corporate membership and confirmed administrator authority gate existing participant grants.

**Tech Stack:** Node.js24, TypeScript, NestJS/Fastify, pg, PostgreSQL18.6, node:test and existing project checks.

## Global Constraints

- Worktree: /Users/vvv/.codex/worktrees/identity-membership/АСТ Форум; branch codex/PROJ-161-person-memberships. Current published dependency/base761407cb926937ad3431304ddf6ba884518c2eca (PROJ-160 logout icon, PR31). Initial implementation started frome6a910c4aa7f5795a1c178a47c64a1dc5aea9875 (PR30).
- Preserve the published PR31 profile-header SignOut, footer, cabinet CSS/home/e2e and PROJ-154/160 receipts/plans byte-for-byte by a non-destructive merge; retain all reviewed PROJ-161 API/migration/account/business source bytes. The PROJ-161 ownership layer pins only its changes from exact761; inherited layout40 stays with PROJ-154. No rebase/force-push or sibling-branch mutation.
- OpenProject task PROJ-161, API ID199, parent PROJ-35. Related verified features PROJ-38, PROJ-40, PROJ-44, PROJ-45, PROJ-46.
- Preserve real user/profile/session IDs, existing profile values, scoped grants and historical events. No fabricated authority evidence; no automatic company administration from Sber claims or company creation.
- New logins create no provider participant, provider grant or ParticipantRegistered event. All active person accounts receive the baseline individual role independently of business participants.
- Existing provider participants are preserved. Their status or revoked membership cannot invalidate the account session; their business permissions still require valid scoped access.
- No new external identity provider integration, company UI, or public self-approved authority endpoint. Preparing provider-neutral storage and internal access checks belongs to this change.
- No automatic linking by email/phone. External identifier ownership remains unique in its configured provider namespace. Keep existing alias/concurrency protections.
- Runtime role stays restricted to forum; snapshots/authority evidence are not public API payloads. Passwords/tokens/private profiles never enter committed evidence.
- Main DB forum has three users/persons/personal participants and zero organizations at preflight; runtime forum_app targets forum from the dev API image proj160-a03cab0c. Recheck before apply.
- Only a dedicated local database ending in _test is used by destructive tests: postgres://postgres:proj161-isolated-test@127.0.0.1:55444/forum_auth_test.
- Migration/apply requires private full backup, successfully restored isolated database and profile/row/ACL comparison before the live transaction. No down migration discarding newly acquired data; application rollback retains additive schema/data.
- Commits must mention PROJ-161; controller owns push/PR, OpenProject integration, live DB/app apply and release evidence. Never commit or modify sibling branches.

### Task 1: Schema, authentication and corporate access contract

**Files:**
- Create apps/api/migrations/006_person_memberships.sql and a focused database-backed test suite for upgrade and corporate access.
- Modify apps/api/src/migrate.ts, apps/api/src/iam/auth-store.ts and the person/identity and participant access helpers required by this contract.
- Modify apps/api/test/auth.test.ts, test cleanup/helpers and migration tests as required by changed behavior.
- Modify deployment/forum-db/apply-public.psql, deployment/forum-api/grant-runtime.sql and the corresponding real SQL/grant regression checks.
- Modify apps/web/src/audience/intent.ts and its tests only if the account session contract requires it. Preserve cabinet/profile route and response presentation.

**Interfaces and data contract:**
- persons.user_id remains PK/FK(users.id). Existing canonical generated columns are made independent ordinary columns with their stored values intact; new generic people can omit all Sber metadata.
- Add a configured provider registry and separate identity_profiles linked to external_identities. Existing provider keys are retained and seeded. Provider snapshots/scopes/received times are backfilled from current validated data with source identity ownership, not synthetic timestamps. Drop the mandatory Sber ownership FK/NOT NULL dependency and the constant provider expression. Nullable legacy metadata may remain explicitly deprecated for rollback; it must not drive new profile reads.
- Remove person_requires_participant, keep_personal_participant and the obsolete require_personal_participant function. Update explicit function grants accordingly.
- Add organization registration state/creator metadata, organization_memberships and organization_authorities, including pending/active/revoked membership and pending/confirmed/rejected/revoked authority. Record basis type/reference, creator/approver and effective timestamps with state-consistent CHECKs and immutable ownership associations. The concrete field names and constraints must be documented in the report for the API integration.
- Company card creation does not confer membership or administration. Pending membership grants no business rights. Effective corporate access requires active user, active organizational membership, active participant membership and appropriate scoped grant; write/action access must reject restricted/deactivated participants/organizations. organization_admin additionally requires confirmed matching administrator authority. Revocation of one company/authority leaves account and other company access intact.
- Employee role_assignments have their own active/revoked status and revoked_at state constraint as well as basis; preserve existing assignments as active. Revoking one scoped grant independently denies that business permission without revoking company membership, personal session or other company grants. Effective access filters active grants; narrow runtime UPDATE enables this existing trusted assignment lifecycle.
- Keep registration, membership and administrative evidence independent of provider/customer business grants. Existing legacy memberships/grants must be backfilled with explicit legacy provenance; unproven admin rights must not become confirmed by migration.
- Add a small internal access service/query for effective scoped business permissions. No unauthenticated/self-approving company management endpoints. Test the real queries against PostgreSQL, including use of the restricted runtime role.
- AuthStore.authenticate must persist/update the provider identity and a canonical person, without creating a participant. Preserve subject aliases, conflicts, transaction rollback and session rotation. A trusted adapter can pass a configured provider key; the Sber route retains its existing validation and defaults to sber_id.
- AuthStore.session returns {user, roles:['individual'], participant: optional/null, expiresAt}. Login/session validity is based on user and session. It does not require a personal participant or membership. A revoked/deactivated participant grants no business rights even though the session remains valid.
- AuthStore.profile returns the same UI shape {userId, profile}, derived from canonical person columns, not the Sber snapshot. Return no subject, provider tokens or source metadata.
- Auth account creation emits UserRegistered and the existing UserAuthenticated audit; it does not emit ParticipantRegistered. Existing events remain unchanged.
- Prepare snapshots/providers for future providers while avoiding an actual external integration. Reject unconfigured provider namespaces and identity ownership collisions. Do not merge accounts on contact equality.

- [ ] Write regression tests before production changes. The first new-account assertion must discriminate the old behavior:

```ts
const response = await finish(await begin('login'));
const me = await app.inject({method:'GET',url:'/api/auth/session',headers:{cookie:sessionCookie(response)}});
assert.equal(me.statusCode,200);
assert.deepEqual(me.json().roles,['individual']);
assert.equal((await pool.query('SELECT count(*) FROM public.participants')).rows[0].count,'0');
assert.equal((await pool.query('SELECT count(*) FROM public.persons')).rows[0].count,'1');
```

- [ ] Run focused tests against the pre-change implementation and record the expected failure. Add coverage for existing session with absent/revoked/deactivated personal participant, canonical profile returned after independent profile update, provider-neutral person and second configured provider, upgrade preserving all current profile attributes, migration repeat apply and rollback on a fault, company membership/authority states, role scope mismatch and independent revocation.
- [ ] Implement the schema transition additively. Canonical column conversion should use the catalog and preserve values:

```sql
-- Within the migration transaction, use known canonical attributes only.
ALTER TABLE public.persons ALTER COLUMN family_name DROP EXPRESSION;
DROP TRIGGER person_requires_participant ON public.persons;
DROP TRIGGER keep_personal_participant ON public.participants;
DROP FUNCTION public.require_personal_participant();
-- Remove the composite person-to-Sber ownership dependency; preserve source
-- ownership in identity_profiles instead, with explicit FK and uniqueness.
```

- [ ] Implement the account/session/profile and effective access changes. For session validity keep the existing active-user/session query; remove the mandatory personal-participant failure branch and derive individual as the baseline role. No automatic participant writes remain in authenticate.
- [ ] Ensure both migration entrypoints apply005 then006, reject mixed/legacy ledgers and are repeatable. Reconcile restricted grants using explicit table/function lists; no global/blanket future-table grants.
- [ ] Run `TEST_DATABASE_CONTAINER=forum-proj161-test TEST_DATABASE_URL=postgres://postgres:proj161-isolated-test@127.0.0.1:55444/forum_auth_test npm test --workspace @astforum/api`, API build/typecheck, and affected real migration/grant tests. Run check:layout. If frontend session interpretation changes, install needed dev dependencies and run its focused tests/typecheck.
- [ ] Refresh this worktree's GitNexus index and perform impact/api_impact before changes, then detect_changes before committing. If a graph path is unresolved, state that and verify sources/callers; never interpret zero callers as safety.
- [ ] Self-review, commit only this task's changes with PROJ-161 and produce a full report with RED/GREEN outputs, schema/API contracts, commands, commits and remaining risks. Controller dispatches independent task and whole-branch review.

### Task 2: Verified database apply, API release and reviewable delivery

**Owner:** Controller. No changes to company UI or sibling PRs.

- [ ] Recheck runtime target, role, release image/current path, schema ledger, all table counts and relevant ACLs. Snapshot actual profile hashes privately without logging personal values.
- [ ] Create a mode0600 custom-format full forum dump plus globals/ACL metadata under a task-specific private server backup path; restore it into an isolated PostgreSQL18.6 database and prove all table counts/profile hashes/ownership/grants match. Run006 against the restored copy before touching forum.
- [ ] Build and inspect the new API image, retain the preceding image/config/current pointer. Apply the reviewed migration transaction as schema owner and reconcile explicit runtime grants; compare IDs/rows/profile hashes and schema ledger after commit. Run idempotent second apply.
- [ ] Recreate only the dev forum_api service with the reviewed image. Validate readiness, anonymous 401, the deployed schema/image bytes and canonical profile/session contract on isolated synthetic tests. Use the in-app browser for any browser work. Do not introduce actual synthetic users into forum.
- [ ] Publish the matching DEV web artifact from the exact successful GitHub CI SHA/run using the existing atomic web_release publisher. Verify artifact revision, take a fresh private mount/CAS backup, retain old assets, and prove HTTPS plus in-app-browser smoke of the changed session consumer. Preserve the current published761 UI bytes, publish matching DEV web before stopping/migrating/recreating API, and retain that baseline for rollback. No production publication or UI redesign.
- [ ] Push this task branch; update PR32 based on codex/PROJ-160-cabinet-logout-icon at exact761407cb926937ad3431304ddf6ba884518c2eca with OP#PROJ-161, OP#PROJ-35 and relevant verified parent features in its body. Verify remote SHA/diff and OpenProject GitHub-tab/API linkage under Kuzmina, then attach PR to this chat.
- [ ] Commit non-sensitive release evidence, preserve backups and report current live state, tests, PR/task links and any concrete remaining limitation.

## Plan review

The schema and AuthStore contracts form one inseparable release and are intentionally Task1. Task2 consumes its committed migration, image and reviewed tests. Generic person data and optional business actors agree with the user's explicit clarification. Provider snapshots preserve provenance while nullable legacy metadata enables selecting the previous image. Company administration remains pending until independently proven; no external verification service is invented.
