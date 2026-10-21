ARG CELLD_IMAGE=ghcr.io/jackharrhy/celld@sha256:e8faeb233cfe7d29f385a64dcac41dc4dd1d8a9de849f54f2ad4a2b4fbb884fa
FROM ${CELLD_IMAGE} AS celld

FROM node:26.12.1-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci \
  && npm run build --workspace @tea/maps-renderer \
  && npm run build --workspace @tea/maps-editor \
  && npm run build --workspace @tea/maps-protocol \
  && npm run build:client --workspace @tea/maps

FROM node:26.12.1-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV CELLD_ADDR=0.0.0.0:8790
ENV CELLD_INTERNAL_ADDR=127.0.0.1:8791
ENV CELLD_BUCKET=sqlite:///app/.celld/object-store/objects.sqlite3
ENV CELLD_DURABILITY=bucket
ENV CELLD_WATCH=/app/.celld/state
WORKDIR /app/apps/maps
COPY --from=celld /usr/local/bin/celld /usr/local/bin/celld
COPY --from=build /app /app
RUN mkdir -p /app/.celld \
  && chmod +x /app/apps/maps/scripts/start-celld.sh \
  && chown -R node:node /app/.celld
USER node
EXPOSE 8790
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8790/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["/app/apps/maps/scripts/start-celld.sh"]

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
