# Forum API deployment operations

The October6 VPS observation is recorded in [environments.md](../environments.md) and immutable observed manifests. It identified the legacy sandbox API image `astforum/forum-api:20261001-sber-dns`; this is dated provenance, not a claim that the current checkout is deployed. Source/build/config instructions belong to [apps/api](../../apps/api/README.md).

## Boundaries

API port3001 stays on private Docker networks. Mount secrets read-only outside the image/site; runtime environment and private keys remain restricted. The dev gateway/shared-password boundary and main-domain callback relay are separate from API authentication. Callback relay preserves query encoding, no-store/no-referrer and host-only dev cookies; it does not publish new production UI.

The API runtime historically targeted `forum_sber_sandbox` with legacy `iam`/`party`. Main `forum.public` migrations and main runtime grants are not interchangeable with sandbox. Do not repoint the store or run schema changes as part of an application release without an explicit migration task and checked target/grants.

TLS/hostname verification remains enabled. Sandbox back-channel uses the configured certificate/key/CA and expected issuer; the pinned DNS override affects resolution/address-family only. Readiness `sberConfigured` or an old successful exchange is not proof of an authorized user's fresh registration/login/session.

## Release and recovery

Select the authorized release commit, build/image inputs and exact environment, then follow [release.md](../release.md). Preserve touched config and served files; compare container/image, active config and origin/public hashes after publication. Keep actual credential/session/provider responses private.

Existing deployment configurations: [compose.yaml](compose.yaml), [Dockerfile](../../apps/api/Dockerfile), [DNS override](sber-dns.override.yaml), [runtime grants](grant-runtime.sql). Historical scripts in [legacy-releases](legacy-releases/README.md) are pinned recovery context and must not be run against a current release blindly.

To inspect a known deployment on its server, after confirming its current path:

```sh
sudo docker compose --project-name forum-api --project-directory /opt/forum-api/current/deployment/forum-api ps
sudo docker inspect forum-api-forum_api-1 --format '{{.State.Status}}'
```

Rollback selects the reviewed preceding image/config and recreates only the API, checks readiness/served behavior, then atomically updates the current-release pointer. Preserve data and unrelated shared services; never substitute a September historical path as a current rollback target. The old full delivery reports remain in pinned history/private backup; their unique product decisions are accounted for in the [migration register](../../artifacts/repository-audits/document-migration-manifest.json).
