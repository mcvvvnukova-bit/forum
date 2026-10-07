# Profile fixture runtime

Source owner: [PROJ-150](https://roadmap.astforum.ru/work_packages/PROJ-150).
This Primer preview uses only fictional data in `src/fixtures.ts`. It does not
perform OAuth, fetch provider userinfo, or persist personal data. Keep the
fixture label visible. Product requirements belong in [Outline](https://docs.astforum.ru).

From this directory, run `npm ci --prefix ../..`, then `npm run dev` for the loopback preview
at `http://127.0.0.1:5190/`. The port is strict. Direct `/profile/work` navigation
and Back/Forward are handled by the existing fixture application.

Owned checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
CI installs the exact lock and requires all four checks. To produce the existing
dev-subdirectory build, use `npm run build -- --base=/profile/ --outDir=dist/server`,
then copy `dist/server/index.html` to `dist/server/work/index.html`.

A build is not a deployment. Server publication, shared-password protection,
served hashes and rollback need a separate release gate; no deployment runs
through this package's checks. Historical release/design evidence and the
original mixed product README remain preserved in pinned source history and
the private backup; they are not current acceptance evidence.
