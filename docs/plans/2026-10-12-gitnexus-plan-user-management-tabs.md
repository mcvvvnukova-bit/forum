# GitNexus Engineering Plan
> Task: PROJ-171 platform user management tabs.
> Evidence verified at commit b6b342b82cd7a18bc88af2af69a959f088a9ef5d; current CLI index, MCP query cache one commit behind.
> Provenance schema 2; global dirty digest 6efc9c9f33900f5cd633f5e5f6bc66d4f9bf105f0c5cbe6dcbd51072a7fc6831; 11 cited entries; exact generated path excluded.
## Objective (§1)
Implement the approved two-tab design at /cabinet/users/ locally.
## Current Behaviour (§2–3)
[verified] RoleManagementSection owns role mutations; UserAccessSection owns the full access directory and block/unblock mutation. Corporate role form shares the parent.
[verified] RoleStore.userAccess lists all accounts, whereas platformUsers excludes blocked/unidentified users; the directory lacks roles.
## Findings (§4–5)
[graph] query platform-user-access identifies UserAccessSection; api_impact GET /api/iam/platform-user-access reports one consumer and LOW impact. Guards require source proof.
[graph] Exact UID impact lookup did not resolve UI symbols; file-hinted context yields inconsistent global dependencies. Discard this radius and use verified import/prop boundaries.
[graph] impact userAccess file role-store resolves the method but returns UNKNOWN with zero callers; source controller delegation remains authoritative.
[graph] pdg_query controls UserAccessSection returned no statement edges; retain source-verified async guards.
## Proposed Changes (§6)
[verified] Extend RoleStore.userAccess GET rows additively, preserving mutation DTO and repeatable-read/keyset pagination.
[verified] Extend UserAccessSection directory validation/publication; parent renders the roles table, child renders blocked table and explicit actions.
[inferred] Primer UnderlinePanels (installed 38.37.0) keeps children mounted, provides real tab semantics, controlled selection and keyboard behavior.
## Implementation Sequence (§7)
Task 1 below is one coherent API/UI feature; update ownership pins only after final source freeze. Existing task branch is reused to preserve the live local preview.
## Test Strategy (§8)
Focused frontend/API tests, full web suite, type/lint/build/Primer, operational ownership tests; IAB keyboard and responsive checks on disposable synthetic database.
## Implementation Context (§11)
```json
{
  "implementation_context": {
    "task_summary": "PROJ-171: platform user management tabs and role/access tables",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "b6b342b82cd7a18bc88af2af69a959f088a9ef5d",
      "generated_plan_path": "docs/plans/2026-10-12-gitnexus-plan-user-management-tabs.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "6efc9c9f33900f5cd633f5e5f6bc66d4f9bf105f0c5cbe6dcbd51072a7fc6831"
      },
      "cited_path_manifest": [
        {
          "path": "apps/api/README.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:cb5c4448167660075d46ead03dd500a750a5c62d6ee1ab3cf1218fe9cbecf53d",
          "index_digest": "sha256:cb5c4448167660075d46ead03dd500a750a5c62d6ee1ab3cf1218fe9cbecf53d",
          "worktree_digest": "sha256:cb5c4448167660075d46ead03dd500a750a5c62d6ee1ab3cf1218fe9cbecf53d",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/iam/role-store.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e758585bbb06d7e9552406bc1c41bf76915ff3a900b39b6928c5ca7530957c91",
          "index_digest": "sha256:e758585bbb06d7e9552406bc1c41bf76915ff3a900b39b6928c5ca7530957c91",
          "worktree_digest": "sha256:e758585bbb06d7e9552406bc1c41bf76915ff3a900b39b6928c5ca7530957c91",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/test/roles.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2bfe56afc580c5a841b0c3c1186601288fd96c4c17f9f8ff72d7e8b01e8455fe",
          "index_digest": "sha256:2bfe56afc580c5a841b0c3c1186601288fd96c4c17f9f8ff72d7e8b01e8455fe",
          "worktree_digest": "sha256:2bfe56afc580c5a841b0c3c1186601288fd96c4c17f9f8ff72d7e8b01e8455fe",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/Organizations.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7ee3f8224bf872fb0aa56d5faf0b2355bd5208f6016f3f44ff69c45695225934",
          "index_digest": "sha256:7ee3f8224bf872fb0aa56d5faf0b2355bd5208f6016f3f44ff69c45695225934",
          "worktree_digest": "sha256:7ee3f8224bf872fb0aa56d5faf0b2355bd5208f6016f3f44ff69c45695225934",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/RoleManagementSection.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5738fbfde850f1b0bc26f1c673062ef95e6b997effcad8cbc0e18b77d3d833f2",
          "index_digest": "sha256:5738fbfde850f1b0bc26f1c673062ef95e6b997effcad8cbc0e18b77d3d833f2",
          "worktree_digest": "sha256:5738fbfde850f1b0bc26f1c673062ef95e6b997effcad8cbc0e18b77d3d833f2",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/UserAccessSection.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:33269fe84081d2b0266372817a1613f9d5ee6628237859f5d78e2c5a8babbe4d",
          "index_digest": "sha256:33269fe84081d2b0266372817a1613f9d5ee6628237859f5d78e2c5a8babbe4d",
          "worktree_digest": "sha256:33269fe84081d2b0266372817a1613f9d5ee6628237859f5d78e2c5a8babbe4d",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/roles.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:03931f93d55e11990ef77f7c6b5c69ea92fd6c8bfc0100df829db774f97dae9c",
          "index_digest": "sha256:03931f93d55e11990ef77f7c6b5c69ea92fd6c8bfc0100df829db774f97dae9c",
          "worktree_digest": "sha256:03931f93d55e11990ef77f7c6b5c69ea92fd6c8bfc0100df829db774f97dae9c",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/user-access.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ace2e2182b97f2d6bd2ae2005d40dcfdd08e13333cd0914deaa745e5a0213c5f",
          "index_digest": "sha256:ace2e2182b97f2d6bd2ae2005d40dcfdd08e13333cd0914deaa745e5a0213c5f",
          "worktree_digest": "sha256:ace2e2182b97f2d6bd2ae2005d40dcfdd08e13333cd0914deaa745e5a0213c5f",
          "untracked_digest": "absent"
        },
        {
          "path": "artifacts/repository-audits/proj-171-role-model-ownership.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:952847e168ceb6c2445dca2ef4844b8019e4d216e3858f33a586b0e8644bf754",
          "index_digest": "sha256:952847e168ceb6c2445dca2ef4844b8019e4d216e3858f33a586b0e8644bf754",
          "worktree_digest": "sha256:952847e168ceb6c2445dca2ef4844b8019e4d216e3858f33a586b0e8644bf754",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/plans/2026-10-12-user-management-tabs-design.md",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:7d826ff594d549e91806c0a4b77e61a966fcf37c0a9207faf50a0492fa2f119f"
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
          "head_digest": "sha256:61169d5bf76a30118882fb426e50efbb7e05f56e70809cf46a1802f87fcc14c8",
          "index_digest": "sha256:61169d5bf76a30118882fb426e50efbb7e05f56e70809cf46a1802f87fcc14c8",
          "worktree_digest": "sha256:61169d5bf76a30118882fb426e50efbb7e05f56e70809cf46a1802f87fcc14c8",
          "untracked_digest": "absent"
        }
      ]
    },
    "files_to_modify": [
      {
        "file": "apps/api/src/iam/role-store.ts",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/api/test/roles.test.ts",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/api/README.md",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/web/src/home/RoleManagementSection.tsx",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/web/src/home/UserAccessSection.tsx",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/web/src/home/roles.test.tsx",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/web/src/home/user-access.test.tsx",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "apps/web/src/home/Organizations.tsx",
        "intended_change": "Reference only"
      },
      {
        "file": "docs/plans/2026-10-12-user-management-tabs-design.md",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "scripts/verification/check-operational-sources.py",
        "intended_change": "Implement or validate tabs feature"
      },
      {
        "file": "artifacts/repository-audits/proj-171-role-model-ownership.json",
        "intended_change": "Implement or validate tabs feature"
      }
    ],
    "tests": [
      {
        "file": "apps/web/src/home/roles.test.tsx",
        "scenarios": [
          "tabs and draft preservation",
          "roles table update after mutations",
          "corporate isolation"
        ]
      },
      {
        "file": "apps/web/src/home/user-access.test.tsx",
        "scenarios": [
          "blocked-only table",
          "explicit block/unblock and row confirmation",
          "malformed roles and stale clearing"
        ]
      },
      {
        "file": "apps/api/test/roles.test.ts",
        "scenarios": [
          "blocked and unverified accounts expose platform assignments",
          "no organization roles leak",
          "existing access mutation regressions"
        ]
      }
    ],
    "verification_commands": [
      "npm run test --workspace @astforum/web",
      "npm run typecheck --workspace @astforum/web",
      "npm run lint --workspace @astforum/web",
      "npm run build --workspace @astforum/web",
      "npm run build --workspace @astforum/api",
      "npm run typecheck --workspace @astforum/api",
      "npm run check:primer"
    ],
    "pdg_constraints": [
      {
        "description": "pdg_query controls UserAccessSection returned zero statement edges; no absence-of-guards conclusion.",
        "implementation_consequence": "Preserve source-verified generation, abort and permission guards."
      }
    ],
    "assumptions": [],
    "open_questions": [],
    "avoid": [
      "No external writes/push/PR/deployment",
      "Do not repeat repository discovery",
      "Preserve unrelated Diadoc plan",
      "No auth mutation or schema redesign"
    ]
  }
}
```
## Assumptions and Open Questions (§12)
User clarification is binding: role list on first tab, blocked users on second. No unresolved questions. Preserve corporate flow and existing security contracts.
## Definition of Done (§13)
Two accessible tabs, correct synchronized tables, explicit guarded block/unblock, verified local commit and current GitNexus change report; no remote writes.
### Task 1: Platform user management tabs and tables
**Global Constraints**
- Work only locally on codex/PROJ-171-administration-menu; no push, PR, deploy, OpenProject mutation. Real task PROJ-171 is work package 209; account 8 verified read-only.
- First tab «Служебные роли»: existing role form and all registered users table with active service roles and login status. Second «Блокировка входа»: access form and only blocked users table with «Разблокировать» row action.
- Use Primer UnderlinePanels, DataTable/Table and existing brand tokens. Initial tab roles, both panels mounted, preserve role drafts; prevent switching/competing mutations while saving. Corporate flow remains unchanged.
- Preserve no-selection block button primary disabled light orange. Expose both block and unblock actions clearly, confirmation dialog and stable focus return. Self/last-admin protections, CSRF, If-Match, idempotency, session invalidation stay unchanged.
**Files and interfaces**
- Modify apps/api/src/iam/role-store.ts RoleStore.userAccess: add platformRoles array to GET list records for every account, including blocked/unidentified, using platform scope only, same transaction and keyset pagination. Assignment fields id,userId,roleCode,status,version. Keep bare UserAccess PATCH return unchanged. Document additive GET contract in apps/api/README.md.
- Modify apps/web/src/home/UserAccessSection.tsx: export strict directory summary/snapshot types as needed. Validate mandatory platformRoles items (allowed platform codes, userId match, UUIDs, status, positive version, duplicate IDs/codes). Keep bare PATCH validation and merge result onto summary so roles survive. Publish directory snapshots to parent via optional callback guarded against late updates. Existing fetch remains single full directory read.
- Modify apps/web/src/home/RoleManagementSection.tsx: controlled Primer UnderlinePanels for platform context only, parent directory snapshot and roles table. Role mutations refresh directory; access changes refresh eligible role selector as before. Preserve dirty selection guards and corporate inputs.
- New apps/web/src/home/PlatformUsersTable.tsx: presentational reusable Primer table, all rows vs blocked rows based parent input; active role labels (none: «Не назначены»), status, optional row action. Explicit loading/unavailable/empty states with existing retry callback. Use existing Organizations.tsx Table.Container pattern; no new design system, no search or new roles.
- Row unblock selects target and opens existing confirmation, stable focus return after row vanishes; form action also supports block/unblock. Clear protected table data on 401/403/404/412; keep abort/generation guards and mutual exclusion.
**Checklist**
- [ ] Add meaningful tests in apps/api/test/roles.test.ts (blocked/unidentified roles, no corporate leakage) and apps/web/src/home/roles.test.tsx/user-access.test.tsx (tabs, draft preservation, synchronized roles, blocked subset, row unblock, errors); update affected list fixtures with platformRoles arrays.
- [ ] Implement API and UI contracts above; test edge cases and corporate regressions. Use installed Primer UnderlinePanels API instead of custom tab keyboard code.
- [ ] Run focused tests while iterating, then full web suite/typecheck/lint/build and API build/typecheck + IAM tests. TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55473/astforum_user_access_test and TEST_DATABASE_CONTAINER=forum-role-model-test exclusively for IAM test suite; tsc -p tsconfig.test.json then node --test .test-build/test/roles.test.js from apps/api. Do not touch UI database used by controller.
- [ ] Freeze source; update artifacts/repository-audits/proj-171-role-model-ownership.json sourceSha to pre-feature HEAD, affected candidate/new file hashes/modes, register new source/docs files. Preserve base/history. Canonical sorted compact receipt omitting checker candidateSha256 yields ROLE_MODEL_MANIFEST_SHA256 in scripts/verification/check-operational-sources.py; then store updated checker hash. Stage only feature files, leave docs/plans/2026-10-11-001-feat-diadoc-organization-verification-plan.md untouched.
- [ ] Run operational ownership verification and 42 role-model ownership fixture tests (locate actual test module by existing verification artifacts/source imports); root legacy ignored landing prevents root full provenance, use tracked-files temp snapshot for verify_provenance. Existing raw Primer baseline is exactly PDS004 sber-tokens.css lines 7,8,9; do not change unrelated styles, record results. npm run check:primer must pass.
- [ ] Refresh GitNexus index at final source bytes, run staged detect_changes through fresh LocalBackend and save full JSON in report workspace (fail if error/partial/truncated); report affected symbols and known global checker impact without invented absence claims.
- [ ] Make local commit containing PROJ-171 and feature files; controller handles IAB verification and review. Save full report with exact commands/results/concerns, return only status/commit/test summary/report path.
