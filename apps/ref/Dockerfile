ARG CELLD_IMAGE=ghcr.io/jackharrhy/celld@sha256:0d63d5e360981f9e779c44b144abddb4ca174fc37630a80da7ddc57670c3f970
FROM ${CELLD_IMAGE} AS celld

FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @tea/ref

FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

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
