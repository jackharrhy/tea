FROM platformatic/node-caged:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/8mb/package.json apps/8mb/package.json
COPY packages/request-body/package.json packages/request-body/package.json
RUN npm ci --workspace @harrhy/8mb --include-workspace-root=false
COPY apps/8mb ./apps/8mb
COPY packages/request-body ./packages/request-body
RUN npm run build --workspace @harrhy/8mb
RUN npm prune --omit=dev --workspace @harrhy/8mb

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ARG VCS_REF=local
ENV NODE_ENV=production PORT=5188 APP_REVISION=${VCS_REF} DIAGNOSTICS_DB_FILE=/app/data/diagnostics.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node tsconfig.base.json ./tsconfig.base.json
COPY --from=build --chown=node:node /app/apps/8mb ./apps/8mb
COPY --from=build --chown=node:node /app/packages/request-body ./packages/request-body
RUN mkdir -p /app/data && chown node:node /app/data
WORKDIR /app/apps/8mb
USER node
EXPOSE 5188
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5188/8mb/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--env-file-if-exists=.env", "--import", "remix/node-tsx", "server.ts"]
