# PROJ-166: Sber profile synchronization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At each successful Sber ID login, persist changed returned profile values and show the saved values in the current user's cabinet.

**Architecture:** SberClient validates and normalizes an allowlisted profile, then AuthStore synchronizes it under the existing account transaction and lock. public.persons remains provider-neutral; identity_profiles retains source provenance. GET /api/profile and the existing Primer presentation consume the canonical saved values.

**Tech Stack:** Node.js >=24 <25, TypeScript, NestJS/Fastify, pg, PostgreSQL 18.6, React 19.2.8, Primer 38.37.0.

## Approved design and global constraints

- The human confirmed: all current profile fields are managed by Sber; at every login compare saved Forum values with received Sber values and save Sber values on differences. This supersedes PROJ-161's preservation of manual canonical edits for Sber authentication only.
- An absent field means no new information: retain the saved value. Apply this to absent nested object children as well. An explicit null or empty scalar is an explicitly returned empty value, normalized to null. Keep false for is_self_employed.
- Only the current authenticated subject/aliases identify the account. Email/phone never link identities. Keep blocked accounts, sessions, scopes, optional participant and company access rules intact.
- Sber remains a trusted adapter, not a browser-selected provider. Other configured providers keep their existing canonical-profile behavior.
- Profile data is persisted before the new session inside the existing transaction; any failed write rolls everything back.
- Store only reviewed canonical fields and reviewed nested children. Unknown attributes are discarded. Invalid types, impossible dates, and invalid identity responses fail as invalid_provider_response without a new session or partial writes.
- Dates accept YYYY-MM-DD and DD.MM.YYYY and normalize to YYYY-MM-DD, including document dates. Zero placeholder dates are unavailable values and normalize to null.
- Keep JSONB equality structural: object key ordering must not produce a change. Apply canonical assignments only when at least one supplied canonical value actually differs. Provider received/authenticated timestamps still refresh on login.
- Refresh public.users display_name and email when corresponding Sber attributes were supplied so the account header/session agrees with saved profile data. Do not erase account contact/name data just because a field was absent. Email confirmation remains tied to the matching returned email_verified flag.
- GET /api/profile keeps {userId,profile}, returns only the owner's allowlisted canonical fields, and excludes sub, source metadata, snapshots and tokens. Missing values render «Не передано».
- No schema migration, new authentication method, webhook, refresh-token storage, UI editor or company functionality is in scope. No production deployment. Request only scopes actually approved for this Sber application; do not blindly enable Professional scopes.
- Real OpenProject task: PROJ-166 (API id204), parent PROJ-35 (API id72). Branch codex/PROJ-166-sber-profile-sync. Commits, push, PR body OP#PROJ-166 and OP#PROJ-35, verified OpenProject GitHub linkage, Codex attachment are required.
- Only docs/plans contains committed Markdown plans. Preserve unrelated source, branches, worktrees and deployment bytes.

## Verified starting evidence

The branch starts at 1afee9fd9e1055b52ddcf607d26f57ffb115326a. Baseline API suite passes 93/93 using a dedicated local PostgreSQL 18.6 container. GitNexus forum-sber-profile-sync is current with schema4 runner receipt, complete PDG index and no incompleteReasons; dynamic callback calls need source inspection because graph trace has no path. Callback directly calls identify then authenticate then complete. Cabinet already fetches /api/profile and uses all profile fields.

Live dev API code matches the inspected three IAM files. Runtime requests only openid; recorded snapshots contain no name/document/address values. Sber's public userinfo specification has both date formats in examples. Portal permissions remain unverified; the built-in browser rejects the portal certificate. Code support must not be presented as proof that live scopes are enabled.

Sources: https://developers.sber.ru/docs/ru/sberid/service/reqdescription/datareq/overview and https://developers.sber.ru/docs/ru/sberid/service/scopes .

## Implementation sequence

### Task 1: Normalize and synchronize Sber data through the saved profile and cabinet

**Files:**
- Create apps/api/src/iam/sber-profile.ts: reviewed field/child validation, scope-aware projection and date normalization.
- Create apps/api/test/sber-profile.test.ts: pure normalization/validation regression scenarios.
- Modify apps/api/src/iam/sber-client.ts: attach normalized profile to SberIdentity after subject validation, retain existing token/nonce/mTLS/alias checks.
- Modify apps/api/src/iam/auth-store.ts: Sber-only synchronization, structural comparison, missing-field preservation, current user name/contact refresh, existing source snapshot and atomic session logic.
- Modify apps/api/test/auth.test.ts and apps/api/test/person-memberships.test.ts: real HTTPS provider and PostgreSQL regression tests; replace the now-obsolete Sber manual-edit-preservation assertion, retaining the generic-provider policy test.
- Modify apps/web/src/home/Cabinet.test.tsx only as needed to exercise all returned saved values and a changed profile after renewed login. No component/layout changes are required if existing formatters support the normalized DTO.
- Modify apps/api/README.md and deployment/forum-api/.env.example: document the new Sber precedence, absent vs explicit empty behavior and approved-scope configuration. Keep the example default openid and provide commented approved-scope examples.
- Add artifacts/repository-audits/proj-166-sber-profile-sync-ownership.json and narrowly update the operational verifier only if its source ownership contracts require the reviewed new candidate bytes.

