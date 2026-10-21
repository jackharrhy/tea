FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/artbin/package.json apps/artbin/package.json
COPY packages/artbin-core/package.json packages/artbin-core/package.json
RUN npm ci --workspace @tea/artbin --include-workspace-root=false --allow-remote=all
COPY apps/artbin apps/artbin
COPY packages/artbin-core packages/artbin-core
RUN npm prune --omit=dev --workspace @tea/artbin

FROM node:24-bookworm-slim
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
