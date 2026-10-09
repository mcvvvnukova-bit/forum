# Профиль личного кабинета — PROJ-160 Implementation Plan

> Execute in this chat with gitnexus-work. User approved prior design and dev publication.
> Exact source069932594b6c1b19c7e0d4e28f8fd821f717029e; forum-cabinet graph current, schema4 runner, incompleteReasons empty.

**Goal:** approved ProfilePage at /cabinet/ uses real owner data.
**Architecture:** session/membership guard -> read-only /api/profile -> public.persons; same presentation reused in explicit live mode, fixture mode preserved.
**Tech Stack:** Node24.18.1, React19, Primer38.37, Nest/Fastify, PostgreSQL18.6.

## Global Constraints
- Dev only; PROJ-160/API198 under PROJ-5; OpenProject author Kuzmina8.
- Existing Primer Light composition and semantic tokens; no new branding values.
- No scope expansion, migration, fixture substitution or production change.

## Objective (§1)
Expected profile and Work pages, real owned data, missing states and secure session behavior.

## Current Behaviour (§2–3)
[verified] auth.controller.ts:79 redirects to /cabinet/?auth=success; home/App.tsx:75 mounts simplified Cabinet.
[verified] ProfilePage.tsx:32 has approved UI but demo-only messages/routes. AuthStore.session rejects inactive user/session/membership.
[verified] SberClient verifies names but reduced saved snapshot omits them; public.persons exists in active forum database.

## Findings (§4–5)
[graph] query/context/trace: no public-App -> ProfilePage call path.
[graph] impact(ProfilePage,d1): preview App + test harness; preserve defaults and run preview suite.
[graph] impact(Cabinet,d1): home App; run composition and built route tests.
[graph] AuthStore impact HIGH: constructor, controller import, callback/session/logout. Full API suite covers these dependents.
PDG file control probe was capped; source guards remain authoritative; no fabricated dependency claims.

## Proposed Changes (§6)
Reuse ProfilePage, explicitly configure real messages/routes/logo/logout and owner display name; scope layout CSS to cabinet.
GET /api/profile derives user only from valid cookie/membership, omits Sber sub/tokens and rejects identifier inputs.
Persist only already validated name/contact fields; preserve existing Professional attributes; no scope expansion.
Profile loader validates response owner, cancels obsolete requests, times out, retries and clears on401/session changes.
Artifact owns cabinet/work HTML and shared presentation inputs; publisher accepts prior route inventories only for rollback compatibility.
Append current ownership layer with negative tests; preserve dated receipts.

## Implementation Sequence (§7)
- [ ] Write failing API tests: own profile200, other identity isolated, query400, inactive401, no-store; run pre-fix ->404. Implement guarded read/name persistence; complete API suite.
- [ ] Write failing UI test: actual owner email and heading Личные данные, no demo; run pre-fix -> missing heading. Implement shared live props, loader, work route/scoped CSS; run web/profile/composition/typecheck/lint.
- [ ] Add built route/mobile/logout tests; update artifact/publisher routes/input pins and rollback. Regenerate final ownership once, negative tests and Primer/review gates.
- [ ] Stage exact paths, refreshed GitNexus detect_changes, PROJ-160 commit/push, PR based on current dev PROJ-158; OP#PROJ-160 OP#PROJ-5, linkage verified and attached.
- [ ] Exact head CI success -> download immutable artifact, verify inputs/files. Private server backup/config/image checks, rollback rehearsal, exact API image and dev publication with fresh CAS, origin/HTTPS/IAB proofs.

## Test Strategy (§8)
API: two cookies with separate profiles; missing/malformed/expired/revoked/blocked sessions/memberships; no query owner selection; no-store and DTO excludes secrets/sub.
UI: pending/error/retry never show stale data, owner binding and abort/timeout, work reload, mobile menu and logout failure/success.
Example API: `assert.equal((await app.inject({method:'GET',url:'/api/profile',headers:{cookie}})).json().profile.email,'anna@example.test')`.
Example UI: `expect(await screen.findByRole('heading',{name:'Личные данные',level:1})).toBeVisible()`.

