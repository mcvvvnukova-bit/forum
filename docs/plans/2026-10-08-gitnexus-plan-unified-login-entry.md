# Unified Login Entry Implementation Plan

> Task: PROJ-157. User-specified design: /login is the single entry; Sber creates a missing user automatically.
> Evidence verified at commit 92e7de0c227de01ecf194aeb57d3713950ed5db1; isolated worktree index forum and schema4 runner current.
> Evidence provenance schema2; exact generated plan path excluded.

## Objective (§1)
Remove the separate registration form and page, canonicalize all sign-in links, and verify the live public site.

## Current Behaviour (§2–3)
[verified] PublicAuth supports login/register modes, links and registration-only IAM parameters (PublicAuth.tsx:11-181).
[verified] public-navigation opens either route and validates saved modal background (public-navigation.ts:5-27).
[verified] Build and publisher own seven pages including register/index.html; publisher copies prior tree and does not retire this file (build-web-release.mjs:64-74; web_release.py:64-118).
[verified] Gateway resolves current static parent on each request and falls back to index.html (_serve_landing:226-236).
[verified] Live Outline diagram has one /login entry; its older prose remains historical. User request governs this change.

## Findings (§4–5)
[graph] impact(openPublicAuth, upstream depth2): HIGH, three direct callers (PublicAuth, onClick, audience openAction), all covered by current composition tests.
[graph] context/trace establish PublicAuth -> openPublicAuth -> publicPageUrl. Reanchored after external primary-branch switch; new worktree index matches source.
Source-derived ordering: preserve history state and background before opening; Close/Back restores opener; normalize old URL without forwarding product intent.

## Proposed Changes (§6)
Use one login mode/button; remove mode switch and registration copy, map obsolete same-origin anchors and callback codes to login. Keep blocking/support behavior.
Canonical /login in audience links and anonymous participation; compatibility /register paths normalize to login. No API/DB changes.
New build has six canonical pages. Publisher removes only prepared register/index.html. Gateway redirects old aliases only after that owned HTML is absent and login exists; rollback restores prior behavior.
Historical build manifests remain schema-valid; current builder/publisher strictly require six-route inventory. Add exact-path PROJ157 successor ownership without rewriting dated receipts.

## Implementation Sequence (§7)
- [ ] Add failing auth regression tests before source edits; `expect(location.pathname).toBe('/login')` for old /register, assert no registration link and intent=login.
- [ ] Simplify PublicAuth/navigation and all current public auth CTAs; adapt composition checks to one form while preserving Close/Back/Forward/focus/session/block coverage.
- [ ] Retire generated/deployed register HTML; add real exchange/rollback and GET/HEAD redirect tests.
- [ ] Finalize ownership once source settles; review and run web/composition/gateway/contract/release checks; commit/push PR linked to real OP task/parent.
- [ ] Accept exact successful CI artifact, capture live target CAS, publish dev with rollback verifier; reload every public route and audit all auth links in Codex iab.

## Test Strategy (§8)
Baseline web suite passed. Regression URL /register?auth_error=account_deactivated preserves blocking UI at /login; unknown returnTo is stripped. Legacy anchors normalize to /login, modified clicks keep normal browser semantics.
Composition checks preserve one session and held DOM; test Close/Back/Forward, safe background, errors and repeated button protection. Linux release tests remove old HTML and restore it on failure; old hashed assets remain available.

