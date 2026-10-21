ARG CELLD_IMAGE=ghcr.io/jackharrhy/celld@sha256:e8faeb233cfe7d29f385a64dcac41dc4dd1d8a9de849f54f2ad4a2b4fbb884fa
FROM ${CELLD_IMAGE} AS celld

FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .
RUN npm ci

RUN NODE_ENV=production npm run build --workspace @tea/radio

FROM node:26-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

ARG CELLD_IMAGE
LABEL dev.jackharrhy.radio.celld-image=${CELLD_IMAGE}

ENV NODE_ENV=production
ENV CELLD_ADDR=0.0.0.0:44100
ENV CELLD_INTERNAL_ADDR=127.0.0.1:44101
ENV CELLD_BUCKET=sqlite:///app/.celld/object-store/objects.sqlite3
ENV CELLD_DURABILITY=bucket
ENV CELLD_WATCH=/app/.celld/state

WORKDIR /app/apps/radio

COPY --from=celld /usr/local/bin/celld /usr/local/bin/celld
COPY --from=build /app /app

RUN mkdir -p /app/.celld \
  && chmod +x /app/apps/radio/scripts/start-celld.sh \
  && chown -R node:node /app

USER node

EXPOSE 44100
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:44100/').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["/app/apps/radio/scripts/start-celld.sh"]
