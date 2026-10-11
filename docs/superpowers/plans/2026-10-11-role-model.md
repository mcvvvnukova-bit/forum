# Role Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six-role server authorization model and controlled assignment of platform_admin to the existing account identified by +79010000001.

**Architecture:** Add scoped IAM assignments beside existing provider/customer business grants. Read effective roles from PostgreSQL on every request, separate personal/company/platform contexts, and atomically mutate roles with audit, versioning and idempotency. Add Primer role management to the existing cabinet.

**Tech Stack:** Node 24, TypeScript, Nest/Fastify, PostgreSQL 18, React 19, Primer 38.

## Global Constraints

- Work only in `/Users/vvv/.codex/worktrees/role-model/АСТ Форум` on `codex/PROJ-171-role-model`; do not touch the primary checkout or its untracked Diadoc plan.
- The binding design is `docs/superpowers/specs/2026-10-11-role-model-design.md`; this is implementation of the existing approved IAM model, with the owner's later optional-participant decision and current explicit admin instruction.
- Roles: individual, organization_employee, organization_admin, organization_signer, platform_moderator, platform_admin. Unknown permissions deny; platform roles grant no customer impersonation or company membership.
- users/persons and personal access require no contractor participant. provider/customer remain separate business grants. Do not merge identities by phone/email.
- Bootstrap is an explicit owner operation, unique verified active phone match plus expected userId, with audit; never a login-time phone whitelist.
- Never print secrets or commit access data. No production release. No restoration of the cancelled OKVED parser.
- Use the installed GitNexus against the matching checkout: impact/api_impact before existing symbol edits, detect_changes before commit; when a live MCP still serves an old index, report that fact and verify current sources/CLI rather than treating it as fresh.
- Meaningful tests first, verified RED then GREEN. Test database only `postgres://postgres@127.0.0.1:55473/astforum_roles_test`, never live DB. Also set TEST_DATABASE_CONTAINER=forum-role-model-test for existing psql migration tests. Commands run in apps/api when migrations use relative paths.
- UI uses only existing Primer components/tokens and Light mode; preserve keyboard, error and mobile behavior.
- Commit subjects include PROJ-171. The controller handles push/PR/OpenProject/external changes.

### Task 1: Scoped roles, authorization API, migration and bootstrap

**Files:**
- Create `apps/api/migrations/008_iam_roles.sql`, a safe migration rollback procedure under `deployment/forum-api/`, `apps/api/src/iam/role-catalog.ts`, `role-store.ts`, `roles.controller.ts`, `apps/api/src/bootstrap-platform-admin.ts`, `apps/api/test/roles.test.ts`.
- Modify `apps/api/src/migrate.ts`, `apps/api/src/app.ts`, `apps/api/src/iam/auth-store.ts`, `apps/api/src/organizations/organization-store.ts`, `deployment/forum-api/grant-runtime.sql`, `apps/api/package.json`, `apps/api/README.md`.
- Additional focused files under `apps/api/src/iam/` or `apps/api/test/` may separate role reads, mutations and request validation so no new file becomes an unreviewable monolith.

**Interfaces:**
- Consumes existing AuthRuntime, cookie session, public.users/persons/organization_memberships/organization_authorities and public.audit_events.
- Produces RoleCode, fixed permission catalogue, Context DTO `{contextKey,participantId,roles,permissions,accessVersion}`, effective permission checks against current authoritative states, and the exact endpoints from the design.
- Session adds `{platformRoles:string[],accessVersion:number,csrfToken:string}` while preserving all existing fields.
- New mutations consume Origin, X-Forum-Context, X-Forum-CSRF, Idempotency-Key and If-Match for updates, as described in the design.

- [ ] **Step 1: Write endpoint behavioral tests against the current real app and isolated database.** The first test must fail due to the missing route, not a missing import. Example:

```ts
test('ordinary account cannot enter platform context',async()=>{
 const response=await app.inject({method:'POST',url:'/api/iam/context/resolve',headers:{cookie:user.cookie},payload:{contextKey:'platform'}});
 assert.equal(response.statusCode,403);
});
```

Add independently expected tests for fixed catalogue; personal context with no participant; unique bootstrap phone and expected ID; zero/multiple matches; bootstrap idempotency; no phone-based transfer; grants/revokes; CSRF/Origin; missing/wrong context; unknown/foreign role; two companies; wrong user/membership/scope; missing and expired signer evidence; current status changes; idempotency same/different body; If-Match; concurrent last-admin removals; rollback on audit failure; pagination; no private profile/provider payloads. Seed synthetic users with Sber external identity for role-management endpoints.

