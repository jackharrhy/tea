FROM platformatic/node-caged:26-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Drop preferred prebuilds and rebuild against this compression-enabled runtime (two jobs).
RUN npm ci && rm -rf node_modules/better-sqlite3/prebuilds \
  && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/better-sqlite3 --nodedir=/usr/local --jobs=2 \
  && npm run build --workspace @tea/cms && npm prune --omit=dev

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4351 TEA_DATA_DIR=/app/data
WORKDIR /app/apps/cms
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4351
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
