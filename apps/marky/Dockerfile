FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/marky/package.json apps/marky/package.json
RUN npm ci --workspace @tea/marky --include-workspace-root=false && npm prune --omit=dev --workspace @tea/marky

FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=44100 MARKY_CONTENT_DIR=/app/data/content MARKY_SESSION_DIR=/app/data/sessions
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY apps/marky ./apps/marky
RUN mkdir -p /app/data/content /app/data/sessions && chown -R node:node /app/data
WORKDIR /app/apps/marky
USER node
EXPOSE 44100
CMD ["npm", "start"]

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
