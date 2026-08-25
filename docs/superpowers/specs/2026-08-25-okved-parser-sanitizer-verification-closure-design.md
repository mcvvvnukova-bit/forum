# OKVED parser sanitizer verification closure

Date: 2026-08-25

Status: approved design, awaiting written-spec review

## Context

The OKVED parser branch stores browser evidence as immutable, checksum-addressed raw bundles. Capture-time sanitization now protects ordinary URL, action, DOM, and form-control paths, but the final scoped review found three remaining cross-surface gaps:

1. S3 verification parses and checks the DOM but discards manifest `finalUrl` and `actions`, so a checksum-consistent browser manifest can carry a configured secret on those surfaces.
2. Screenshot overlays inspect `input`, `textarea`, and `select`, but omit a sensitive named `button`.
3. Browser manifest v2 requires a policy field but currently accepts a policy that omits mandatory names such as `auth`.

The branch is not mergeable until immutable evidence is checked by one fail-closed contract across capture, checksum construction, persistence, and S3 replay verification.

## Scope

This change closes only the three sanitizer verification gaps above. It does not change:

- the List-Org fixture-only/live gates;
- stage-1 legal-entity scope or stage-2 IP scope;
- OKVED discovery, duplicate classification, replay task/job atomicity, or financial mappings;
- browser manifest v1 quarantine or non-browser manifest v1 compatibility;
- database schema or migrations.

## Decision

Use one centralized full-bundle browser safety verifier rather than duplicate S3-specific checks.

The S3 adapter will retain all browser safety fields parsed from the immutable manifest and invoke the same browser-capture safety contract used before checksum creation. This keeps the persistence boundary and replay boundary aligned as the manifest evolves.

Alternative approaches were rejected:

- Adding independent URL/action predicates in the S3 adapter would duplicate policy logic and allow the two boundaries to drift again.
- Removing all URL, action, and button evidence would be fail-closed but would discard useful audit data unnecessarily.

## Sensitive-policy contract

For `list-org-browser` evidence, `sensitiveFormFieldNames` is an explicit persisted security policy, not an optional hint.

- Matching is case-insensitive.
- The policy must contain every name from `MANDATORY_SENSITIVE_QUERY_PARAMETERS`.
- Configured extra names remain part of the policy and checksum identity.
- Missing policy or omission of any mandatory name makes a browser raw bundle or browser manifest v2 invalid.
- Validation must not silently add mandatory names during verification, because that would conceal an invalid persisted contract.

The same policy validator is used before checksum/persistence and after manifest parsing during S3 verification.

Browser v1 remains explicitly quarantined because its screenshot and policy cannot be reverified fail-closed. Safe non-browser v1 compatibility remains unchanged. No new manifest version is introduced: v2 exists only on the current unmerged branch, and this change enforces the intended v2 invariant before release.

## Verification data flow

1. Capture builds a browser raw bundle containing sanitized DOM, redacted screenshot, `finalUrl`, candidate evidence, actions, and the complete sensitive-name policy.
2. The pre-persistence boundary validates the complete policy and calls the centralized browser safety verifier.
3. Checksum construction serializes all manifest fields, including the policy, URLs, candidate evidence, and actions.
4. S3 verification reads immutable manifest, DOM, and screenshot bytes and verifies their checksums and stored identity.
5. Manifest parsing retains `finalUrl`, `actions`, candidate evidence, and policy.
6. S3 reconstructs the browser safety input from those parsed values plus the verified DOM bytes and invokes the centralized verifier.
7. Any configured, generic, or mandatory sensitive parameter on `finalUrl`, an action target, or candidate website rejects verification.

Non-browser raw verification does not acquire browser-only policy requirements.

## Screenshot masking

The overlay pass inspects `input`, `textarea`, `select`, and `button` controls.

A control is overlaid when it is a password input, carries a generic/configured sensitive name, contains a non-empty runtime value, or otherwise contains a known redaction term. A sensitive named button is overlaid even when its `value` is empty, because visible button text, placeholder-like content, or browser rendering can still expose evidence not represented by the property value.

DOM sanitization continues to remove sensitive form controls before serialization. Screenshot masking is an independent defense for the rendered page captured before DOM persistence.

## Error handling

All new failures use the existing fail-closed raw-redaction/checksum verification path. Invalid policy is distinguished at the policy validation boundary; unsafe reconstructed browser evidence is rejected as a redaction failure. The adapter must not repair or normalize an immutable manifest in memory and then treat it as valid.

## Test design

Tests follow strict RED-GREEN TDD and assert observable boundary behavior.

1. A browser v2 raw bundle with a policy missing `auth` is rejected before checksum creation.
2. A checksum-consistent browser v2 manifest with a configured `nonce` in `finalUrl` is rejected by S3 verification.
3. The same configured secret in an action target is rejected by S3 verification.
4. The same configured secret in candidate website evidence is rejected by S3 verification.
5. A rendered sensitive named button receives a screenshot overlay even with an empty runtime value.
6. Valid current browser v2 evidence still verifies.
7. Browser v1 quarantine and safe non-browser v1 compatibility remain green.

Each regression must be observed failing for the intended reason before production code changes. The affected sanitizer/S3/browser integration tests, complete test suite, TypeScript build, migration contract, and clean fixture acceptance are rerun with `APP_MODE=fixture`, `LIST_ORG_LIVE_ENABLED=false`, PostgreSQL 5433, and MinIO 9000. Host PostgreSQL 5432 remains untouched.

## Acceptance criteria

- Capture-time and S3 verification use the same full browser safety contract.
- Browser v2 policy cannot omit any mandatory sensitive name.
- Configured secrets in manifest URL/action/candidate website cannot pass checksum-consistent S3 verification.
- Sensitive named buttons are masked in screenshots regardless of their runtime value.
- Existing manifest compatibility decisions remain unchanged.
- No live source is enabled and no stage-2 IP behavior is added.
- All affected and full tests pass, build succeeds, migrations remain reversible, fixture acceptance reconciles consistently, and the worktree is clean.
