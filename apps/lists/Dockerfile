FROM node:26-bookworm AS build
WORKDIR /app
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json package-lock.json ./
COPY apps/lists/package.json apps/lists/package.json
COPY packages/identity/package.json packages/identity/package.json
RUN npm ci --workspace @tea/lists --include-workspace-root=false
COPY apps/lists apps/lists
COPY packages/identity packages/identity
WORKDIR /app/apps/lists
RUN npm run build:assets
RUN npm prune --omit=dev --workspace @tea/lists --include-workspace-root=false

FROM oven/bun:1.4.4-slim AS runtime
ENV NODE_ENV=production DB_PATH=/data/lists.db PORT=8080
WORKDIR /app
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps/lists ./apps/lists
COPY --from=build --chown=bun:bun /app/packages/identity ./packages/identity
RUN mkdir /data && chown bun:bun /data
WORKDIR /app/apps/lists
USER bun
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:8080/health");process.exit(r.ok?0:1)'
CMD ["bun", "src/index.ts"]
