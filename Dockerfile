FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:stable-alpine
RUN apk add --no-cache jq
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/40-board-config.sh /docker-entrypoint.d/40-board-config.sh
RUN chmod +x /docker-entrypoint.d/40-board-config.sh
ENV NGINX_ENVSUBST_FILTER=REDMINE_URL
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
