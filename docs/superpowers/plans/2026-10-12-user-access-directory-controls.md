# User access directory controls implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Apply the seven new browser comments to local `/cabinet/users/`, including searchable access selection and organizations for blocked users.

**Architecture:** Extend the existing platform-admin directory read with current organization membership summaries. Keep platform assignments independently addressable for service-role grants/revocations; the blocked table combines their active labels with corporate assignment labels. Reuse Primer SelectPanel and the existing table composition, with an access-specific organization column.

**Tech stack:** Nest/Fastify, PostgreSQL, React 19, Primer React 38.37, TypeScript, Vitest, node:test.

## Global Constraints

- All actions remain local. No push, PR, deployment, or remote mutation. Continue branch `codex/PROJ-171-administration-menu`; task is verified `PROJ-171` (OpenProject work package 209).
- Preserve unrelated `docs/plans/2026-10-11-001-feat-diadoc-organization-verification-plan.md` and all historical ownership receipts.
- Only the first tab lists users with active service-role assignments. The second lists blocked users, including those without service roles.
- User confirmed: organizations show only current membership, excluding former organizations. Membership validity is independent of blocked account status.
- Primer components and semantic tokens only, Light mode only. No new UI dependency, hard-coded typography, or custom control primitive.
- Preserve server authorization, CSRF, If-Match, idempotency, self-block/last-admin guards, stale-read invalidation, cross-tab busy guards, blocked-target revocation, and corporate role management.
- Browser verification uses Codex IAB only, performed by the controller. No external Playwright/Chromium launch; compiled tests without a browser are allowed.

### Task 1: Current organization directory and searchable user-access controls

**Files:**
- Modify: `apps/api/src/iam/role-store.ts`, `apps/api/test/roles.test.ts`.
- Modify: `apps/web/src/home/UserAccessSection.tsx`, `apps/web/src/home/PlatformUsersTable.tsx`.
- Test/adapt: `apps/web/src/home/user-access.test.tsx`, `apps/web/src/home/platform-users-table.test.tsx`, `apps/web/src/home/roles.test.tsx`, other fixtures consuming this DTO only when necessary.
- Modify ownership: `artifacts/repository-audits/proj-171-role-model-ownership.json`, `scripts/verification/check-operational-sources.py`.
- New owned plan: this file.

**Interfaces:**
- Existing GET `/api/iam/platform-user-access` retains `{items,nextCursor}` and each user's `{userId,displayName,status,version,platformRoles}` unchanged. Add `organizations: OrganizationMembershipSummary[]`.
- `OrganizationMembershipSummary = {id:string;name:string;roles:('organization_admin'|'organization_employee'|'organization_signer')[]}`. `id` is organization UUID, `name` is its legal name with existing safe INN fallback if blank/null. Each organization appears once. Rows and role codes are deterministically sorted.
- Include memberships only when `m.status='active'`, `m.revoked_at IS NULL`, `m.effective_from<=statement_timestamp()`, and `effective_until` is null or in the future. Organization must be registered and active. Do not require `u.status='active'`, because blocked users retain memberships.
- Corporate role labels describe retained assignments, not effective permission or signing authority. Only role assignments matching the current membership/user/organization with active status and valid dates are included. Do not broaden any mutation or authorization policy.
- First table continues using `platformRoles` exclusively. Add an explicit `showOrganizations`/equivalent access-table mode; its role heading is `Роли`, organization heading `Организация`. Combine active platform assignment labels and corporate role labels, deduplicated. Every listed organization is displayed even when no corporate role is assigned. No fabricated personal role or permission claims.
- Strictly validate the new directory arrays (UUID, nonempty name, known corporate codes, duplicate IDs/codes). Missing/malformed data must fail closed, as existing role metadata does. Adapt all owned fixtures to the additive required contract.
- Bare access PATCH response still contains UserAccess only. Merge it into the previous full directory record, retaining `platformRoles` and `organizations` after block/unblock.

**Acceptance requirements:**
1. Blocked-table heading `Служебные роли` becomes `Роли`; first service-role table keeps its accurate service-role heading.
2. Blocked table gains `Организация` with all current organizations. Provide actual sort and text-substring filter for the new column, matching the existing data-column controls. The combined role filter includes corporate choices as well as platform roles. Preserve other table filters, stable sorting, action scope, accessible names, and keyboard scrolling. Set correct table grid column count and no-results colspan.
3. Access picker becomes searchable Primer SelectPanel: typed case-insensitive display-name search, no-results state, clear selection, keyboard operation, focus return. All directory users remain selectable including blocked and self (self-block stays disabled). Selected item still displays current login status. Filtering alone never changes selected user or clears pending retry identity; actual target/clear does.
4. Remove the visible `Блокировка пользователей` subheading and its description. Keep an accessible section name (e.g. `aria-label="Блокировка входа"`). Keep the confirmation dialog explaining the actual block/unblock effects.
5. `Пользователь для блокировки` label uses the same existing semantic Primer heading typography as `Заблокированные пользователи`, while labeling the picker correctly.
6. Previous roles-tab `Администратор платформы — действует` summary is already absent. Verify and preserve its absence.
7. Preserve normal panel top padding and the pale-orange disabled primary action when no user is selected.

