# Public web build owner

`apps/web` owns one React/Primer bootstrap, effective public navigation, shared
session and the accepted home/audience/auth views. `production-static/` owns the
separate seven-file production landing; it is packaged unchanged, not compiled
as the dev UI. Profile fixtures remain in `apps/profile-preview`.

Use root `npm ci`, then `npm run typecheck --workspace @astforum/web`,
`npm run lint --workspace @astforum/web`, `npm test --workspace @astforum/web`
and `npm run test:composition`. The immutable release command, clean-source
contract and operator gates are in [deployment/release.md](../../deployment/release.md).

Product source: [Outline](https://docs.astforum.ru). Historical and canonical
product links remain in the original component README indexes.
