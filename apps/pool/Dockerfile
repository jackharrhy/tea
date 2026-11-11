FROM node:26-bookworm AS build
WORKDIR /app
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
COPY . .
RUN npm ci
ARG APP_REVISION=development
RUN APP_REVISION=$APP_REVISION npm run build --workspace @harrhy/pool-app

FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app
ARG APP_REVISION=development
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=3188 \
    DATA_DIR=/app/data WEB_ROOT=/app/dist/client APP_REVISION=$APP_REVISION
COPY --from=build --chown=bun:bun /app/apps/pool/dist ./dist
RUN mkdir /app/data && chown bun:bun /app/data
USER bun
EXPOSE 3188
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:"+(process.env.API_PORT??"3188")+"/api/health");process.exit(r.ok?0:1)'
CMD ["bun", "dist/server/index.js"]
