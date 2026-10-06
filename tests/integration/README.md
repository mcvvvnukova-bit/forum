# Public page and authentication composition check

From the repository root, install the declared packages:

```sh
npm ci
npm ci --prefix deployment/audience-pages
npm ci --prefix deployment/public-auth
npm run test:composition
```

The root manifest owns the Vitest/jsdom/testing-library harness. Its Vite
configuration resolves one React instance and one Primer provider context while
rendering the real audience `App` and `PublicAuth`. The package manifests and
locks still own their production builds and existing test suites. Tests replace
only the session-fetch and provider-navigation boundaries; no server, provider
or database is contacted.

The shared `deployment/public-navigation.ts` contract stores a same-origin
public background URL in the modal history entry, retains other history fields,
and notifies the page entrypoint when authentication pushes a URL. Audience
popstate handling reads that background instead of reinterpreting `/login` as
an audience route. Mode switches replace the existing entry; Back/Close return
to its predecessor, and Forward restores the modal. Direct auth URLs remain
standalone when there is no valid background. Primer continues to own dialog
focus and scroll handling. The work carousel compares the effective background
hash before handling anchor navigation, so modal history restoration preserves
scroll and the independently selected slide while real anchor changes still
select and scroll to their example.

Keep the existing checks as well:

```sh
npm --prefix deployment/audience-pages test
npm --prefix deployment/audience-pages run typecheck
npm --prefix deployment/audience-pages run build
npm --prefix deployment/public-auth test
npm --prefix deployment/public-auth run typecheck
npm --prefix deployment/public-auth run build
```
