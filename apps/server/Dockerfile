FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w packages/shared && npm run build -w apps/server

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/package.json apps/server/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]
