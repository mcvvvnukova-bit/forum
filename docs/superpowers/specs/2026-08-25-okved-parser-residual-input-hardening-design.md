# OKVED parser residual input hardening design

Date: 2026-08-25

## Context

The final scoped re-review of `codex/okved-parser` left two load-bearing findings:

1. retained browser evidence can miss redaction values introduced only by live DOM `href` attributes, while checksum-consistent replay accepts browser-significant named HTML entities such as `&num;` and `&commat;`;
2. the selected-OKVED CSV parser accepts non-delimiter text after a closing quote, so malformed bytes can still publish an immutable release and block a corrected retry.

The demonstrated bypasses are recorded in `.superpowers/sdd/2026-08-25-okved-parser-final-manifest-compatibility/final-fix-rereview-report.md`. This follow-up closes only those two findings. It does not alter the finance mapping, discovery behavior, database schema, manifest version, or live-source policy.

## Constraints

- Add no production dependency.
- Keep browser evidence manifest v2 and the accepted safe non-browser v1 compatibility shapes unchanged.
- Preserve centralized browser evidence scanning, canonical UUID action IDs, compact-phone redaction, immutable S3 writes, and checksum-consistent replay verification.
- Keep the OKVED object write allowed before the database transaction, but publish release metadata and OKVED rows only after exact byte validation and inside the existing shared database transaction.
- Use fixture mode only. Do not access live List-Org or FNS endpoints.
- Use owned PostgreSQL `5433` and MinIO `9000/9001`; never use host PostgreSQL `5432`.
- Do not add a database migration.

## Decision 1: derive redaction terms from every live retained URL surface

Immediately before DOM serialization and screenshot capture, collect URLs from:

- the current page URL;
- every live DOM element whose `href` attribute is eligible for retention.

Resolve relative DOM `href` values against `document.baseURI` in the browser context. Return the resolved URL strings to the Node boundary, then reuse `sensitiveBrowserUrlValues` to derive:

- sensitive query-parameter values;
- decoded username and password values;
- the decoded complete fragment and its non-empty parameter names or values.

Merge those values with the existing sensitive request/navigation values and labeled contact values. Deduplicate the result before both consumers run:

1. DOM serialization/redaction;
2. screenshot overlay creation.

The same combined list must be passed to the final centralized evidence assertion. A value introduced only by an unrequested DOM link must therefore be removed from retained attributes and redacted wherever it is duplicated in visible DOM text or the screenshot.

Malformed or non-HTTP-like DOM links that cannot be resolved remain subject to the existing capture policy: remove the attribute rather than retain an unverifiable value.

## Decision 2: fail closed on non-canonical named entities during replay

Captured DOM is serialized by the browser after URL attributes have been resolved, sanitized, and rewritten. Checksum-consistent S3 replay must not attempt to reproduce the complete HTML named-character-reference standard with a partial hand-written decoder.

For every serialized retained `href`:

1. accept and decode the canonical serializer entities already required by valid stored output: `&amp;`, `&quot;`, `&apos;`, and valid numeric references;
2. reject any other named character reference before URL parsing, including legacy semicolonless forms;
3. parse the decoded value and apply the existing retained-URL assertion, which rejects username, password, fragment, and sensitive query parameters.

This deliberately treats `&num;`, `&commat;`, their semicolonless browser-recognized variants, and every other unexpected named entity as hostile instead of maintaining an incomplete allow-by-decoding list. A literal ampersand sequence that is not canonical serialized output is rejected rather than interpreted heuristically; valid query separators in captured DOM are serialized as `&amp;`. Direct, numeric-reference, and percent-encoded unsafe URL forms must also remain rejected by the existing canonicalization and centralized scan.

No manifest version change is needed: compliant previously captured manifests use the canonical serializer forms accepted above, while checksum-consistent objects containing unexpected named references were never valid under the fail-closed evidence contract.

## Decision 3: enforce an explicit strict CSV grammar

