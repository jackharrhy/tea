FROM platformatic/node-caged:26-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
# Drop preferred prebuilds and rebuild against this compression-enabled runtime (two jobs).
RUN npm ci && rm -rf node_modules/better-sqlite3/prebuilds \
  && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/better-sqlite3 --nodedir=/usr/local --jobs=2
RUN npm run build --workspace @jackharrhy/tea-maps-renderer \
  && npm run build --workspace @tea/maps-editor \
  && npm run build --workspace @tea/maps-protocol \
  && npm run build --workspace @tea/maps-service \
  && npm prune --omit=dev

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8792
ENV TEA_MAPS_DATA_ROOT=/app/data

WORKDIR /app/apps/maps-service
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8792
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8792/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/server.js"]
