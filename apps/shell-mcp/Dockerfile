FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS deps
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/shell-mcp/package.json apps/shell-mcp/package.json
COPY packages/json-schema/package.json packages/json-schema/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/request-body/package.json packages/request-body/package.json
COPY packages/result/package.json packages/result/package.json
RUN npm ci --ignore-scripts --omit=dev --workspace @tea/shell-mcp

FROM node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SHELL_MODE=locked HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/shell-mcp
COPY --from=deps --chown=node:node /app /app
COPY --chown=node:node tsconfig.base.json /app/tsconfig.base.json
COPY --chown=node:node apps/shell-mcp/app ./app
COPY --chown=node:node apps/shell-mcp/server.ts ./server.ts
COPY --chown=node:node packages/json-schema /app/packages/json-schema
COPY --chown=node:node packages/logger /app/packages/logger
COPY --chown=node:node packages/mcp /app/packages/mcp
COPY --chown=node:node packages/request-body /app/packages/request-body
COPY --chown=node:node packages/result /app/packages/result
USER node
EXPOSE 3000
CMD ["node", "--import", "remix/node-tsx", "server.ts"]

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
