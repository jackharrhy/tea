ARG CELLD_IMAGE=ghcr.io/jackharrhy/celld:latest
FROM ${CELLD_IMAGE} AS celld

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @tea/maps-renderer \
  && npm run build --workspace @tea/maps-editor \
  && npm run build --workspace @tea/maps-protocol

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime

ENV NODE_ENV=production
ENV CELLD_ADDR=0.0.0.0:44100
ENV CELLD_INTERNAL_ADDR=127.0.0.1:44101
ENV CELLD_BUCKET=sqlite:///app/.celld/object-store/objects.sqlite3
ENV CELLD_DURABILITY=bucket
ENV CELLD_WATCH=/app/.celld/state

WORKDIR /app/apps/maps-collaboration
COPY --from=celld /usr/local/bin/celld /usr/local/bin/celld
COPY --from=build /app /app
RUN mkdir -p /app/.celld \
  && chmod +x /app/apps/maps-collaboration/scripts/start-celld.sh \
  && chown -R node:node /app/.celld

USER node
EXPOSE 44100
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:44100/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["/app/apps/maps-collaboration/scripts/start-celld.sh"]
