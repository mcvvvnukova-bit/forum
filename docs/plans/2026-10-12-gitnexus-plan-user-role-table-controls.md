# User Role Table Controls Implementation Plan
> For agentic workers: use subagent-driven-development for the single task below.
> Evidence verified at commit 67803633da05c83198ac6ecde326e3d54c942f6b; CLI and context index exact/current schema4; MCP queries emit stale-cache metadata, so source weighted.
> Evidence provenance schema2, global dirty digest efb3e9febd16e17f0b61237ad3a036d110b838fc6f906d2bd9bad71c334fcb1c; 9 sorted cited paths; only docs/plans/2026-10-12-gitnexus-plan-user-role-table-controls.md excluded.
**Goal:** Implement seven browser annotations on /cabinet/users/ locally.
**Architecture:** Reuse existing Primer controls and protected IAM mutations; local complete-directory sort/filter. Multiple selected roles use separate existing requests with truthful partial results.
**Tech Stack:** React19.2.8, Primer38.37.0/Octicons19.33.0, TypeScript/Vitest.
## Global Constraints
- LOCAL ONLY; keep codex/PROJ-171-administration-menu and unrelated Diadoc untracked document; commit with PROJ-171, no external writes.
- Primer-only Light UI; retain existing semantic tokens, authorization/CSRF/context/idempotency/If-Match, abort generations and shared role/access busy guard.
- First tab “Роли”; heading/table “Пользователи со служебными ролями”; only users with at least one active platform assignment, including blocked accounts.
- Second tab retains blocking/unblocking and its blocked-only table. Organization context flow remains unchanged.
## Objective (§1)
User can search an eligible user, select multiple roles, and revoke a specific existing role in its user's row. Both tables have functional data-column sorting/filtering.
## Current Behaviour (§2–3)
[verified] RoleManagementSection.tsx79–239 owns authorized loading, native select, single-role grant, selected-user revoke and tabs. PlatformUsersTable.tsx6–17 renders both directory tables. UserAccessSection.tsx1–95/134 owns bare PATCH merges and snapshots.
[verified] API role-mutations.ts77–99 permits revoking a blocked target, with assignment version and last-admin enforcement; no API change required.
## Findings (§4–5)
[graph] query/context/trace locate RoleManagementSection→PlatformUsersTable; impact exact UIDs reports shared HIGH radius: Cabinet caller; table callers RoleManagementSection and UserAccessSection. Source imports verified these contracts; organization consumers use unchanged helper exports.
[verified] pdg_query controls returned no statements; no absence-of-dependency/safety inference. Current source guards are required constraints. MCP emits behind4 while CLI/context exactHEAD current: cached graph limitation retained.
[verified] Installed Primer includes SelectPanel search and Table.Head/Header/Row/Cell compositions. DataTable built-in sort wraps header in a button; combining filter buttons requires separate sibling controls in Primer Table.Header.
## Proposed Changes (§6)
RoleManagementSection composes SelectPanel with typed filtering/keyboard selection, CheckboxGroup for new roles, and explicit-target row revoke. PlatformUsersTable uses Primer Table, sort state/aria-sort and anchored filter controls for name, roles and status; roles-only filtering remains explicit.
## Implementation Sequence (§7)
### Task 1: Role form and table controls
**Files:** modify the two UI files, roles.test.tsx and receipt/checker; create platform-users-table.test.tsx; include this exact plan in task ownership.
**Interfaces:** PlatformUsersTable adds onRevoke(item:UserDirectorySummary,role:PlatformAssignment) and rolesOnly?:boolean; retain onUnblock/disabled/state/onRetry. Use existing DirectorySnapshot/PlatformAssignment contracts. Parent mutation must receive targetUserId rather than selected closure for table actions.
- [ ] Write focused behavioral tests for pack scenarios; prove new search/multi-grant and functional table regressions fail against old implementation. Do not weaken security/race/organization assertions when adapting native-select tests.
- [ ] Change tab label to “Роли”. Wrap both panels in Stack paddingBlock="normal" for consistent space under the tabs; no style literals or Primer internal overrides.
- [ ] Use Primer SelectPanel directly for platform-role user selection, with case-insensitive substring search over loaded eligible displayName values, keyboard options, clear selection, empty-search text and disabled guards. Preserve dirty-selection dialog and return focus to new anchor; corporate native select unchanged.
- [ ] Replace platform role select with labelled CheckboxGroup and moderator/admin checkboxes. Default new-role choice remains moderator; existing active roles shown checked/disabled with “Уже назначена”. Compute only selected unassigned roles; disable grant if no user/new choice. Keep individual role button copy for one choice and plural for multiple.
- [ ] Assign selected roles through existing protected requests sequentially under one busy guard. Snapshot target/context; validate each response against that target/role. Preserve each success immediately, stop on failure, report partial progress and retry only remaining choices with same key for uncertain request. Do not reset successful state or claim all roles saved after partial failure. Stale/forbidden/expired still clear sensitive state; invalidate/replace delayed selector reads as before.
- [ ] Remove selected-user revoke block. Add table action per active role with user+role accessible name; invoke exact UUID/version/explicit target, including blocked users. Preserve form draft for another selected user. Update directory/selector snapshots and access revision without allowing old reads to reinsert assignments. Maintain self-revoke/last-admin error behavior and return focus after last row action disappears.
- [ ] Rename roles table to “Пользователи со служебными ролями” and filter active assignments only. Its meaningful empty text is “Нет пользователей со служебными ролями”. Do not hide blocked role holders.
- [ ] Compose Primer Table headers with sibling sort/filter IconButtons (Octicons). Every data column in both tables supports actual sorting and filtering; apply all filters together to entire loaded list. Case-insensitive name search, platform-role filter, access-status filter, stable ascending/descending sorting of displayed values, aria-sort, clear/reset, focus-return/Escape and no-results row with retained controls. Actions column retains user-specific actions. Use focusable Primer horizontal table region on narrow screens.
- [ ] Run full web/type/lint/build/Primer and ownership gates once after final source freeze. Update receipt sourceSha to pre-taskHEAD, candidate/new hashes and canonical checker digest; preserve historical evidence. Stage only task files. Run staged detect_changes, commit PROJ-171, ordinary final index refresh and complete final detect gate; report source fallback if tool data insufficient per AGENTS.
**Concrete test pattern:** after choosing B while form originally A, click table button labelled with B+role; assert PATCH ends with B assignment UUID, quoted version and correct platform headers; resolve response and assert A draft retained/B assignment absent. For partial grant return201 for moderator then503 for admin; retry must issue only admin using same key. Test header aria-sort and visible row ordering rather than asserting implementation state.
## Test Strategy (§8)
Use the concrete pack scenarios and real located scripts; root owns IAB acceptance at390/768/1864 and screenshots. API behavior unchanged, existing final55 integration tests retained as baseline; new UI request contracts covered by web tests.
## Implementation Context (§11)
```json
{
  "implementation_context": {
    "task_summary": "Implement all seven browser comments on platform user administration, with role-holder-only table clarified by user",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "67803633da05c83198ac6ecde326e3d54c942f6b",
      "generated_plan_path": "docs/plans/2026-10-12-gitnexus-plan-user-role-table-controls.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "efb3e9febd16e17f0b61237ad3a036d110b838fc6f906d2bd9bad71c334fcb1c"
      },
      "cited_path_manifest": [
        {
          "path": "AGENTS.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c477d3900eafc775bb10279851dd99cf49a9c6f5ba1e268065e7658b5fcd22d4",
          "index_digest": "sha256:c477d3900eafc775bb10279851dd99cf49a9c6f5ba1e268065e7658b5fcd22d4",
          "worktree_digest": "sha256:c477d3900eafc775bb10279851dd99cf49a9c6f5ba1e268065e7658b5fcd22d4",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/iam/role-mutations.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ba9c0ff4850b54a1a63f5e337b2a32641b03f8be0f03efc245e2ca6b0e7af872",
          "index_digest": "sha256:ba9c0ff4850b54a1a63f5e337b2a32641b03f8be0f03efc245e2ca6b0e7af872",
          "worktree_digest": "sha256:ba9c0ff4850b54a1a63f5e337b2a32641b03f8be0f03efc245e2ca6b0e7af872",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ee5c1f886318bf61f2e9b4d111b065c8e651256a5bda4c4fcc74e2445c08eb16",
          "index_digest": "sha256:ee5c1f886318bf61f2e9b4d111b065c8e651256a5bda4c4fcc74e2445c08eb16",
          "worktree_digest": "sha256:ee5c1f886318bf61f2e9b4d111b065c8e651256a5bda4c4fcc74e2445c08eb16",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/PlatformUsersTable.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:39bbd0d43529e237d9234b1977e828eefa8657de7df3122e766b6194cf7d830e",
          "index_digest": "sha256:39bbd0d43529e237d9234b1977e828eefa8657de7df3122e766b6194cf7d830e",
          "worktree_digest": "sha256:39bbd0d43529e237d9234b1977e828eefa8657de7df3122e766b6194cf7d830e",
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
          "head_digest": "sha256:1c9eff4cdc7e30b109e670172a49b605598489f150c6e8dffabaadae4f740ab1",
          "index_digest": "sha256:1c9eff4cdc7e30b109e670172a49b605598489f150c6e8dffabaadae4f740ab1",
          "worktree_digest": "sha256:1c9eff4cdc7e30b109e670172a49b605598489f150c6e8dffabaadae4f740ab1",
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
          "head_digest": "sha256:d4118f9e42edf0af2d52b27c5ddaed93b75a8fe759538461dc9d3369111fa746",
          "index_digest": "sha256:d4118f9e42edf0af2d52b27c5ddaed93b75a8fe759538461dc9d3369111fa746",
          "worktree_digest": "sha256:d4118f9e42edf0af2d52b27c5ddaed93b75a8fe759538461dc9d3369111fa746",
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
          "head_digest": "sha256:fc75cdb77dd9450126926705d2d09df07637099b52dec3c98ab7f586fe5c44eb",
          "index_digest": "sha256:fc75cdb77dd9450126926705d2d09df07637099b52dec3c98ab7f586fe5c44eb",
          "worktree_digest": "sha256:fc75cdb77dd9450126926705d2d09df07637099b52dec3c98ab7f586fe5c44eb",
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
          "head_digest": "sha256:061fc25a08bb269d60d0390798954c568c3edc4c1c3dff2933c294f36bc555fd",
          "index_digest": "sha256:061fc25a08bb269d60d0390798954c568c3edc4c1c3dff2933c294f36bc555fd",
          "worktree_digest": "sha256:061fc25a08bb269d60d0390798954c568c3edc4c1c3dff2933c294f36bc555fd",
          "untracked_digest": "absent"
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
          "head_digest": "sha256:6a9a403fa604b0d757d0eeb1bce2343c7cd5b044f57f3c97b4127226d6db6216",
          "index_digest": "sha256:6a9a403fa604b0d757d0eeb1bce2343c7cd5b044f57f3c97b4127226d6db6216",
          "worktree_digest": "sha256:6a9a403fa604b0d757d0eeb1bce2343c7cd5b044f57f3c97b4127226d6db6216",
          "untracked_digest": "absent"
        }
      ]
    },
    "files_to_modify": [
      {
        "file": "apps/web/src/home/RoleManagementSection.tsx",
        "symbols": [
          "RoleManagementSection"
        ],
        "intended_change": "Searchable Primer SelectPanel, multi-role checkbox grants with partial-success handling, row-specific revocation, tab/copy/padding"
      },
      {
        "file": "apps/web/src/home/PlatformUsersTable.tsx",
        "symbols": [
          "PlatformUsersTable"
        ],
        "intended_change": "Primer Table headers with real sort/filter controls and specific row actions, roles-only view option"
      },
      {
        "file": "apps/web/src/home/roles.test.tsx",
        "symbols": [],
        "intended_change": "Adapt selector interactions; multi-grant/partial retry/row revoke security and stale-response regressions"
      },
      {
        "file": "apps/web/src/home/platform-users-table.test.tsx",
        "symbols": [],
        "intended_change": "Create functional sort/filter/empty/actions regression coverage"
      },
      {
        "file": "artifacts/repository-audits/proj-171-role-model-ownership.json",
        "symbols": [],
        "intended_change": "Pin exact changed/new task files and pre-change sourceSha"
      },
      {
        "file": "scripts/verification/check-operational-sources.py",
        "symbols": [
          "ROLE_MODEL_MANIFEST_SHA256"
        ],
        "intended_change": "Regenerate canonical role-model receipt digest and checker byte pin"
      }
    ],
    "tests": [
      {
        "file": "apps/web/src/home/roles.test.tsx",
        "scenarios": [
          "Search partial name case-insensitively, keyboard select and clear; unknown query cannot grant",
          "Two selected new roles: two correctly scoped requests, global busy lock, current revoked version and distinct/reusable keys",
          "Partial grant then503: first success retained, retry only remaining role with same uncertain-operation key",
          "Revoke table user B while form selects A; exact assignment UUID/version/target parsed, no grant to B or draft reset for A",
          "Blocked role holder remains listed and can revoke; users with only revoked/no roles absent",
          "Role mutations/refusals/self-revoke/stale responses and organization isolation remain covered"
        ]
      },
      {
        "file": "apps/web/src/home/platform-users-table.test.tsx",
        "scenarios": [
          "Every data column has real sort/filter icon controls with accessible names",
          "ASC/DESC rows sort by displayed name/role/status with aria-sort",
          "Case-insensitive name, role and status filters combine, reset restores full rows",
          "Filtered no-match preserves header controls; source empty and unavailable remain distinct",
          "Row role actions identify user/assignment; access table unblock retained"
        ]
      }
    ],
    "verification_commands": [
      "npm run test --workspace apps/web",
      "npm run typecheck --workspace apps/web",
      "npm run lint --workspace apps/web",
      "npm run build --workspace apps/web",
      "npm run check:primer",
      "python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py /Users/vvv/Проекты/АСТ Форум/apps/web --format json",
      "node --test --test-name-pattern='PROJ-171' scripts/verification/checks.test.mjs"
    ],
    "pdg_constraints": [],
    "assumptions": [
      "Existing Light token layer and Primer38.37.0 remain installed: verified package and reuse existing compositions",
      "Root preview uses disposable synthetic astforum_user_access_ui_test: root owns IAB evidence, implementer must not mutate server or DB",
      "GitNexus MCP cached staleness disagrees with exact CLI/context current receipt; source contracts are authoritative until fresh ordinary final refresh"
    ],
    "open_questions": [],
    "avoid": [
      "No push/PR/deploy or external writes; local-only scope persists",
      "No changes to IAM APIs/schema/migrations/security guards or organization-specific user flow",
      "Do not include unrelated untracked Diadoc plan",
      "No invented Forum tokens, custom UI primitives, nested interactive header buttons or decorative-only filters",
      "No falsely atomic multi-role transaction or lost partial success"
    ]
  }
}
```
## Assumptions and Open Questions (§12)
User explicitly clarified role holders only; no pending product question. Existing raw Primer PDS004 sber-tokens.css7/8/9 baseline retained. MCP edge/cache/PDG limitations are not authorization proof. Push/PR/dev deferred by user.
## Definition of Done (§13)
All seven annotations functional; meaningful regressions/package/ownership checks pass, both tables verified in IAB and narrow viewport; local PROJ-171 commit and current final graph/source fallback evidence; final scoped and whole-branch review complete; unrelated files intact.
