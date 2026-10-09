# Проверка и выпуск

Выпуск выполняется только по разрешённой задаче для названного окружения. [Наблюдения6октября](environments.md) фиксируют прежние bytes/runtime, а не release текущей ветки. Production static и dev Primer имеют отдельные source/deployment boundaries.

1. Зафиксировать commit, все source/config/lock inputs и владельцев. Из чистого checkout выполнить locked install, layout, type/build и соответствующие unit/integration/browser checks; сохранить команды и результаты.
2. Собрать неизменяемый artifact, полный inventory и output SHA. Для независимых публичных пакетов проверить общие routes/navigation/auth-loader версии. API runtime target проверить отдельно: наличие `forum.public` не разрешает переключение legacy sandbox.
3. Проверить target/environment, current bytes/config, конкурирующие изменения и rollback. Сохранить backup затронутых путей; не заменять shared infrastructure или production вне scope.
4. Использовать существующие publishers из `scripts/deployment/` соответствующего владельца. Их локальные contract checks: `npm run test:publishers` и component-owned deployment tests. Копирование сборки не является доказательством публикации.
5. Сравнить artifact→deployed→served SHA, runtime/config, origin и публичный HTTPS. Браузером после reload проверить реальные routes/layout/auth links, shared-password boundary и protected files; provider flow/session проверяются отдельно по применимости.
6. Записать полноценный [release manifest](release-manifest.schema.json): exact inputs/build command/runtime/timestamps, deploy operation/target, served receipts. `verified` допустим только при полной подтверждённой цепочке и без unknown provenance; JSON validation само по себе её не доказывает.
7. Проверить exact commits и PR в GitHub, task links с `OP#PROJ-…` в PR body и вкладку GitHub реальной задачи OpenProject; прикрепить PR к чату. Сообщить material limitations отдельно.

Для отмены вернуть только затронутые publisher paths/HTML/config из конкретного backup после проверки concurrent state. Новые immutable hashed assets допускается сохранить для открытых вкладок. Возврат схем/данных выполняется отдельным подтверждённым database runbook, а не удалением identity data.

В receipts не включать secrets, connection strings, personal/session/provider payloads или private backup inventories. Сохранять provenance и точные технические hashes отдельно от приватных operational evidence.

## Task7 immutable web delivery

The dev owner is `apps/web`; production remains its separate seven unchanged
`production-static` files. A build receipt has schemaVersion2, recordKind `build`
and reconciliationStatus `build-only`. It cannot assert deployed/served status.
The schema also preserves the dated Task3 version1 observations and verified
release contract; never relabel an observed-unreconciled snapshot.

Build an exact committed clean checkout (Node24.18.1 and canonical root lock):

```sh
npm ci
SOURCE_SHA=$(git rev-parse HEAD)
node scripts/deployment/build-web-release.mjs dev /tmp/forum-web-dev "$SOURCE_SHA"
node scripts/deployment/build-web-release.mjs production /tmp/forum-web-production "$SOURCE_SHA"
bash scripts/verification/check-web-release.sh /tmp/forum-web-dev
FORUM_WEB_SITE=/tmp/forum-web-dev/site npx --no-install playwright test --config tests/e2e/public-site.config.ts
```

Use a fresh output directory. Builder rejects a dirty/mismatched checkout,
undeclared artifact files and unexpected routes. It disables Vite env-file loading
and uses an explicit child-process environment. Supported build-affecting values
are fixed `NODE_ENV=production`, `TZ=UTC`, `LANG=C`, `LC_ALL=C`, the tracked
`deployment/web/build-config.json` map (`VITE_FORUM_SESSION`, `VITE_LOGIN_URL`,
`VITE_START_URL` for dev; none for production), and the owned empty
`build-user.npmrc` / `build-global.npmrc`. These files and the builder are source
fingerprint inputs. Only launcher/filesystem context `PATH`, `HOME`, `TMPDIR`,
`TMP`, `TEMP`, `SystemRoot`, `COMSPEC`, `PATHEXT` is inherited; it must resolve the
locked toolchain whose versions and installed payload hashes enter the manifest.
All other ambient variables, including `NODE_OPTIONS`, `BABEL_ENV`, `VITE_*`
and `npm_config_*`, are excluded. Local `npm run dev --workspace @astforum/web`
serves the owned `public/` directory; release builds disable public copying and
emit only the content-addressed media produced by `immutableMedia`.
Manifest includes source/tree/input SHA, lock and installed dependency payload
fingerprints, Node/npm/Vite versions, configuration and every output file hash.
Dev media namespaces are content-addressed before Vite hashes referencing chunks.
Production packaging copies exactly its owned seven source files, without a Vite
compilation or dev promotion. Uploaded contents are only `site/` and manifest.json;
no env files, logs, dependency dumps, uploaded user content or database records.

The quality workflow checks out the PR head SHA explicitly. Select one exact
successful GitHub run and artifact ID for that SHA, verify its downloaded manifest
and full file inventory, and save the run/artifact identities in the sanitized
release receipt. Never deploy a `latest` search result or a local replacement for
the reviewed CI artifact. Preserve origin/public/browser evidence separately.

