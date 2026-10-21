FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci && npm run build --workspace @tea/cms && npm prune --omit=dev

FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4351 TEA_DATA_DIR=/app/data
WORKDIR /app/apps/cms
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4351
CMD ["node", "--import", "remix/node-tsx", "server.ts"]

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
