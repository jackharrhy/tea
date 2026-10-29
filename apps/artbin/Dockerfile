FROM platformatic/node-caged:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/artbin/package.json apps/artbin/package.json
COPY packages/artbin-core/package.json packages/artbin-core/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/maps-renderer/package.json packages/maps-renderer/package.json
# Drop preferred prebuilds and rebuild against this compression-enabled runtime (two jobs).
RUN npm ci --workspace @tea/artbin --workspace @jackharrhy/tea-maps-renderer --include-workspace-root=true --allow-remote=all \
  && rm -rf node_modules/better-sqlite3/prebuilds \
  && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/better-sqlite3 --nodedir=/usr/local --jobs=2
COPY tsconfig.base.json ./
COPY apps/artbin apps/artbin
COPY packages/artbin-core packages/artbin-core
COPY packages/identity packages/identity
COPY packages/maps-renderer packages/maps-renderer
RUN npm run build --workspace @jackharrhy/tea-maps-renderer
RUN npm prune --omit=dev --workspace @tea/artbin

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends imagemagick ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/packages/artbin-core ./packages/artbin-core
COPY --from=build /app/packages/identity ./packages/identity
COPY --from=build /app/packages/maps-renderer ./packages/maps-renderer
COPY --from=build /app/apps/artbin ./apps/artbin
RUN npx --yes playwright install --with-deps --no-shell chromium \
    && mkdir -p apps/artbin/data apps/artbin/public/uploads apps/artbin/tmp/uploads \
    && chown -R node:node apps/artbin/data apps/artbin/public/uploads apps/artbin/tmp/uploads
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/artbin
USER node
EXPOSE 3000
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
