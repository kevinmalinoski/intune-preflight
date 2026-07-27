FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w packages/shared && npm run build -w apps/web

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