### Current mount and retention boundary

Fresh parent inspection on 7 October 2026 confirms Caddy and gateway bind the
stable `/opt/outline/dev-astforum` parent read-only; neither binds its `landing`
child separately. Gateway resolves each static path on every request. Its auth
screen/code/secrets are separate siblings/mounts. Do not rename the mounted parent
or widen any mount. Recheck actual container mounts and runtime config immediately
before apply; abort mismatches. Atomic publication is Linux renameat2 EXCHANGE of
two real child directories within the same bound parent. It is intentionally
unsupported on systems/filesystems without that atomic operation.

Observed gateway session TTL is86400seconds; gateway/auth/API/static responses use
Cache-Control:no-store. This is a minimum retention input, not permission to clean
old assets: open tabs can survive beyond cookie TTL. Initial transition, subsequent
releases and rollback remove **no old hashes**. A future cleanup requires a separate
approved retention policy including actual API session/cache TTL and maximum open
page lifetime. Preserve the observed AppleDouble files in target snapshots too;
they are not build inputs. Preserve independently owned fixture/profile content.

### Dev apply and rollback gates

Parent owns live execution after review, exact GitHub SHA/CI and PR/OpenProject
linkage. Use the existing `forum-prod` SSH endpoint84.47.165.130:15833 with `-B en0`
and current key/host verification. Capture a fresh0700private backup, container IDs,
mount/source/config hashes and target inventory. Re-read target immediately before
apply and compute `web_release.fingerprint(web_release.inventory(target))`.

```sh
python3 scripts/deployment/web_release.py /path/to/exact-downloaded-artifact \
  --target /opt/outline/dev-astforum/landing --backups /path/to/private-backups \
  --source-sha EXACT_REVIEWED_SHA --expected-target FRESH_INVENTORY_SHA \
  --environment dev --verify-command python3 /path/to/served-verifier.py
```

The verifier is mandatory and must check actual target mounts, origin and public
HTTPS file hashes using the existing gateway session/cookie contract. Hostname/TLS
checks remain enabled. Shared `.landing.public-site.lock` excludes cooperating
publishers; `.web-release.json` rejects legacy component publication after the
unified switch. A second same-release attempt must acquire that lock and provide
fresh expected target bytes. Build input is never changed by publication.

The publisher snapshots the full old tree privately, stages the complete candidate,
retains existing assets and independently owned files, and adds new immutable assets
to both versions. One exchange switches every owned route. A post-switch failure
exchanges back only if both trees still match transaction fingerprints. It verifies
the restored tree. If CAS fails, both trees and rollback-conflicts.json remain for
operator inspection; never overwrite the competing bytes or run blind rollback.
If renameat2 fails, no switch happened; inspect the filesystem and keep the backup.

Before accepting the intended release: open the previous release, hold its late
JS/CSS/image requests, switch, check those bytes at origin and HTTPS; force verifier
failure and repeat after automatic rollback. Prove old gateway cookies still work,
then reapply the exact intended artifact with fresh CAS. Check all seven routes,
reload, login/register both switches, Close/Back/Forward, held200session updates,
focus, demo iframe, carousel and overflow at320/390/desktop in Codex iab. Save exact
served receipts; Docker tests prove local serving boundaries only.

### Other runtime components

API image must be newly built from the exact accepted source and root lock,
including the updated workspace Docker inputs, patched adapter/Fastify/fast-uri
payloads. Record image/dependency fingerprints and readiness/public smoke with
actual sandbox database and Sber DNS override; keep old image/config rollback.
Never run general/public migrations or switch IAM out of forum_sber_sandbox here.

For freshly confirmed public default-ACL drift, parent restores corresponding
roles, owners and ACL metadata in an isolated fresh database, tests only the narrow
future-default revoke block and its exact rollback, captures live ACL rollback
privately, then applies that transaction. Existing general-reference/table grants,
passwords, sandbox ACL and data are outside this reconciliation. Do not execute
broad bootstrap/configure-role scripts. Unchanged pgAdmin/vendor components require
image/config/mount and real connection evidence, not a cosmetic recreation.

Production's current seven files matched BASE source in fresh parent inspection;
verify exact packaged CI bytes against origin and public HTTPS independently.
No dev UI promotion. Apply only newly confirmed accepted production drift with its
own backup/readiness/rollback. Task7 and whole-environment reconciliation remain
pending until parent completes these actual runtime gates.

For an explicit rollback after a successful release, use the exact private backup
returned by that operation and a new target inventory CAS (never an arbitrary latest backup):

```sh
python3 scripts/deployment/web_release.py --rollback-backup /exact/web-OPERATION \
  --target /opt/outline/dev-astforum/landing --backups /path/to/private-backups \
  --expected-target FRESH_INVENTORY_SHA --environment dev \
  --verify-command python3 /path/to/previous-served-verifier.py
```

