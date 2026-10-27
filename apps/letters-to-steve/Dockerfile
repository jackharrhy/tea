FROM platformatic/node-caged:26-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/letters-to-steve/package.json apps/letters-to-steve/package.json
RUN npm ci --workspace @tea/letters-to-steve --include-workspace-root=false && npm prune --omit=dev --workspace @tea/letters-to-steve

FROM platformatic/node-caged:26-slim
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=44110 DATABASE_PATH=/app/data/letters.sqlite UPLOAD_DIRECTORY=/app/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY apps/letters-to-steve ./apps/letters-to-steve
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
WORKDIR /app/apps/letters-to-steve
USER node
EXPOSE 44110
CMD ["npm", "start"]
