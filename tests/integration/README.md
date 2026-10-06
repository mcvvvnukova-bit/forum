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


The three filesystem publishers share `scripts/deployment/public_site.py`.
Run their release regression checks from the root without a server or provider:

```sh
python3 -m unittest discover -s tests/integration -p 'test_public_site_release.py'
python3 -m unittest discover -s deployment/primer-home/scripts -p 'test_*.py'
python3 -m unittest discover -s deployment/audience-pages/scripts -p 'test_*.py'
python3 -m unittest discover -s deployment/public-auth/scripts -p 'test_*.py'
```

`publish(source, target, backups, *, label, pages, assets, commit=None,
install_auth=False, homepage_transform=None, verifier=None)` takes owned page
and asset byte mappings. Auth publication installs a validated script/style
contract; subsequent home/audience publications read the canonical login and
register pages, referenced asset bytes and `.public-auth.json` manifest under
the same filesystem lock. Legacy installations with matching canonical pages
can be adopted. A malformed manifest, missing canonical page, disagreeing
loaders or missing/changed active assets fails preflight before site and backup
writes. Assets alone may be retained after an unsuccessful first installation;
without any canonical page, manifest or page loader they represent uninstalled
auth, allowing a retry. Every resulting public HTML, including profile pages,
receives one active loader. Legacy audience resume markers/scripts are removed
when auth is active; pre-auth `preserve_homepage` behavior remains available.
Gateway `auth/`, asset trees and macOS metadata are outside public composition.

The lock is a permanent sibling inode `.<target-name>.public-site.lock` shared
by all three publishers; busy publication fails with a retry instruction.
Cooperating publishers serialize preflight, write, verification and rollback.
Per-file byte comparisons also detect changes by external writers before
replacement and before rollback. An external writer does not participate in
this lock: the narrow comparison-to-replace syscall interval cannot be made
atomic for such a writer. Rollback never replaces observed parallel bytes and
reports residual conflicts/errors with the backup path. Retained assets are
immutable, installed atomically and never deleted on rollback; a filename
collision requires a new hashed name. Markup updates are individually atomic,
not a whole-site directory swap, so readers may briefly observe mixed page
versions; both previous and new hashes remain available. Rollback conflicts
require checking the reported pages and manifest before another publication.

Home retains its `verifier(Path)` interface but passes a temporary build view
containing composed homepage HTML and active auth assets. Auth and audience use
`verifier(report)`; audience adds this optional argument. Report `files` hashes
refer to composed markup. Source build directories are never changed. These
commands do not publish to the VPS; later consolidation owns the unified web
builder.

The publisher scripts must run from the repository checkout, retaining their
relative paths and the shared `scripts/deployment/public_site.py` module; a
standalone upload of a publisher script is insufficient. Homepage protection
allows exactly the shared auth composition of protected public HTML while
checking their remaining markup and all gateway/production/configuration
bytes. Its report distinguishes strictly unchanged files from composed HTML.