- [ ] **Step 1: Add discriminating tests and record RED.**

Example assertions to implement using existing helpers (adapt to actual fixture APIs):

```ts
assert.deepEqual(blocked.organizations, [
  {id:organizationA,name:'Компания А',roles:['organization_admin','organization_employee']},
  {id:organizationB,name:'Компания Б',roles:['organization_employee']},
]);
assert.deepEqual(noMembership.organizations, []);
// Exclude revoked, pending, expired/future memberships; invalid organizations;
// revoked/expired/foreign corporate assignments. Include blocked account memberships.
// Keep exactly one bounded organization batch for the returned page, not lookahead.
expect(within(blockedTable).getByRole('columnheader',{name:/^Роли/})).toBeVisible();
expect(within(blockedTable).getByRole('columnheader',{name:/^Организация/})).toBeVisible();
expect(within(blockedRow).getByText('Администратор компании')).toBeVisible();
expect(within(blockedRow).getByText('Компания А')).toBeVisible();
// Picker: type substring, select blocked UUID, see unblock action; search misses
// retain previous selected target; clear disables pale-orange block action.
// PATCH merges keep all organization/role metadata; refusal/stale/late response
// tests retain meaningful security assertions while adapting away from selectOption.
```

- [ ] **Step 2: Implement a bounded read projection.**

Use one additional page-scoped query (or equivalent constant-round-trip projection):

```sql
SELECT m.user_id AS "userId",o.id,coalesce(nullif(btrim(o.legal_name),''),o.inn) AS name,
 ARRAY(SELECT r.role_code FROM public.iam_role_assignments r
  WHERE r.membership_id=m.id AND r.user_id=m.user_id AND r.scope_type='organization'
   AND r.scope_id=m.organization_id AND r.status='active'
   AND r.effective_from<=statement_timestamp()
   AND (r.effective_until IS NULL OR r.effective_until>statement_timestamp())
  ORDER BY r.role_code) AS roles
FROM public.organization_memberships m JOIN public.organizations o ON o.id=m.organization_id
WHERE m.user_id=ANY($1::uuid[]) AND m.status='active' AND m.revoked_at IS NULL
 AND m.effective_from<=statement_timestamp()
 AND (m.effective_until IS NULL OR m.effective_until>statement_timestamp())
 AND o.registration_state='registered' AND o.status='active'
ORDER BY m.user_id,name,o.id
```

Keep authorization before reading, READ ONLY repeatable-read transaction, signed cursor binding, page limits, no N+1, and no history leaks. Check actual uniqueness constraints before selecting aggregation/deduplication. Extend existing runtime-user IAM API test to prove query ACLs.

- [ ] **Step 3: Implement Primer access-picker/table mode.**

Reuse `RoleManagementSection`'s SelectPanel composition, business callbacks and semantic tokens, without copying unrelated mutation logic. Label with `Heading as="label" variant="small"` or equivalent supported composition. Close picker on reads/refusals and protect it during mutations. Render organization names as an accessible list or separated text; preserve all entries when horizontally scrolling the table. First table's service-role semantics and row revocation remain unchanged.

- [ ] **Step 4: Verify and update ownership evidence.**

Run focused tests while iterating, then final web suite, typecheck/lint/build and API IAM suite/build/typecheck once after source freeze. Use existing Node 24 runtime. API test environment is exclusively `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55473/astforum_user_access_test` and `TEST_DATABASE_CONTAINER=forum-role-model-test`. TypeScript emits `.test-build`, then `node --test --test-concurrency=1 .test-build/test/roles.test.js`.

Run `python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py` for the absolute project path and repository Primer gate. Known baseline PDS004 at `sber-tokens.css:7,8,9` is recorded separately, never silently called a raw pass or changed as unrelated work.

Update candidate hashes and new-file hashes in current PROJ-171 receipt, sourceSha=`02a6c4690ef4cb52aa6141bc84af2209bf61ed81`. Preserve predecessor/base pins. Recompute checker's manifest pin by omitting only its candidateSha256, then hash final checker. Stage new owned files before `node --test --test-name-pattern='PROJ-171' scripts/verification/checks.test.mjs`. Verify provenance on a tracked-file snapshot, because ignored retired landing files exist in this workspace. Record exact commands/counts/output and limitations in the task report.

- [ ] **Step 5: Graph gate and local commit.**

Controller's current CLI/index proof is HEAD `02a6c4`, schema4/current, no incomplete reasons. MCP metadata is cached behind; a fresh LocalBackend accurately resolves the same current disk graph. Direct table consumers are RoleManagementSection and UserAccessSection; role-store `userAccess` graph misses controller edges, so source/API contract review supplements it. Before symbol edits use fresh impact (or controller's unchanged-source saved impact); before commit refresh current index after final source edits, then stage → detect_changes(staged) → local `PROJ-171` commit with only task-owned paths. Preserve scope and report graph failure honestly with source fallback if tooling is unavailable.

**Report contract:** Write full report including files, RED/GREEN discriminating failures, exact final test outputs, commit(s), graph evidence, self-review and remaining concerns. Return only status, commits, one-line tests, concerns and report path. Controller owns IAB acceptance, fixture refresh, task review and final whole-branch review.
