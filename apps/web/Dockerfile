FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
# `npm ci` (not `npm install`) so the image is built from the committed lockfile.
RUN npm ci --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN npm run build -w packages/shared \
 && npm run build -w packages/engine \
 && npm run build -w apps/web

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
