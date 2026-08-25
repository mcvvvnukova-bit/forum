# OKVED Parser Final Manifest Compatibility Design

**Date:** 2026-08-25
**Status:** Approved for implementation planning

## Context

The OKVED parser branch has two remaining merge blockers in raw-manifest verification:

1. Browser action IDs are retained in `actions[].id`, but they are neither restricted to the format produced by the application nor included in the centralized contact/secret scan.
2. Version 1 non-browser manifests existed in two historical shapes, while the current verifier accepts only the older shape and rejects the later shape emitted by the shared serializer.

The change must close both gaps without weakening fail-closed verification, changing the database schema, or making legacy browser evidence verifiable.

## Decisions

### Browser action IDs

Every retained `actions[].id` must be a canonical lowercase, hyphenated UUID v4 with the standard RFC variant. This is the exact identifier family emitted by the existing producers, which use `randomUUID()`.

The ID must also be included in the centralized browser textual-evidence scan. Format validation and content scanning are intentionally both required:

- format validation rejects forged or malformed identifiers at the manifest-schema boundary;
- content scanning ensures all retained browser action text is covered by one contact/secret policy.

At the in-memory persistence boundary, contact or secret material in an action ID is rejected by the redaction policy. During stored-manifest verification, a hostile non-UUID value is expected to fail structural parsing before the scan runs. The scan remains defense in depth and keeps all retained action text under one policy if validation order or accepted identifier formats change later.

### Historical non-browser version 1 manifests

The verifier must recognize exactly two safe version 1 schemas for non-browser sources:

1. the original schema without `sensitiveFormFieldNames`;
2. the transitional schema with `sensitiveFormFieldNames` present and equal to the empty array `[]`.

For the transitional schema, no non-empty value is allowed. A non-empty array, a value of another type, or any unknown top-level field must fail verification.

Both accepted schemas normalize to the existing internal representation with `sensitiveFormFieldNames: []`. Stored bytes are not rewritten. New manifests continue to be written as version 2.

All version 1 `list-org-browser` manifests remain quarantined regardless of which top-level fields they contain. Their screenshots cannot be re-verified against a complete persisted browser form policy.

## Components and Data Flow

### Browser sanitizer boundary

`assertBrowserCaptureSafe` will include `action.id` in the serialized action metadata passed to the existing `assertNoContactOrSecret` scan. No separate scanner or policy is introduced.

### S3 raw-manifest parser

`parseRawManifest` will select an exact allowed top-level key set from the manifest version, source kind, and presence of `sensitiveFormFieldNames`:

- version 2: the current exact v2 key set;
- non-browser version 1 without the field: the original exact v1 key set;
- non-browser version 1 with the field: the transitional exact v1 key set, followed by an exact-empty-array check;
- browser version 1: quarantine error before compatibility parsing;
- every other shape: reject.

`isBrowserActionEvent` will validate `id` with a dedicated canonical UUID v4 predicate rather than the generic retained-text predicate. The predicate must accept the lowercase hyphenated representation returned by `randomUUID()` and require both the version-4 and standard-variant bits.

Successful parsing continues through the existing checksum, identity, artifact, DOM, screenshot, and browser-safety checks. There is no bypass around current verification.

## Error Handling

Verification remains fail-closed:

- invalid or non-canonical action IDs fail raw-manifest structural verification;
- retained contact or secret material fails the browser redaction scan;
- unsupported or ambiguous v1 shapes fail raw-object checksum verification;
- version 1 browser evidence continues to fail with the existing quarantine error.

No automatic repair, schema guessing, or in-place migration of stored raw objects is allowed.

## Testing

Regression coverage must prove:

- a checksum-consistent v2 browser manifest with a non-canonical `action.id` is rejected;
- a browser raw bundle with contact or secret material in `action.id` is rejected by the centralized persistence-boundary scan;
- a checksum-consistent hostile stored manifest cannot bypass verification through `action.id`;
- the original non-browser v1 schema without `sensitiveFormFieldNames` is accepted;
- the transitional non-browser v1 schema with `sensitiveFormFieldNames: []` is accepted;
- a non-browser v1 manifest with a non-empty policy array is rejected;
- a non-browser v1 manifest with an unknown field is rejected;
- browser v1 remains quarantined;
- existing v2, sanitizer, storage, build, migration, and end-to-end checks remain green.

Tests that mutate persisted manifests must recompute their manifest checksum so they exercise semantic verification rather than failing only because bytes and checksum differ.

## Non-goals

- Changing raw-manifest version 2 or introducing version 3.
- Rewriting previously stored raw objects.
- Making browser version 1 evidence replayable.
- Changing action-event producers, database tables, parser business mappings, or external-source behavior.
- Refactoring unrelated sanitizer or storage code.

## Acceptance Criteria

The change is complete when both historical non-browser v1 schemas verify, every other v1 schema remains rejected, browser v1 remains quarantined, retained action IDs are canonical UUIDs covered by the centralized contact/secret scan, and the full existing verification suite passes from a clean worktree.
