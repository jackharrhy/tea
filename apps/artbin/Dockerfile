FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/artbin/package.json apps/artbin/package.json
COPY packages/artbin-core/package.json packages/artbin-core/package.json
RUN npm ci --workspace @tea/artbin --include-workspace-root=false --allow-remote=all
COPY apps/artbin apps/artbin
COPY packages/artbin-core packages/artbin-core
RUN npm prune --omit=dev --workspace @tea/artbin

FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends imagemagick ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/artbin-core ./packages/artbin-core
COPY --from=build /app/apps/artbin ./apps/artbin
RUN npx --yes playwright install --with-deps --no-shell chromium \
    && mkdir -p apps/artbin/data apps/artbin/public/uploads apps/artbin/tmp/uploads \
    && chown -R node:node apps/artbin/data apps/artbin/public/uploads apps/artbin/tmp/uploads
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/artbin
USER node
EXPOSE 3000
CMD ["node", "--import", "remix/node-tsx", "server.ts"]

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
