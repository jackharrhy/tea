ARG CELLD_IMAGE=ghcr.io/jackharrhy/celld@sha256:b173e540c3eeb5aa8dda232e275a3f28b8e9567df070e3227c511be9055695f2
FROM ${CELLD_IMAGE} AS celld

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @tea/ref

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime

ARG CELLD_IMAGE
LABEL dev.jackharrhy.ref.celld-image=${CELLD_IMAGE}

ENV NODE_ENV=production
ENV CELLD_ADDR=0.0.0.0:8080
ENV CELLD_INTERNAL_ADDR=127.0.0.1:8081
ENV CELLD_BUCKET=sqlite:///app/.celld/object-store/objects.sqlite3
ENV CELLD_DURABILITY=bucket
ENV CELLD_WATCH=/app/.celld/state

WORKDIR /app/apps/ref
COPY --from=celld /usr/local/bin/celld /usr/local/bin/celld
COPY --from=build /app /app

RUN mkdir -p /app/.celld \
  && chmod +x /app/apps/ref/scripts/start-celld.sh \
  && chown -R node:node /app

USER node

EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["/app/apps/ref/scripts/start-celld.sh"]