Retain the dependency-free parser, but replace its quoted boolean with explicit states:

- `unquoted`: ordinary field content; comma and record terminator close the field; a quote is allowed only as the first character and enters `quoted`;
- `quoted`: characters are field content; doubled quotes append one literal quote; a single closing quote enters `afterQuote`;
- `afterQuote`: only comma, record terminator, or end-of-input is valid. Any other character, including whitespace or another ordinary character, is malformed.

Additional grammar rules:

- a bare quote inside a non-empty unquoted field is invalid;
- CR is valid only as part of CRLF; lone CR is invalid;
- LF and CRLF are accepted record terminators;
- an unterminated quoted field is invalid;
- a closing quote at end-of-input closes the final field and row;
- the existing exact header, non-empty dataset, three-column, OKVED code, name, and exact `source_version` checks remain unchanged.

Parsing and all semantic validation still occur before the conditional S3 write and before any database publication. Therefore every syntactically invalid CSV with a valid header must leave `crawl_runs`, `source_fetches`, `dataset_releases`, and `okveds` unchanged, and corrected bytes for the same requested source version must subsequently succeed.

## Data flow

Browser capture:

1. inspect current page URL and live retained DOM links;
2. derive and deduplicate sensitive URL component values;
3. merge them with existing redaction values;
4. sanitize DOM and install screenshot overlays using the same value set;
5. sanitize structured URL surfaces;
6. run the centralized browser evidence assertion;
7. checksum and persist.

OKVED release:

1. read exact CSV bytes and decode strict UTF-8;
2. parse them with the strict CSV state machine;
3. validate every row, including exact requested `source_version`;
4. conditionally write the checksum-addressed S3 object;
5. publish release metadata and OKVED rows in one database transaction.

## Error handling

- Capture removes an unresolvable retained `href`; it must not silently retain the raw attribute.
- Replay rejects an unexpected named entity or any URL that is unsafe after canonical decoding with the existing `raw redaction scan failed` security boundary.
- CSV syntax errors fail before S3/DB publication with a stable selected-OKVED CSV validation error.
- A failed CSV attempt does not reserve the requested release version, so corrected bytes can be retried.
- The already documented possibility of an unreferenced checksum-addressed S3 object after a later database rollback remains acceptable.

## Test strategy and acceptance

Every behavior change follows strict RED → GREEN TDD. Before production edits, tests must fail for the demonstrated reason.

Browser capture tests must prove:

- a fragment value introduced only by an unrequested DOM `href` is redacted from duplicated visible DOM text;
- the same value receives a screenshot overlay;
- username/password and sensitive-query values introduced only by DOM links receive the same treatment;
- ordinary safe links and existing UUID/phone cases remain valid.

Checksum-consistent replay tests must prove:

- `&num;` cannot encode a retained fragment;
- `&commat;` cannot encode retained userinfo;
- unexpected named entities are rejected fail-closed;
- canonical `&amp;`, `&quot;`, `&apos;`, numeric references, and safe retained URLs do not regress where valid.

Executable OKVED release tests must prove:

- text after a closing quote is rejected with a valid header;
- bare quotes, unterminated quotes, invalid quote transitions, and lone CR are rejected;
- valid escaped quotes, LF, CRLF, and a quoted final field at EOF remain accepted;
- the demonstrated malformed file leaves all four publication tables empty;
- corrected bytes for the same source version then publish successfully.

Completion requires the focused URL/S3 and OKVED release suites, the full fixture suite, dedicated end-to-end tests, migration down/up on PostgreSQL `5433`, TypeScript build, fixture-gate audit, protected-file audit, and clean worktree. Owned services must be stopped without deleting volumes.

## Non-goals

- General-purpose HTML parsing outside retained `href` verification.
- General-purpose CSV dialect detection, alternative delimiters, comments, or spreadsheet formula handling.
- Manifest-version, schema, discovery, finance mapping, or live-source changes.
- Deleting a checksum-addressed S3 object when a later database transaction rolls back.