**Interfaces:**
- Consumes SberConfig.scope, token.scope when provided, authenticated userinfo with matching sub, and canonicalProfileFields.
- Produces normalizeSberProfile(profile:Record<string,unknown>, requestedScopes:readonly string[], grantedScopes?:readonly string[]):PersonProfile, available on SberIdentity.profile?:PersonProfile. Effective allowed profile scopes are requested scopes intersected with granted scopes when granted scopes exist; otherwise requested scopes. Map mobile to phone_number, name to its three name fields, maindoc to identification, previous_name to three previous names, and every other documented attribute to its explicit scope. Generic address remains allowlisted only where a documented mapping exists; do not invent a request scope.
- AuthStore.authenticate remains the same public method and AuthStore.profile returns the same DTO. AccountIdentity can inherit profile from SberIdentity.

- [ ] **Step 1: Write discriminating regression tests before implementation.**

Pure tests cover projected Professional fields, YYYY-MM-DD/DD.MM.YYYY normalization, leap days, invalid dates, explicit null/empty, false, wrong object/scalar types, unknown child filtering, requested/granted scope restriction. A representative expectation:

```ts
assert.deepEqual(normalizeSberProfile({birthdate:'02.03.2001',is_self_employed:false,sub:'not-public',bank_balance:100},['openid','birthdate','is_self_employed']), {birthdate:'2001-03-02',is_self_employed:false});
assert.throws(()=>normalizeSberProfile({birthdate:'31.02.2001'},['openid','birthdate']), /invalid_provider_response/);
```

Real provider/DB tests must prove: first login saves extended data; second login overwrites different canonical values including a previously manually changed family_name; unchanged structural JSON values do not execute a canonical update; absent top-level and nested attributes retain values; explicit null clears a supplied value; false replaces true; another user is untouched; snapshots and scope provenance agree; blocked/conflicting/malformed cases create no partial data/session; generic provider repeated login preserves its established canonical behavior. Capture RED output against the starting implementation.

- [ ] **Step 2: Run focused RED tests.**

```sh
npm run typecheck --prefix apps/api
TEST_DATABASE_URL=<dedicated loopback test database from /tmp/proj166-test-db.json> npm test --prefix apps/api
```

Tests already protect against non-loopback/non-test databases. Compiler failure for the missing new function is valid initial RED; additionally run a provider/DB comparison regression against the pre-fix store to prove behavioral failure.

- [ ] **Step 3: Implement validation and transactional synchronization minimally.**

Use existing AuthError('invalid_provider_response',502), existing request-size bound, fixed field allowlists, parameterized SQL, existing user FOR UPDATE/advisory locking and transaction. Normalize before any writes. Text values trim; dates validate the actual calendar. Document objects allow only reviewed children from migration002; description.code and priority_doc.type accept documented number/string representations and normalize safely. Preserve nested absent children with a shallow JSONB merge of reviewed one-level objects; explicit null replaces the object. Do not merge prototype keys or unknown children.

Canonical comparison follows this SQL pattern for each supplied attribute, with identifiers generated only from canonicalProfileFields:

```sql
UPDATE public.persons AS current
SET family_name = incoming.family_name
FROM jsonb_populate_record(NULL::public.persons,$2::jsonb) AS incoming
WHERE current.user_id=$1 AND $2::jsonb ? 'family_name'
  AND current.family_name IS DISTINCT FROM incoming.family_name;
```

Use one coherent update for supplied fields, preserving unsupplied fields. JSONB object merges and comparison happen before assignment. The source snapshot is reduced to the same reviewed normalized input, refreshed for this identity, and cannot enter the public DTO. Keep the deprecated Sber compatibility snapshot coherent without restoring generated-column coupling.

- [ ] **Step 4: Verify focused GREEN and full relevant checks once.**

```sh
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
TEST_DATABASE_CONTAINER=forum-proj166-auth-tests TEST_DATABASE_URL=<dedicated loopback test database> npm test --prefix apps/api
npm test --prefix apps/web
npm test --prefix apps/profile-preview
npm run typecheck --prefix apps/web
npm run lint --prefix apps/web
npm run build --prefix apps/web
node scripts/verification/check-repository-layout.mjs --strict-docs
python3 scripts/verification/check-operational-sources.py
```

