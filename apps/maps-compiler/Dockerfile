FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS build
WORKDIR /app
COPY . .
RUN npm ci \
  && npm run build --workspace @tea/maps-renderer \
  && npm run build --workspace @tea/maps-editor \
  && npm run build --workspace @tea/maps-protocol \
  && npm run build --workspace @tea/maps-compiler \
  && npm prune --omit=dev

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341
ENV NODE_ENV=production
ENV TEA_MAPS_COMPILER_HOST=0.0.0.0
ENV TEA_MAPS_COMPILER_PORT=8788
WORKDIR /app/apps/maps-compiler
COPY --from=build /app /app
USER node
EXPOSE 8788
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8788/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
