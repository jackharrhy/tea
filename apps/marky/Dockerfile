FROM platformatic/node-caged:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/marky/package.json apps/marky/package.json
COPY packages/identity/package.json packages/identity/package.json
RUN npm ci --workspace @tea/marky --include-workspace-root=false && npm prune --omit=dev --workspace @tea/marky

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
ENV NODE_ENV=production PORT=44100 MARKY_CONTENT_DIR=/app/data/content MARKY_SESSION_DIR=/app/data/sessions
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node tsconfig.base.json ./tsconfig.base.json
COPY --chown=node:node apps/marky ./apps/marky
COPY --chown=node:node packages/identity ./packages/identity
RUN mkdir -p /app/data/content /app/data/sessions && chown -R node:node /app/data
WORKDIR /app/apps/marky
USER node
EXPOSE 44100
CMD ["npm", "start"]