- [ ] **Step 2: Run RED.** In `apps/api`: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55473/astforum_roles_test TEST_DATABASE_CONTAINER=forum-role-model-test npm test`. Record the missing route failure and focused failing cases before implementation.
- [ ] **Step 3: Add the additive migration and separated catalogue/store/controller.** Use PostgreSQL FK/CHECK/unique constraints for assignments and immutable owners. Backfill employee grants only from currently valid membership; admin requires confirmed current authority. Keep individual derived from the local account. Effective corporate grants additionally require current active membership, registered active organization, and valid signer authority for signatures. Implement exact permission matrix in the design. Use controlled context resolution, not shared session switching.

```ts
export type RoleCode='individual'|'organization_employee'|'organization_admin'|'organization_signer'|'platform_moderator'|'platform_admin';
export type AuthorizationContext={contextKey:string;participantId:string|null;roles:RoleCode[];permissions:string[];accessVersion:number};
// For a multi-permission action every code must exist and be granted in this context.
function requireAll(granted:readonly string[],required:readonly string[]) {
 if(required.some(permission=>!granted.includes(permission)))throw new AuthError('forbidden',403);
}
```

Validate all bodies/query/header values strictly; no client author selection. Serialize platform mutations and organization mutations separately with stable lock ordering. Recheck session and actor permissions within the transaction. Audit and version updates must roll back together. Replays reauthorize the actor. Never allow last-admin ordinary revocation to leave zero admins.

- [ ] **Step 4: Implement the explicit bootstrap function and CLI.** `bootstrapPlatformAdmin(pool,{phone,expectedUserId,reason})` must verify one active Sber-identified canonical phone match, require expected ID equality, lock platform administration, and insert platform_admin plus audit exactly once. CLI accepts `--phone`, `--user-id`, `--reason`; does not print DSN or phone/profile snapshots. It must refuse to bypass a different existing platform administrator. Use a dedicated npm script and document invocation in README. Do not run the CLI on the server from this subagent.
- [ ] **Step 5: Wire runtime readiness, explicit database grants, session DTO and My Organizations reads to effective IAM roles.** Partial deployment fails closed. Active organization membership must not require provider/customer business grants merely to view the organization; pending additions still show no membership rights. Existing business grants/settings behavior remains intact. Preserve legacy API fields.
- [ ] **Step 6: Run focused GREEN, then the complete API suite once, API typecheck/build and migration rollback test.** Commands: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55473/astforum_roles_test TEST_DATABASE_CONTAINER=forum-role-model-test npm test`, `npm run typecheck`, `npm run build` in apps/api. Record counts and outputs. Runtime ACL tests must run real operations under the restricted role, not the owner.
- [ ] **Step 7: Self-review and commit only this task.** Run GitNexus detect_changes and current-source checks; `git add` named files; `git commit -m 'feat(PROJ-171): enforce scoped IAM roles and controlled administrator bootstrap'`. Full evidence goes into the task report; no push or deployment.

### Task 2: Primer cabinet role management and browser verification

**Files:**
- Create `apps/web/src/home/RoleManagementSection.tsx`, `apps/web/src/home/roles.test.tsx`, and focused browser verification if needed.
- Modify `apps/web/src/audience/intent.ts`, `apps/web/src/home/Cabinet.tsx`, `apps/profile-preview/src/ProfilePage.tsx` and existing cabinet navigation compositions as required; update routes in the established build config if new route publication requires it.

**Interfaces:**
- Consumes Task 1's session additions and exact IAM API contracts; no frontend role decision grants server authority.
- Produces a Russian role-management view reachable in the existing cabinet. Users with platform.roles.manage can select an existing minimal platform-user record and manage platform roles with a mandatory reason. Organization admins can manage employee/admin/signer requests of their own existing active members. Client does not supply proof that signer authority is valid.
- Use page-local validated contexts; context changes clear old data, abort pending reads, preserve user confirmation for unsaved changes. Never globally switch the session or show another company's stale data.

- [ ] **Step 1: Write real-component failing tests.** Test ordinary-session hidden staff navigation plus direct-route forbidden state; admin role listing; grant/revoke requests and required reason; double submission guard; CSRF/context/idempotency/version headers; 401, 403, 412 and unavailable retry; company switch clears the old members and wrong IDs never show data. Example:

```tsx
it('ordinary account cannot see platform role management',async()=>{
 render(<Cabinet/>);
 expect(await screen.findByText('Личные данные')).toBeVisible();
 expect(screen.queryByRole('link',{name:'Администрирование'})).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused RED in apps/web.** `npm test -- --run src/home/roles.test.tsx`; confirm missing behavior is the failure. Request mocks represent complete Task 1 payloads and remain at the HTTP boundary, with real Primer components.
- [ ] **Step 3: Build the view using existing Primer layout/navigation and Russian labels.** Extend Session fields for platformRoles/accessVersion/csrfToken. Treat unknown/malformed authorization data as unavailable. Keep current profile/settings/organizations flows working. Resolve context before loading members, read actual permissions from server, handle refusal/revocation/stale version by clearing sensitive stale state. Show effective/pending signer status honestly. Do not add new brand tokens, unrelated layout changes, custom primitives or production integrations.
- [ ] **Step 4: Run GREEN plus web/profile relevant regression tests and checks.** In apps/web: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. In apps/profile-preview run its relevant tests/typecheck/build. Run `python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py /Users/vvv/.codex/worktrees/role-model/АСТ\ Форум`. Record existing baseline warnings separately from introduced findings.
- [ ] **Step 5: Verify real local app against Task 1 API and isolated database.** Use only Codex iab for visible browser control. Cover desktop and 320/390/768 widths, keyboard focus, menu access, role assignment then revoke, old-cookie refusal, reload persistence, failure/retry. If using automated Playwright for repeatable verification, keep the user's visible browser in iab and write verification evidence to a task-private folder. Record fixture vs live-provider boundaries.
- [ ] **Step 6: Self-review, GitNexus detect_changes, and commit.** `git commit -m 'feat(PROJ-171): add Primer role management to the cabinet'`. Report routes, checks, browser evidence and limitations; no external publication.

Controller completion: perform task reviews and one final branch review, run required repository checks, push the task branch, create/attach PR with OP#PROJ-171 OP#PROJ-40 OP#PROJ-45, verify exact remote commit and OpenProject GitHub-tab links. Execute the explicit target-account bootstrap only after rechecking target schema/user and choosing the authorized dev release path; record actual live state separately from isolated tests. Never claim production publication.
