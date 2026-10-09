# Мои организации — PROJ-162 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development for one integrated implementation task, followed by task and whole-branch review. The user approved the design on 09.10.2026: save by INN; confirmation is separate. Execute without another approval round.

**Goal:** A signed-in person can add a company or entrepreneur by INN and see their own additions and joined organizations in one table in the personal cabinet.

**Architecture:** An additive personal organization-additions table records only the owning user and INN. It grants no membership, authority, business participant or role. Guarded server endpoints merge these records with the caller's effective organizational memberships, deduplicate by INN, and expose member names/roles only for active own memberships. The existing Primer cabinet shell renders a new organizations view with a single-field form and a real server-backed table.

**Tech Stack:** Node.js 24.18.1, React 19.2.8, Primer React 38.37.0, TypeScript, NestJS/Fastify, pg, PostgreSQL.

## Global Constraints

- Worktree: `/Users/vvv/.codex/worktrees/my-organizations/АСТ Форум`; branch `codex/PROJ-162-my-organizations`; base `e6a910c4aa7f5795a1c178a47c64a1dc5aea9875` (PR30).
- OpenProject PROJ-162 is API ID200, parent PROJ-5/API42; all operations under Kuzmina/API user8. PR description must include `OP#PROJ-162` and `OP#PROJ-5`.
- Preserve sibling worktrees and their dirty files. PROJ-161 independent account/membership changes are currently uncommitted elsewhere. Do not copy them, commit them or depend on their unpublished bytes.
- Only one required input: INN as a string, 10 digits for a company or 12 for an entrepreneur. Validate length, digits and checksum on client and server, preserving leading zeros. All-zero INN is invalid.
- Rename the cabinet section to `Мои организации`. Route: `/cabinet/organizations/`. The form button is `Добавить`. Table columns: `ИНН`, `Название организации`, `Пользователи и роли`; one organization per row, multiple member names/roles in the last cell.
- Corporate role codes/names from live IAM.01.02: `organization_admin` / `Администратор компании`; `organization_signer` / `Лицо с правом подписи`; `organization_employee` / `Сотрудник компании`. Multiple compatible roles can be displayed for one member. Platform/personal and provider/customer business labels do not substitute corporate roles.
- Adding an INN saves the caller's pending addition. It does not verify a company, approve membership, grant administrator/signer rights, start Diadoc, create a business participant or switch context. Repeat submission is idempotent and shows one row.
- A pending addition must never disclose another company's members. An organization name/INN are company-card data. Read existing names from `public.organizations`; absent confirmed name is `null` in the API and `Название появится после подтверждения` in UI, with `Ожидает подтверждения`. Do not invent a name or silently call a new external paid provider. This absence is an explicit implementation limitation.
- No directory/financial/OKVED parser from cancelled PR2. No verification adapter, member/role-management flow, bulk registry crawl, production or live database deployment in this scope.
- Existing personal data, session IDs and legacy fixtures remain intact. Account identity comes only from the active server cookie. No supplied userId, role or name is accepted. GET/POST responses use no-store; mutation requires exact configured Origin and CSRF protection consistent with current server.
- Primer is the sole UI component system, Light mode and existing semantic tokens. Use the installed Primer DataTable composition; do not add a second UI library or literal typography/colors. Preserve accessible mobile menu, focus, logout and keyboard navigation.
- Database tests use a dedicated isolated database whose name ends `_test`; no sibling test database. Additive schema rollback selects the previous app and retains pending additions. No destructive down migration that loses newly saved data.

## Approved design

The section and page heading are `Мои организации`. A labeled INN field, concise legal-entity/entrepreneur hint and primary Add button precede the table. Enter submits. Invalid values have associated inline errors; saving has disabled repeated-submit and loading feedback. Successful save clears the input, confirms saving and updates the real list. Pending additions and active memberships coexist; a repeated INN or an added organization later joined appears once. Empty, loading, retryable error and expired-session states contain no fictional companies. Members are displayed as names plus all effective corporate role labels. No member data appears for a mere pending addition.

The live Outline document is https://docs.astforum.ru/doc/iam0102-rolevaya-model-VbZ7MBWv2A, updated 02.10.2026. INN does not prove corporate authority (section8); own pending cards may appear in the list (section7). Existing constraints cannot represent active signer assignments yet; this task displays effective persisted roles but implements no role-grant/signing workflow. It must not advertise legal signing as implemented.

## Task 1: Integrated persistence, API, cabinet UI and artifact routes

**Files:**
- Create `apps/api/migrations/007_my_organizations.sql`, a focused `apps/api/src/organizations/organization-store.ts`, a guarded organizations controller, INN validation helper and DB-backed tests.
- Modify `apps/api/src/app.ts` registration and `apps/api/src/migrate.ts` migration allowlist; explicit runtime grants and `deployment/forum-db/apply-public.psql` as needed for repeatable isolated installation. Preserve the existing auth controller's cookie/session contract.
- Create a focused organization view/loader in `apps/web/src/home/`; modify `Cabinet.tsx`, `home/App.tsx` and shared `apps/profile-preview/src/ProfilePage.tsx` only at the necessary shell/navigation seams. Preserve profile/work defaults and preview fixtures.
- Modify built artifact route inventory and the corresponding route tests to include `/cabinet/organizations/`. Update owned verification receipts using the established repository scripts, preserving historical receipts.

**Interfaces:**

