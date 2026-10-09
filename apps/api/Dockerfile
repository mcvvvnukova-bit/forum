FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/dev-gateway/package.json ./apps/dev-gateway/
COPY apps/web/package.json ./apps/web/
COPY apps/profile-preview/package.json ./apps/profile-preview/
RUN npm ci --workspace @astforum/api --include-workspace-root=false
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace @astforum/api && npm prune --omit=dev --workspace @astforum/api --include-workspace-root=false

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./
COPY --chown=node:node apps/api/migrations ./migrations
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