Use the current package scripts. Do not use external browsers. Browser proof, when possible, runs in the Codex iab against an isolated fixture/local cabinet with synthetic data, never fabricated accounts in the main database. If no UI code changed, API persistence and existing formatter integration tests suffice; disclose any missing real-account proof.

- [ ] **Step 5: Refresh graph, stage, detect_changes and commit atomically.**

Before edits use Build-current/index-current, impact for changed existing symbols and api_impact for /api/profile if the route contract changes. Refresh after relationship-affecting edits. Account for missing dynamic graph edges with source searches. Require a full non-partial non-truncated staged detector gate.

```sh
git add <only task paths>
gitnexus detect-changes --scope staged --repo forum-sber-profile-sync
git commit -m 'PROJ-166: synchronize returned Sber profile values at every login'
```

Record exact commands, RED/GREEN results and all changed files in the task report. No main-db fixture writes or production configuration changes.

## Acceptance and completion

Task review and final whole-branch review must be clean. Push the feature branch, create PR to main with both task links, attach it and verify OpenProject linkage. CI must pass on the published head before claiming checks complete. Report source implementation separately from enabling real approved scopes/deployment. Preserve all review evidence in a small committed delivery audit before deleting this plan's ignored SDD workspace.

## Implementation context

```json
{
  "evidence_provenance": {
    "schema_version": 2,
    "head_commit": "1afee9fd9e1055b52ddcf607d26f57ffb115326a",
    "generated_plan_path": "docs/plans/2026-10-09-gitnexus-plan-sber-profile-sync.md",
    "global_dirty_digest": {
      "algorithm": "sha256",
      "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
      "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
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
        "head_digest": "sha256:4a009077e2088eb1bae3ce13d1068d1cd7ce530c25b34c16b380980436a8b8a1",
        "index_digest": "sha256:4a009077e2088eb1bae3ce13d1068d1cd7ce530c25b34c16b380980436a8b8a1",
        "worktree_digest": "sha256:4a009077e2088eb1bae3ce13d1068d1cd7ce530c25b34c16b380980436a8b8a1",
        "untracked_digest": "absent"
      },
      {
        "path": "apps/api/migrations/002_profiles.sql",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
        "index_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
        "worktree_digest": "sha256:890208666c3ce3312d208390b54340c4b7f77193778f13352c3c1513cae56998",
        "untracked_digest": "absent"
      },
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
        "head_digest": "sha256:8e644dba361d14298303278263866fd8e27be8747fd1d959d5455ed9964e572e",
        "index_digest": "sha256:8e644dba361d14298303278263866fd8e27be8747fd1d959d5455ed9964e572e",
        "worktree_digest": "sha256:8e644dba361d14298303278263866fd8e27be8747fd1d959d5455ed9964e572e",
        "untracked_digest": "absent"
      },
      {
        "path": "apps/api/src/iam/person-profile.ts",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:f5d13ff7fbd2d2bb51c86e9dd207724e52a2dbda951cbfdb9c1475d5bbeee37c",
        "index_digest": "sha256:f5d13ff7fbd2d2bb51c86e9dd207724e52a2dbda951cbfdb9c1475d5bbeee37c",
        "worktree_digest": "sha256:f5d13ff7fbd2d2bb51c86e9dd207724e52a2dbda951cbfdb9c1475d5bbeee37c",
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
        "head_digest": "sha256:4c8d6945ddea32bf6a5af98d722a39f72b8ad52b6dce8422719dcfa109453c6a",
        "index_digest": "sha256:4c8d6945ddea32bf6a5af98d722a39f72b8ad52b6dce8422719dcfa109453c6a",
        "worktree_digest": "sha256:4c8d6945ddea32bf6a5af98d722a39f72b8ad52b6dce8422719dcfa109453c6a",
        "untracked_digest": "absent"
      },
      {
        "path": "apps/api/test/auth.test.ts",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:a1ce21614bed0b38d77e18bfeb942a48f4db68418295766ca186e5a5260443db",
        "index_digest": "sha256:a1ce21614bed0b38d77e18bfeb942a48f4db68418295766ca186e5a5260443db",
        "worktree_digest": "sha256:a1ce21614bed0b38d77e18bfeb942a48f4db68418295766ca186e5a5260443db",
        "untracked_digest": "absent"
      },
      {
        "path": "apps/api/test/person-memberships.test.ts",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:ec4df2cd6ef3c7ff3997c36f3b7e7a7c0d9cdea366fb74977d6805a01053a2cd",
        "index_digest": "sha256:ec4df2cd6ef3c7ff3997c36f3b7e7a7c0d9cdea366fb74977d6805a01053a2cd",
        "worktree_digest": "sha256:ec4df2cd6ef3c7ff3997c36f3b7e7a7c0d9cdea366fb74977d6805a01053a2cd",
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
        "head_digest": "sha256:de732f5dd8a133d547442d3453a87fec7abd30c657177a6f6ab42a67f5ce91fe",
        "index_digest": "sha256:de732f5dd8a133d547442d3453a87fec7abd30c657177a6f6ab42a67f5ce91fe",
        "worktree_digest": "sha256:de732f5dd8a133d547442d3453a87fec7abd30c657177a6f6ab42a67f5ce91fe",
        "untracked_digest": "absent"
      },
      {
        "path": "apps/web/src/home/Cabinet.test.tsx",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:fa2794f0d3ea4410d1b92c36622859d1a2d09bd0aa11bbd852085845a5d82fdc",
        "index_digest": "sha256:fa2794f0d3ea4410d1b92c36622859d1a2d09bd0aa11bbd852085845a5d82fdc",
        "worktree_digest": "sha256:fa2794f0d3ea4410d1b92c36622859d1a2d09bd0aa11bbd852085845a5d82fdc",
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
        "head_digest": "sha256:2adabfc1f9d2ac3a969e8a08d72554ab70d32efa25f65995033892779b48ec33",
        "index_digest": "sha256:2adabfc1f9d2ac3a969e8a08d72554ab70d32efa25f65995033892779b48ec33",
        "worktree_digest": "sha256:2adabfc1f9d2ac3a969e8a08d72554ab70d32efa25f65995033892779b48ec33",
        "untracked_digest": "absent"
      },
      {
        "path": "deployment/forum-api/.env.example",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:5e0e8f509fc4126cb05ebc4266243075443b1dc4c3d94b23cb0939629b5d1342",
        "index_digest": "sha256:5e0e8f509fc4126cb05ebc4266243075443b1dc4c3d94b23cb0939629b5d1342",
        "worktree_digest": "sha256:5e0e8f509fc4126cb05ebc4266243075443b1dc4c3d94b23cb0939629b5d1342",
        "untracked_digest": "absent"
      },
      {
        "path": "deployment/forum-api/grant-runtime.sql",
        "object_kind": {
          "head": "regular",
          "index": "regular",
          "worktree": "regular",
          "untracked": "absent"
        },
        "state": "clean",
        "rename_from": null,
        "rename_to": null,
        "head_digest": "sha256:312768e6d6e430fda89f21bcf710bce1bd21a3cc852cd1618c2eb468473485a8",
        "index_digest": "sha256:312768e6d6e430fda89f21bcf710bce1bd21a3cc852cd1618c2eb468473485a8",
        "worktree_digest": "sha256:312768e6d6e430fda89f21bcf710bce1bd21a3cc852cd1618c2eb468473485a8",
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
        "head_digest": "sha256:2f1cb3def5745a1c84cc5b4f2879f1bb430a2717a8103cc7c73d50dfac469759",
        "index_digest": "sha256:2f1cb3def5745a1c84cc5b4f2879f1bb430a2717a8103cc7c73d50dfac469759",
        "worktree_digest": "sha256:2f1cb3def5745a1c84cc5b4f2879f1bb430a2717a8103cc7c73d50dfac469759",
        "untracked_digest": "absent"
      }
    ]
  },
  "acceptance_criteria": [
    "Every returned Sber canonical value replaces a differing saved value atomically at login",
    "Absent fields retain saved values; explicit null clears and false persists",
    "Extended profile fields normalize safely and are displayed by existing cabinet",
    "Generic providers, identity ownership, business access and DTO secrecy remain intact"
  ],
  "primary_symbols": [
    "SberClient.identify",
    "AuthStore.authenticate"
  ],
  "files_to_modify": [
    "apps/api/src/iam/sber-client.ts",
    "apps/api/src/iam/auth-store.ts",
    "apps/api/src/iam/person-profile.ts",
    "apps/api/test/auth.test.ts",
    "apps/api/test/person-memberships.test.ts",
    "apps/web/src/home/Cabinet.test.tsx",
    "apps/api/README.md",
    "deployment/forum-api/.env.example",
    "scripts/verification/check-operational-sources.py",
    "apps/api/src/iam/sber-profile.ts",
    "apps/api/test/sber-profile.test.ts",
    "artifacts/repository-audits/proj-166-sber-profile-sync-ownership.json"
  ],
  "avoid": [
    "Live main database fixtures",
    "Production deployment",
    "Blindly enabling unapproved scopes",
    "New auth providers or refresh token storage"
  ],
  "open_questions": [
    "Exact allowed Sber application scopes, requested asynchronously from the user. This blocks live scope activation, not implementation/tests."
  ]
}
```
