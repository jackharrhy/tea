FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @jackharrhy/tea-maps-renderer \
  && npm run build --workspace @tea/maps-editor \
  && npm run build --workspace @tea/maps-protocol \
  && npm run build --workspace @tea/maps-service \
  && npm prune --omit=dev

FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a
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
