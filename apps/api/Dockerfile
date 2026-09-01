FROM node:24-bookworm-slim AS development

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json

RUN npm ci --workspace=@tan-llm/api

COPY apps/api ./apps/api

CMD ["npm", "run", "dev", "--workspace=@tan-llm/api"]


FROM development AS build

RUN npm run build --workspace=@tan-llm/api
RUN npm prune --omit=dev


FROM node:24-bookworm-slim AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist

USER node

EXPOSE 3001

CMD ["node", "apps/api/dist/server.js"]