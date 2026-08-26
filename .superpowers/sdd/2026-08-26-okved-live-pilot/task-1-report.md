# Task 1 report — Extract the reviewed browser policy kernel

## Implementation summary

- Added `PolicyBrowserSessionFactory` with exact-origin policy validation, HTTPS-by-default enforcement, and an explicit local HTTP test-policy escape hatch.
- Added terminal policy handling for cross-origin documents, scripts, XHR/fetch, WebSockets, service-worker registration, popups, and unauthorized downloads; passive image/font/stylesheet/subframe requests are aborted and recorded without ending the session.
- Added `captureProjection(selectors)` to `BrowserSession`. It loads only caller-selected structural fragments into the isolated renderer, reuses the raw sanitizer, and returns sanitized DOM evidence without a screenshot or full-page snapshot.
- Kept the fixture `OrganizationSource` contract and existing raw-bundle/manifest checks intact. The existing fixture factory now delegates to the policy factory under an explicit test-only local HTTP policy.
- Added an allowlisted company-card projection fixture/test, plus browser-policy unit coverage using only local servers.

## RED

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/policy-browser.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Observed initial failure (before production implementation):

```text
FAIL test/unit/audience/policy-browser.test.ts
Error: Cannot find module '../../../src/modules/audience/infrastructure/sources/browser/policy-browser'
Test Files 1 failed
Tests no tests
```

The failure was the intended missing reusable policy kernel, not fixture-server or Playwright startup failure.

## GREEN

Command:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/policy-browser.test.ts test/integration/audience/list-org-browser-source.test.ts
```

Output:

```text
Test Files 2 passed (2)
Tests 84 passed (84)
Duration 47.71s
```

Compatibility verification:

```text
APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm test -- test/unit/audience/browser-raw-sanitizer.test.ts test/integration/audience/s3-raw-object-storage.test.ts
Test Files 2 passed (2)
Tests 139 passed (139)

APP_MODE=fixture LIST_ORG_LIVE_ENABLED=false npm run build
tsc -p tsconfig.json (exit 0)
```

## Files changed

- `src/modules/audience/infrastructure/sources/browser/policy-browser.ts` (new)
- `src/modules/audience/application/ports/browser-session.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source.ts`
- `src/modules/audience/infrastructure/sources/list-org-browser/browser-record-policy.ts`
- `src/apps/browser-runner/list-org-fixture-server.ts`
- `test/unit/audience/policy-browser.test.ts` (new)
- `test/integration/audience/list-org-browser-source.test.ts`

## Self-review

- Exact allowed origins are canonicalized and HTTPS is mandatory unless an explicit local test policy permits HTTP.
- Cross-origin resource handling is fail-closed; passive resources cannot create a connection and do not terminate an otherwise valid fixture interaction.
- The projection uses caller selectors only, sanitizes in a network-blocked isolated renderer, and has no screenshot/full-DOM return path.
- Existing normal fixture discovery and browser raw manifest verification were re-run successfully.
- `git diff --check` completed successfully before staging.

## Concerns

- The projection selectors deliberately remain caller supplied; source-specific live adapter selectors are deferred to Task 4, as required.
- No public-network request was made; all policy tests use localhost servers.
- The prior private Playwright implementation remains as compiled legacy compatibility residue in `list-org-browser-source.ts`; runtime fixture construction delegates to `PolicyBrowserSessionFactory`, but a follow-up cleanup should remove the unused private duplicate before Task 4 builds on this kernel.
