FROM node:26-bookworm AS build
WORKDIR /app
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
COPY . .
RUN npm ci
RUN npm run build --workspace @harrhy/gurgur

FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    DATABASE_PATH=/app/data/world.sqlite RTC_PORT_MIN=40000 RTC_PORT_MAX=40100
COPY --from=build --chown=bun:bun /app/apps/gurgur/dist ./
RUN mkdir /app/data && chown bun:bun /app/data
USER bun
EXPOSE 3000
EXPOSE 40000-40100/udp
VOLUME ["/app/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:"+(process.env.PORT??"3000")+"/readyz");process.exit(r.ok?0:1)'
CMD ["bun", "server/src/index.js"]
