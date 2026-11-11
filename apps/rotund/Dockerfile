FROM platformatic/node-caged:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/rotund/package.json apps/rotund/package.json
RUN npm ci --workspace @harrhy/rotund --include-workspace-root=false
COPY apps/rotund ./apps/rotund
RUN npm run build --workspace @harrhy/rotund
RUN npm prune --omit=dev --workspace @harrhy/rotund

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=80
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/rotund/dist ./apps/rotund/dist
COPY --chown=node:node apps/rotund/public ./apps/rotund/public
COPY --chown=node:node apps/rotund/package.json ./apps/rotund/package.json
WORKDIR /app/apps/rotund
USER node
EXPOSE 80
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:80/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
