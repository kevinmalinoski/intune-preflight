# Build stage: install the whole workspace (dev deps included) and compile.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
# `npm ci` (not `npm install`) so the image is built from the committed lockfile
# and is reproducible -- an `install` can silently resolve newer minors.
RUN npm ci --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/server apps/server
RUN npm run build -w packages/shared \
 && npm run build -w packages/engine \
 && npm run build -w apps/server

# Dependency stage: the runtime tree only, so TypeScript, tsx and the test
# tooling don't ship in the final image.
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
RUN npm ci --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/package.json apps/server/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/engine/dist packages/engine/dist
COPY --from=build /repo/packages/engine/package.json packages/engine/package.json
# Drop root -- the server only reads its own files and talks to Graph.
USER node
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]