## Implementation Context (§11)
```json
{
  "implementation_context": {
    "task_summary": "PROJ-157 remove separate registration page and canonicalize public sign-in",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "92e7de0c227de01ecf194aeb57d3713950ed5db1",
      "generated_plan_path": "docs/plans/2026-10-08-gitnexus-plan-unified-login-entry.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
      },
      "cited_path_manifest": [
        {
          "path": "apps/dev-gateway/forum_dev_auth.py",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6d45b1ce43fbd8405d58de052dc5e5c5d152d2434351d9baf1629ae97eead1c3",
          "index_digest": "sha256:6d45b1ce43fbd8405d58de052dc5e5c5d152d2434351d9baf1629ae97eead1c3",
          "worktree_digest": "sha256:6d45b1ce43fbd8405d58de052dc5e5c5d152d2434351d9baf1629ae97eead1c3",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/legacy-landing/tests/test_auth_gateway.py",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:140836d2f34751b89b3ddd276ac6d515490d686074f961d48898b1e70ad1d3ca",
          "index_digest": "sha256:140836d2f34751b89b3ddd276ac6d515490d686074f961d48898b1e70ad1d3ca",
          "worktree_digest": "sha256:140836d2f34751b89b3ddd276ac6d515490d686074f961d48898b1e70ad1d3ca",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/App.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9ad1b11f3d354be35435576da8ec92f5179c464ffef45e91ca7528b0e6ea1c5f",
          "index_digest": "sha256:9ad1b11f3d354be35435576da8ec92f5179c464ffef45e91ca7528b0e6ea1c5f",
          "worktree_digest": "sha256:9ad1b11f3d354be35435576da8ec92f5179c464ffef45e91ca7528b0e6ea1c5f",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/App.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:030effa81e9ff3b334b946003cdd4917234757bd9fe4ce11beb32080ee2a3f13",
          "index_digest": "sha256:030effa81e9ff3b334b946003cdd4917234757bd9fe4ce11beb32080ee2a3f13",
          "worktree_digest": "sha256:030effa81e9ff3b334b946003cdd4917234757bd9fe4ce11beb32080ee2a3f13",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/audience/App.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:94fc764dcb4bd9300538145b50cff84e5c9ba8238c68978dc70e888fd8c8d3fd",
          "index_digest": "sha256:94fc764dcb4bd9300538145b50cff84e5c9ba8238c68978dc70e888fd8c8d3fd",
          "worktree_digest": "sha256:94fc764dcb4bd9300538145b50cff84e5c9ba8238c68978dc70e888fd8c8d3fd",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/audience/Participation.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1c56a916c9fd31a2ffd5382f7c7661239f11efebf03761ed1cc6a4328cae399e",
          "index_digest": "sha256:1c56a916c9fd31a2ffd5382f7c7661239f11efebf03761ed1cc6a4328cae399e",
          "worktree_digest": "sha256:1c56a916c9fd31a2ffd5382f7c7661239f11efebf03761ed1cc6a4328cae399e",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/audience/config.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:04a7f952c1144b4a458a84d9c27d65d20d89584f061ea1f433d7d3b421b31731",
          "index_digest": "sha256:04a7f952c1144b4a458a84d9c27d65d20d89584f061ea1f433d7d3b421b31731",
          "worktree_digest": "sha256:04a7f952c1144b4a458a84d9c27d65d20d89584f061ea1f433d7d3b421b31731",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/auth/PublicAuth.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:58bc26881f5bb8a22823b2feeadf50f163372d900fd71c0a41f28c8134928103",
          "index_digest": "sha256:58bc26881f5bb8a22823b2feeadf50f163372d900fd71c0a41f28c8134928103",
          "worktree_digest": "sha256:58bc26881f5bb8a22823b2feeadf50f163372d900fd71c0a41f28c8134928103",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/auth/PublicAuth.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:dcc0a5f465bfe347fd4a5b9a9fe82753fd43588bc8fb76cdd798fb164fafa0c5",
          "index_digest": "sha256:dcc0a5f465bfe347fd4a5b9a9fe82753fd43588bc8fb76cdd798fb164fafa0c5",
          "worktree_digest": "sha256:dcc0a5f465bfe347fd4a5b9a9fe82753fd43588bc8fb76cdd798fb164fafa0c5",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/AuthNotice.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:178e654377037475aae81cb6e17a8a0da604b497abf74b1fdce01d03c237a053",
          "index_digest": "sha256:178e654377037475aae81cb6e17a8a0da604b497abf74b1fdce01d03c237a053",
          "worktree_digest": "sha256:178e654377037475aae81cb6e17a8a0da604b497abf74b1fdce01d03c237a053",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/web/src/home/home.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7c952a9eacf79bdb36323dca951b04e07bf8b91ec70e3d6026f8185f1db868ff",
          "index_digest": "sha256:7c952a9eacf79bdb36323dca951b04e07bf8b91ec70e3d6026f8185f1db868ff",
          "worktree_digest": "sha256:7c952a9eacf79bdb36323dca951b04e07bf8b91ec70e3d6026f8185f1db868ff",
          "untracked_digest": "absent"
        },
        {
          "path": "deployment/release-manifest.schema.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3b01b7f89bd0e70bcb3af4279d70b6f692892a289b0472701def9ccb80623ca8",
          "index_digest": "sha256:3b01b7f89bd0e70bcb3af4279d70b6f692892a289b0472701def9ccb80623ca8",
          "worktree_digest": "sha256:3b01b7f89bd0e70bcb3af4279d70b6f692892a289b0472701def9ccb80623ca8",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/public-navigation.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d37db7b0d1c9b615c4b444e2942fcb0911f3bbe1842d00a2f4137c4fb024be78",
          "index_digest": "sha256:d37db7b0d1c9b615c4b444e2942fcb0911f3bbe1842d00a2f4137c4fb024be78",
          "worktree_digest": "sha256:d37db7b0d1c9b615c4b444e2942fcb0911f3bbe1842d00a2f4137c4fb024be78",
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
          "head_digest": "sha256:045b17b3d7635565cadee0f296da1a86a81f60f19838eee0e15ef01445988c73",
          "index_digest": "sha256:045b17b3d7635565cadee0f296da1a86a81f60f19838eee0e15ef01445988c73",
          "worktree_digest": "sha256:045b17b3d7635565cadee0f296da1a86a81f60f19838eee0e15ef01445988c73",
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
          "head_digest": "sha256:813230c302550f49ba86651317cb4e0bbee890bb4026767d5378c6ee4506589e",
          "index_digest": "sha256:813230c302550f49ba86651317cb4e0bbee890bb4026767d5378c6ee4506589e",
          "worktree_digest": "sha256:813230c302550f49ba86651317cb4e0bbee890bb4026767d5378c6ee4506589e",
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
          "head_digest": "sha256:252a29ea3c19a38fc65860619116ef8baf77b2abff8a7b45c2842b2a2ff38ba8",
          "index_digest": "sha256:252a29ea3c19a38fc65860619116ef8baf77b2abff8a7b45c2842b2a2ff38ba8",
          "worktree_digest": "sha256:252a29ea3c19a38fc65860619116ef8baf77b2abff8a7b45c2842b2a2ff38ba8",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/verification/checks.test.mjs",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:086877fbe5f865cd192bbc4209ba8fe061976341fc5a04b5574e5dd5a872367f",
          "index_digest": "sha256:086877fbe5f865cd192bbc4209ba8fe061976341fc5a04b5574e5dd5a872367f",
          "worktree_digest": "sha256:086877fbe5f865cd192bbc4209ba8fe061976341fc5a04b5574e5dd5a872367f",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/e2e/public-site.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:991b2c85c70755a86a1e7588992128543199debb6d9fae95955c832f5addcd10",
          "index_digest": "sha256:991b2c85c70755a86a1e7588992128543199debb6d9fae95955c832f5addcd10",
          "worktree_digest": "sha256:991b2c85c70755a86a1e7588992128543199debb6d9fae95955c832f5addcd10",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/integration/public-site-composition.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5c1f97740e2bc475f39dd377d823ece10c61feadd4b5790dc7f00150709b63f5",
          "index_digest": "sha256:5c1f97740e2bc475f39dd377d823ece10c61feadd4b5790dc7f00150709b63f5",
          "worktree_digest": "sha256:5c1f97740e2bc475f39dd377d823ece10c61feadd4b5790dc7f00150709b63f5",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/integration/test_web_release.py",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d9ef6d440062f2a9a07ac7e91d6bb41f8eec5fa12c7f923a8a0b8d1d5e54e980",
          "index_digest": "sha256:d9ef6d440062f2a9a07ac7e91d6bb41f8eec5fa12c7f923a8a0b8d1d5e54e980",
          "worktree_digest": "sha256:d9ef6d440062f2a9a07ac7e91d6bb41f8eec5fa12c7f923a8a0b8d1d5e54e980",
          "untracked_digest": "absent"
        }
      ]
    },
    "acceptance_criteria": [
      "No registration form or link remains in current public UI",
      "Every auth CTA uses /login; successful Sber login still creates missing account automatically",
      "No register/index.html in new artifact/deployed site; legacy URL redirects to login",
      "Modal background, Close/Back/Forward/focus, one session and blocked-user behavior survive",
      "Commit/push/PR linked to PROJ-157 and PROJ-35, successful CI, verified dev release"
    ],
    "primary_symbols": [
      {
        "symbol": "PublicAuth",
        "file": "apps/web/src/auth/PublicAuth.tsx",
        "lines": "11-181",
        "role": "one form and legacy URL normalization"
      },
      {
        "symbol": "openPublicAuth",
        "file": "packages/public-navigation.ts",
        "lines": "5-27",
        "role": "modal URL/history"
      },
      {
        "symbol": "deploy",
        "file": "scripts/deployment/web_release.py",
        "lines": "64-145",
        "role": "atomic retirement of old owned HTML"
      }
    ],
    "files_to_modify": [
      {
        "file": "apps/web/src/auth/PublicAuth.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "packages/public-navigation.ts",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/App.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/audience/App.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/audience/config.ts",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/audience/Participation.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/home/AuthNotice.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/auth/PublicAuth.test.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/App.test.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/web/src/home/home.test.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "tests/integration/public-site-composition.test.tsx",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "tests/e2e/public-site.spec.ts",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/dev-gateway/forum_dev_auth.py",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "apps/legacy-landing/tests/test_auth_gateway.py",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "scripts/deployment/build-web-release.mjs",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "scripts/deployment/web_release.py",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "tests/integration/test_web_release.py",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "deployment/release-manifest.schema.json",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "scripts/verification/check-operational-sources.py",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      },
      {
        "file": "scripts/verification/checks.test.mjs",
        "intended_change": "Remove registration UI/routes or verify canonical login/retirement; preserve history"
      }
    ],
    "execution_path": [
      "Public CTA -> /login modal or direct form",
      "Verified Sber identity -> existing/new user -> cabinet (backend unchanged)",
      "Old /register -> /login; no product intent survives"
    ],
    "tests": [
      {
        "file": "apps/web/src/auth/PublicAuth.test.tsx",
        "scenarios": [
          "legacy register URL renders login and preserves blocking error",
          "login has no registration switch and starts intent=login once",
          "legacy registration anchor normalizes to login"
        ]
      },
      {
        "file": "tests/integration/test_web_release.py",
        "scenarios": [
          "retire prior register HTML through real Linux atomic exchange",
          "verifier failure restores old register bytes",
          "GET/HEAD legacy paths redirect and preserve only auth_error"
        ]
      }
    ],
    "verification_commands": [
      "npm test --workspace @astforum/web",
      "npm run test:composition",
      "npm run typecheck --workspace @astforum/web",
      "npm run lint --workspace @astforum/web",
      "python3 -m unittest discover -s apps/legacy-landing/tests -p test_auth_gateway.py",
      "node --test scripts/verification/checks.test.mjs",
      "npm run check:layout",
      "python3 scripts/verification/check-operational-sources.py",
      "bash scripts/verification/check-web-release.sh EXACT_CLEAN_BUILD_ARTIFACT"
    ],
    "risks": [
      "openPublicAuth HIGH: three direct consumers in PublicAuth/onClick/audience openAction; composition tests cover them",
      "Publisher must remove only old owned register/index.html while retaining hashed assets and rollback",
      "Gateway redirect activates only when login exists and register HTML is absent, so rollback preserves prior behavior"
    ],
    "assumptions": [
      "Current dev release is f0a8d54 frontend with PROJ156 API; capture fresh live CAS before deployment"
    ],
    "open_questions": [],
    "avoid": [
      "No API/database changes or extra identity flow",
      "No production UI deployment",
      "No historical receipt or migration edits",
      "No changes to navigation diagram attachment; user already supplied target diagram",
      "Do not modify primary checkout switched by another task"
    ]
  }
}
```

## Assumptions and Open Questions (§12)
Fresh live target evidence is required immediately before publication. New /register requests preserve only auth_error; registration page is gone, compatibility redirect remains. Production, old historical documentation and diagram edits are outside scope.

## Definition of Done (§13)
Canonical login only; no registration page bytes in artifact/deployed tree; all public auth links audited; compatibility redirect and modal history verified; exact CI source published dev; PR/OP links saved; private rollback evidence retained.