## Implementation Context (§11)
```json
{
  "implementation_context": {
    "task_summary": "PROJ-160: approved real profile at /cabinet/ and /cabinet/work/; dev only",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "069932594b6c1b19c7e0d4e28f8fd821f717029e",
      "generated_plan_path": "docs/plans/2026-10-09-gitnexus-plan-cabinet-profile-integration.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
      },
      "cited_path_manifest": [
        {
          "path": "apps/api/src/iam/auth-store.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1e6c5d12a4725694b660a643d4455a8a0a2dfa88034e3b2d5c7e704c932e3d5b",
          "index_digest": "sha256:1e6c5d12a4725694b660a643d4455a8a0a2dfa88034e3b2d5c7e704c932e3d5b",
          "worktree_digest": "sha256:1e6c5d12a4725694b660a643d4455a8a0a2dfa88034e3b2d5c7e704c932e3d5b",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/iam/auth.controller.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:90f5f5d31faa4fd5deab671fff092070d5a62ca0095014d480e65899dc97410b",
          "index_digest": "sha256:90f5f5d31faa4fd5deab671fff092070d5a62ca0095014d480e65899dc97410b",
          "worktree_digest": "sha256:90f5f5d31faa4fd5deab671fff092070d5a62ca0095014d480e65899dc97410b",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/src/iam/sber-client.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b7079506bb6354585d6133ca904037b0314e3fe2071ffe33f737b58a2e2ad57a",
          "index_digest": "sha256:b7079506bb6354585d6133ca904037b0314e3fe2071ffe33f737b58a2e2ad57a",
          "worktree_digest": "sha256:b7079506bb6354585d6133ca904037b0314e3fe2071ffe33f737b58a2e2ad57a",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/profile-preview/src/ProfilePage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6ff286610858bdd8154acc71d4382411ccf4bff6e4560bb4a286b043dfcbe180",
          "index_digest": "sha256:6ff286610858bdd8154acc71d4382411ccf4bff6e4560bb4a286b043dfcbe180",
          "worktree_digest": "sha256:6ff286610858bdd8154acc71d4382411ccf4bff6e4560bb4a286b043dfcbe180",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/profile-preview/src/profile.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2d6c70032bdb742414776af911d54bf28ddcb0f6c58cf242a0ce7da29f143464",
          "index_digest": "sha256:2d6c70032bdb742414776af911d54bf28ddcb0f6c58cf242a0ce7da29f143464",
          "worktree_digest": "sha256:2d6c70032bdb742414776af911d54bf28ddcb0f6c58cf242a0ce7da29f143464",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/App.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:53238ebe3046b1b7a96d9fdc15ed297837b5a569e49cee737a010974694e6b11",
          "index_digest": "sha256:53238ebe3046b1b7a96d9fdc15ed297837b5a569e49cee737a010974694e6b11",
          "worktree_digest": "sha256:53238ebe3046b1b7a96d9fdc15ed297837b5a569e49cee737a010974694e6b11",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/Cabinet.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a11c08e19d627bf89559f8dced55cd4a52203720a2e766e986066efb6c786daa",
          "index_digest": "sha256:a11c08e19d627bf89559f8dced55cd4a52203720a2e766e986066efb6c786daa",
          "worktree_digest": "sha256:a11c08e19d627bf89559f8dced55cd4a52203720a2e766e986066efb6c786daa",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/deployment/build-web-release.mjs",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:383650dba4ca7ce5bd1732ed9f33c7793848abb5f045acd987353a9cf4fb2c6e",
          "index_digest": "sha256:383650dba4ca7ce5bd1732ed9f33c7793848abb5f045acd987353a9cf4fb2c6e",
          "worktree_digest": "sha256:383650dba4ca7ce5bd1732ed9f33c7793848abb5f045acd987353a9cf4fb2c6e",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/deployment/web_release.py",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:53f0cb8abd529c923dec711da740d4a740676b03e22b6fc2334da0739aaa7e2a",
          "index_digest": "sha256:53f0cb8abd529c923dec711da740d4a740676b03e22b6fc2334da0739aaa7e2a",
          "worktree_digest": "sha256:53f0cb8abd529c923dec711da740d4a740676b03e22b6fc2334da0739aaa7e2a",
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
          "head_digest": "sha256:624ff27e719fde958c8597bc662fff89d1462262a39941efe75b659970e6bac3",
          "index_digest": "sha256:624ff27e719fde958c8597bc662fff89d1462262a39941efe75b659970e6bac3",
          "worktree_digest": "sha256:624ff27e719fde958c8597bc662fff89d1462262a39941efe75b659970e6bac3",
          "untracked_digest": "absent"
        }
      ]
    },
    "files_to_modify": [
      {
        "file": "apps/web/src/home/App.tsx",
        "intended_change": "Render profile routes without duplicate public layout"
      },
      {
        "file": "apps/web/src/home/Cabinet.tsx",
        "intended_change": "Load owner-bound profile with abort/timeout/401 clearing and logout"
      },
      {
        "file": "apps/api/src/iam/auth-store.ts",
        "intended_change": "Read own persisted profile via existing session guards; persist verified names"
      },
      {
        "file": "apps/api/src/iam/auth.controller.ts",
        "intended_change": "Add read-only GET /api/profile; reject query inputs"
      },
      {
        "file": "apps/api/src/iam/sber-client.ts",
        "intended_change": "Carry already validated name fields in reduced snapshot"
      },
      {
        "file": "apps/profile-preview/src/ProfilePage.tsx",
        "intended_change": "Parameterize live/preview routes, logo, account name, logout and messages"
      },
      {
        "file": "apps/profile-preview/src/profile.ts",
        "intended_change": "Display name fallback and missing values without claiming scopes"
      },
      {
        "file": "scripts/deployment/build-web-release.mjs",
        "intended_change": "Pin shared presentation inputs and own cabinet/work routes"
      },
      {
        "file": "scripts/deployment/web_release.py",
        "intended_change": "Validate new ownership and previous rollback receipts"
      },
      {
        "file": "scripts/verification/check-operational-sources.py",
        "intended_change": "Append exact PROJ-160 ownership resolver; historical receipts unchanged"
      },
      {
        "file": "apps/web/src/home/cabinet.css",
        "intended_change": "Scoped existing Primer layout"
      },
      {
        "file": "apps/api/test/auth.test.ts",
        "intended_change": "Own profile and cross-owner/blocked/expired/revoked/no-store checks"
      },
      {
        "file": "apps/web/src/home/Cabinet.test.tsx",
        "intended_change": "Loading/retry/401/owner switch/logout/work regression"
      },
      {
        "file": "apps/web/src/home/home.test.tsx",
        "intended_change": "Mock actual profile contract"
      },
      {
        "file": "apps/profile-preview/src/ProfilePage.test.tsx",
        "intended_change": "Preserve fiction mode and validate real mode"
      },
      {
        "file": "tests/e2e/public-site.spec.ts",
        "intended_change": "Built routes, reload, mobile navigation and logout"
      },
      {
        "file": "scripts/verification/checks.test.mjs",
        "intended_change": "Negative scope and byte substitution cases"
      },
      {
        "file": "artifacts/repository-audits/proj-160-cabinet-profile-ownership.json",
        "intended_change": "Final exact current source layer"
      },
      {
        "file": "deployment/release.md",
        "intended_change": "Current release/rollback evidence"
      },
      {
        "file": "apps/api/README.md",
        "intended_change": "Profile endpoint contract"
      }
    ],
    "acceptance_criteria": [
      "Approved real profile after Sber login",
      "Only active owner data; no fixtures",
      "Missing fields Не передано; Work/mobile/logout",
      "Pushed PR linked OP#PROJ-160 OP#PROJ-5; exact CI/dev proof and rollback"
    ],
    "tests": [
      {
        "file": "apps/api/test/auth.test.ts",
        "scenarios": [
          "A/B cookies -> each owns returned data; unknown userId query ->400",
          "Missing/revoked/expired/blocked session or membership ->401; no-store",
          "Verified names persist; tokens/sub omitted from DTO"
        ]
      },
      {
        "file": "apps/web/src/home/Cabinet.test.tsx",
        "scenarios": [
          "Guest -> login; pending/error -> no stale cards; retry -> own data",
          "Owner change/401 hides old data; work links/reload; logout success/failure"
        ]
      }
    ],
    "verification_commands": [
      "npm test --workspace @astforum/web",
      "npm run typecheck --workspace @astforum/web",
      "npm run lint --workspace @astforum/web",
      "npm test --workspace @astforum/profile-preview",
      "bash scripts/verification/check-api.sh",
      "npm run test:composition",
      "node --test scripts/verification/checks.test.mjs",
      "python3 scripts/verification/check-operational-sources.py",
      "python3 /Users/vvv/.codex/skills/primer-design-system/scripts/validate_primer_ui.py apps/web"
    ],
    "assumptions": [
      "Fresh server receipt source remains compatible with baseline 069932594b6c1b19c7e0d4e28f8fd821f717029e; inspect immediately before apply",
      "Runtime forum public.persons and restricted read grants remain valid; check safe metadata before apply"
    ],
    "open_questions": [],
    "avoid": [
      "No fixture redirect/import in real cabinet",
      "No OAuth scope expansion, DB migration, unrelated edits or production publication",
      "Do not rewrite historical ownership receipts",
      "Keep /cabinet/ canonical; /account not approved",
      "Do not repeat full repository discovery"
    ]
  }
}
```

## Assumptions and Open Questions (§12)
Current runtime forum and grants need fresh safe inspection before publication; no unresolved product choice.
Broader Professional scopes, editing, company and settings functionality are deferred. Existing mapping retained; live Figma inspection may be unavailable and then explicitly unverified.

## Definition of Done (§13)
Relevant tests and exact-head CI pass; committed pushed PR linked/attached; only dev published with actual own data, Work/reload/logout; backup/rollback/source/image/artifact/origin/HTTPS/IAB evidence saved.