This restores only the seven owned HTML routes and prior release/auth metadata,
keeps newer assets and independently owned files, and atomically exchanges inside
the same parent mount. A failed rollback verifier restores the starting release
only while its CAS still matches; a conflict preserves both trees for inspection.

## PROJ-160: authenticated cabinet on dev

The current API uses the verified main `forum.public` target established by
PROJ-156. The older sandbox instructions above describe that historical release;
this change performs no migrations, ACL changes or identity transfer. Build the
API from the exact reviewed commit and canonical lock, retain its old image and
configuration, and preserve provider certificates, callback and OAuth scopes.

Dev now owns `/cabinet/` and `/cabinet/work/` as well as the six public routes.
The build fingerprints the shared `ProfilePage.tsx` and `profile.ts` sources,
without importing the preview fixtures. The dev gateway must deploy its narrow
`/api/profile` forwarding addition alongside the API and web artifact; this
necessary serving boundary was confirmed during implementation. It forwards
Forum cookies but a shared dev-password cookie alone grants no profile access.

Verify anonymous and expired profile requests return401, authenticated responses
contain only their owner, and no profile response is cached. Test direct links,
reload, missing data, both mobile widths, profile/work navigation and logout back
to the public homepage. Preserve the independent `/profile/` fixture preview.
Publisher rollback restores or removes both cabinet HTML files according to the
exact previous backup, retains immutable assets and restores the old receipt.
Production remains outside this authorized release.

The reviewed plan was prepared against PROJ-158. Before publication the branch
was advanced to the actual dev baseline `19ee01ed586f54e00a080844639864bc45278bde`
(PROJ-159 and PROJ-38). Preserve their public skip-link removal and homepage
return after successful logout or a confirmed guest cabinet request. Re-run the
combined navigation and ownership regressions against this exact integration.

Logout must reset both window scroll coordinates to zero immediately. Reproduce
from the footer of the long personal profile: replacing the SPA history URL alone
retains its scroll offset, while the public auth focus restoration deliberately
uses `preventScroll`. Check the homepage position at 320/390/1440 px in addition
to the URL, revoked session, history guard and standard login modal.

### PROJ-162 / PROJ-167: organizations on the published dev baseline

Use the successful CI artifact whose `sourceSha` equals the reviewed integration
head. It contains ten routes, including both `/cabinet/settings/` and
`/cabinet/organizations/`. The horizontal PNGs retain approved SHA256
`3edddf723054157c0dc4a2f7eab2fd88f439f26079ae306f344c172c7ef00a6c`;
scoped multiply compositing covers existing Light header/footer/account surfaces.

Before changing dev, inventory effective API image/revision, complete compose
file list and image override, gateway source and mounted roots, web inventory,
production inventory, migration ledger, grants, and existing membership rows.
Store private backups outside Git with mode 0600. Prove the connected database
is `forum` and schema is `public`; do not apply this release to the historical
`forum_sber_sandbox`. The already-applied 006 migration must not be reapplied.
For optional membership schema, inspect all `organization_memberships` and
`organization_authorities` ownership/status/effective/revoked columns,
organization registration/status columns, the exact
`effective_business_access(uuid,uuid,text,boolean)` guard and runtime EXECUTE /
SELECT grants. A partial contract fails closed with 503; stop the release when
readiness fails. Preserve existing users, membership rows, authorities and roles.

Apply only additive `007_my_organizations.sql` once, as schema owner under the
existing migration lock and transaction, recording its ledger entry in the same
transaction. Grant only `SELECT, INSERT` on `public.organization_additions` to
the existing runtime role and the sequence privileges required by its actual
schema (007 currently uses UUIDs, so needs no sequence grant). Existing audit
INSERT and authenticated identity/membership read/guard privileges must already
be present. Do not run role bootstrap or broad GRANT scripts on the live target.
Check effective runtime privileges before replacing the application.

Build the API image from the exact accepted integration source; record the
image ID and revision and preserve the previous image plus complete effective
compose/config/override list. Back up the gateway's original file and mode before
copying the reviewed file and recreating only its existing service. Prove health,
GET/HEAD `/api/me/organizations` unauthenticated 401, POST owner-cookie/Origin
validation, JSON errors and `Cache-Control: no-store`; preserve query cursors,
owner cookies and Origin through the gateway. Only exact GET/HEAD/POST organization
paths are forwarded. Pending additions grant no business access. Do not seed
fake users on the live database. On failed readiness restore the old API image
and exact compose configuration and gateway file/service, then recheck health.
Keep additive007 and its data during application rollback.

Publish the exact CI web artifact with the atomic compare-and-swap publisher;
retain prior hashed resources, auth files/cookies, protected mounts and any
literal late resources held by the in-app browser. Use a fresh expected target
fingerprint. Exercise forced post-switch verifier failure and prove automatic
rollback before final acceptance, then reapply with a newly observed CAS value.
Verify all ten mounted-origin and HTTPS routes, source/artifact byte hashes,
mobile/desktop overflow and the real authenticated organizations flow. Record
production inventory unchanged. Web rollback restores its prior manifest/files;
API/gateway rollback restores their prior bytes/configuration independently.
