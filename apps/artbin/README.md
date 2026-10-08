# Artbin

Artbin is the game asset archive at [artbin.jackharrhy.dev](https://artbin.jackharrhy.dev). It accepts game assets, organizes folders, generates image and BSP previews, and serves the Artbin CLI. This workspace preserves Artbin's existing name, visual system, routes, and production URL.

## Entry points

`server.ts` starts the Node HTTP server. `app/router.ts` defines Remix routes and middleware, `app/assets.ts` serves browser modules, and `app/ui/` owns the visual system. `/dev/kitchen-sink` is the live component reference. `src/db/` and `drizzle/` own the SQLite schema and migrations. `src/lib/` owns storage and processing. The CLI lives in `apps/artbin-cli`; shared scan and upload code lives in `packages/artbin-core`.

## Local setup

From the Tea root, run `npm ci`, then `npm run artbin:dev`. Node 24.3 or newer, ImageMagick, and Playwright Chromium are needed for all preview paths. Local development uses an administrator account unless `ARTBIN_REQUIRE_AUTH=1`. Set `ARTBIN_DB_PATH`, `ARTBIN_PUBLIC_DIR`, and `ARTBIN_TEMP_DIR` to use separate local data paths; defaults are `data/artbin.db`, `public`, and `tmp/uploads`. See `.env.example` for Fourm OAuth settings. Production uses `FOURM_URL`, `FOURM_CLIENT_ID=artbin`, and `ARTBIN_URL=https://artbin.jackharrhy.dev`.

## Checks and deployment

Run `npm run artbin:check` from the root or `npm run check --workspace @tea/artbin`. `Dockerfile` produces the Node image published by `.github/workflows/publish-artbin.yml`. Root `compose.yml` provides a local Artbin container. Production host configuration and data migration belong in the infrastructure repo; keep the database and uploads together when changing images. The container expects writable `data`, `public/uploads`, and `tmp/uploads` directories under `/app/apps/artbin`.

Artbin keeps its own UI and storage behavior inside this app. The published `@jackharrhy/worldview` package remains its BSP preview renderer until a visually equivalent replacement is verified. Do not replace its visual assets or component styles as part of a package move.
