FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/shell-mcp/package.json apps/shell-mcp/package.json
COPY packages/shell-core/package.json packages/shell-core/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/request-body/package.json packages/request-body/package.json
RUN npm ci --ignore-scripts --omit=dev --workspace @tea/shell-mcp

FROM node:24-bookworm-slim
ENV NODE_ENV=production SHELL_MODE=locked HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/shell-mcp
COPY --from=deps --chown=node:node /app /app
COPY --chown=node:node tsconfig.base.json /app/tsconfig.base.json
COPY --chown=node:node apps/shell-mcp/app ./app
COPY --chown=node:node apps/shell-mcp/server.ts ./server.ts
COPY --chown=node:node packages/shell-core /app/packages/shell-core
COPY --chown=node:node packages/mcp /app/packages/mcp
COPY --chown=node:node packages/request-body /app/packages/request-body
USER node
EXPOSE 3000
CMD ["node", "--import", "remix/node-tsx", "server.ts"]
