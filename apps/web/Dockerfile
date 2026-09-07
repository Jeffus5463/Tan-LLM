ARG NGINX_VERSION=1.29-alpine

FROM node:24-alpine AS development

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --workspace=@tan-llm/web

COPY apps/web ./apps/web

CMD ["npm", "run", "dev", "--workspace=@tan-llm/web", "--", "--host", "0.0.0.0"]


FROM development AS build

RUN npm run build --workspace=@tan-llm/web


FROM nginx:${NGINX_VERSION} AS production

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