```ts
type OrganizationRole = 'organization_admin'|'organization_signer'|'organization_employee';
type OrganizationMember = {userId:string; fullName:string; roles:OrganizationRole[]};
type MyOrganization = {id:string; inn:string; name:string|null;
  status:'pending'|'active'; members:OrganizationMember[]};
type OrganizationList = {userId:string; items:MyOrganization[]; nextCursor:string|null};
// GET /api/me/organizations?cursor=<opaque pagination cursor>
// POST /api/me/organizations: {inn:string}, exact Origin; no other fields.
// POST result: 201 for a new own addition, 200 for existing own addition.
// Both return {userId, item:MyOrganization} without member/authority evidence.
// GET uses stable ordered cursor pagination (50 items/page); no product count limit.
```

- Member visibility requires an active own organizational membership, active user, non-deactivated organization, and effective current corporate access. For baseline legacy schema, use the existing active participant-membership boundary. If PROJ-161 tables/functions exist at runtime, enforce its active organization membership/effective-access/confirmed authority constraints too; do not bypass new revocations. Use focused explicit queries, and do not silently swallow missing-schema errors. No roles from Sber claims or matching contacts.
- Existing member names come from person fields with user display-name fallback. Do not expose contacts, Sber subjects, snapshots, cookies, authority references or private business fields.
- The additions table has a unique `(user_id,inn)` constraint and indexes for owned pagination. An authenticated user may add any checksum-valid INN but receives no other user's addition or member data. Audit only a successful first addition under its author.

- [ ] Capture and run clean baseline web/profile/typechecks and isolated API tests. Record failures unrelated to the change before proceeding.
- [ ] Write meaningful failing tests before production edits. Prove POST currently returns404, then test company/entrepreneur INNs, invalid checksum, extra fields, unauthenticated401, wrong/missing Origin403, owner-only persistence after reread, repeat/race idempotence, pagination, known name, unknown-name pending state, own active membership/member roles, and foreign pending-addition member isolation. Test two different users and membership revocation.

```ts
const added = await app.inject({method:'POST',url:'/api/me/organizations',
  headers:{cookie:aliceCookie,origin:'https://forum.example'},payload:{inn:'9709128511'}});
assert.equal(added.statusCode,201);
const mine = await app.inject({method:'GET',url:'/api/me/organizations',headers:{cookie:aliceCookie}});
assert.equal(mine.json().items[0].inn,'9709128511');
assert.deepEqual(mine.json().items[0].members,[]);
assert.equal((await app.inject({method:'GET',url:'/api/me/organizations',headers:{cookie:bobCookie}})).json().items.length,0);
```

- [ ] Implement additive pending-addition persistence and strict guarded APIs. Keep missing verification/company-name state explicit. Query own memberships and personal additions in a deduplicated stable list. A card is not active membership. Test on the legacy baseline and, where possible using an isolated fixture schema, the new membership/authority guard behavior.
- [ ] Write failing UI tests for active organizations navigation/page title, one input form/Enter, new saved row, errors/retry, multiple members/roles, pending-member exclusion, duplicate update and session clearing. Implement the Primer view and shell seam. Organization-list loading must be independent of provider profile loading; a missing optional profile cannot block the page.

```tsx
expect(screen.getByRole('heading',{level:1,name:'Мои организации'})).toBeVisible();
fireEvent.change(screen.getByLabelText('ИНН'),{target:{value:'9709128511'}});
fireEvent.submit(screen.getByRole('form',{name:'Добавить организацию'}));
expect(await screen.findByText('9709128511')).toBeVisible();
```

- [ ] Include the new direct route in immutable web packaging; test direct reload and Back/Forward. Preserve the old accepted routes and profile fixture runtime. Add only current ownership layers needed by new/changed files.
- [ ] Run focused changed tests while iterating, then complete API tests, web/profile-preview/composition suites, typecheck/lint/build, Primer validator and required layout/provenance/route checks once before committing. Refresh an external GitNexus index for this worktree and run detect_changes with the explicit worktree before commits. Resolve graph unknowns via source references rather than treating zero callers as safety.
- [ ] Self-review and commit only the task files with PROJ-162; write full report with RED/GREEN outputs, schema/contracts, covering commands and any missing name/role-provider capability. Controller performs independent task review, fix loop and final review before pushing.

## Task 2: Reviewable delivery

**Owner:** Controller; read-only review agents.

- [ ] Verify browser UI on narrow/mobile, tablet and desktop through Codex IAB with a local test fixture server backed by the isolated database. Use no fictional companies in the live API. Reload and read back after adding; verify the table and multiple-role presentation. Browser fixture data must be labeled or confined to the test server. Save screenshot and show the result.
- [ ] Complete required quality gates; verify clean final tree and exact GitHub commit/PR diff. Push the branch and create a draft PR based on `codex/PROJ-160-cabinet-profile` with `OP#PROJ-162` and `OP#PROJ-5`.
- [ ] Attach the PR to this chat, verify it through OpenProject `github_pull_requests` for both IDs under user8. Report PR/task links, checks, and the explicit name-confirmation limitation. No deployment, merge or production publication is implied by this request.

## Review of scope

This is one coherent feature: personal INN additions plus visibility of already joined organizations. Member approvals and external verification are separate. The independent additive table avoids uncommitted sibling migrations and makes no authority claim. Unknown names remain explicit; the table never substitutes an invented company. The user-approved pending behavior matches the existing rule that an INN alone does not confer corporate rights.
