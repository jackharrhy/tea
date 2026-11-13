FROM platformatic/node-caged:26-slim AS assets
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/auth/package.json apps/auth/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/ui/styles.ts packages/ui/styles.ts
RUN npm ci --workspace @harrhy/auth --include-workspace-root=false

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
WORKDIR /app
COPY --from=assets --chown=node:node /app/node_modules ./node_modules
COPY --from=assets --chown=node:node /app/packages/ui ./packages/ui
WORKDIR /app/apps/auth
RUN node -e "const assert = require('node:assert/strict'); assert.equal(process.versions.node.split('.')[0], '26'); assert.equal(process.config.variables.v8_enable_pointer_compression, 1)"
COPY --chown=node:node apps/auth/package.json ./package.json
COPY --chown=node:node apps/auth/tsconfig.json ./tsconfig.json
COPY --chown=node:node apps/auth/LICENSE ./LICENSE
COPY --chown=node:node apps/auth/src ./src
COPY --chown=node:node apps/auth/public ./public
COPY --chown=node:node apps/auth/config ./config
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
