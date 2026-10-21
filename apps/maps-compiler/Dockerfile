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
  && npm run build --workspace @tea/maps-compiler \
  && npm prune --omit=dev

FROM node:26.12.1-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' && update-ca-certificates && rm -rf /var/lib/apt/lists/*
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

COPY scripts/security/check-tls.mjs /usr/local/lib/tea-check-tls.mjs
RUN node /usr/local/lib/tea-check-tls.mjs && node --use-openssl-ca /usr/local/lib/tea-check-tls.mjs
