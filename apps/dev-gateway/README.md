# Development password gateway

This workspace owns the existing Primer password screen and the unchanged Python gateway. It does not publish a public landing. Build with `npm run build --workspace @astforum/dev-gateway`; output is `dist/site/auth/index.html` and `dist/site/auth/auth-assets/*`. The gateway serves `/auth-assets/*` relative to `LOGIN_INDEX.parent`, including the square SVG. The accepted Forum Light mapping is imported from `apps/web/src/home/forum-tokens.css`.

`npm test --workspace @astforum/dev-gateway` runs frontend and gateway/origin-login tests. The Python runtime, service environment, password/session files, public routes and publishers retain their existing contracts. `scripts/verification/verify-legacy-public.sh` remains the active gateway/public-site verification entrypoint; its historical name does not make it a publisher for the removed landing. No deployment is performed by this workspace.
