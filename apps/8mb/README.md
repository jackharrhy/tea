# 8mb

8mb compresses video locally in the browser at `https://jackharrhy.dev/8mb/`. Its native Remix 3 Node host serves the editor document, bundled media worker, FFmpeg WASM, fonts and licensed static assets. `server.ts` owns the host lifecycle, `app/router.tsx` the page route, `app/ui/` the static Remix document and `css(...)` mixins, `src/` the existing editor and media code, and `app/diagnostics/` the opt-in aggregate endpoint and SQLite store. The conversion stays in the user's browser; no media upload route exists.

## Setup

Use Node 26 and `npm ci` from the repository root. Run `npm run 8mb:dev` to build and serve the app on port 5188. `APP_ORIGIN` defaults to `https://jackharrhy.dev` and must match the browser Origin for consented diagnostics. `DIAGNOSTICS_DB_FILE` defaults to `/app/data/diagnostics.sqlite`; choose a writable app-owned path for local runs. `APP_REVISION` is a trusted server build revision; the image publisher passes the commit SHA. The image starts `server.ts` directly so SIGTERM closes the diagnostics database. Run the opt-in Compose profile with `docker compose --profile 8mb up --build 8mb` and open `http://8mb.localhost/8mb/`.

`npm run 8mb:check` runs the workspace build, typecheck, media/domain and diagnostics tests. Browser validation should cover the empty editor, a local synthetic MP4, export, opt-in/off behaviour, desktop and mobile layout, and same-origin isolation headers. The retained `src/style.css` is the source for `scripts/import-styles.mjs`; it generates `app/ui/legacy-styles.ts` plus a small font/keyframe stylesheet. Run that script only when the original static styles change.

## Diagnostics boundary

The footer checkbox says “send anonymous telemetry to help improve 8mb” and defaults off. Off means no diagnostic requests. On sends only coarse, allowlisted terminal outcomes; it omits credentials and referrer, never sends a raw error or media name, and does not retry or replay. The Remix POST `/8mb/api/diagnostics` enforces exact Origin, JSON shape, 2 KiB streamed body, 2 second read deadline and 120 requests/minute per process. It stores only daily aggregate counts and trusted revision in SQLite, retains seven UTC dates, caps all groups at 10,000 and prunes on startup, hourly and on writes. If SQLite is unavailable, editing stays available and diagnostics returns a generic 503 until storage recovers. There is no public read endpoint. See [diagnostics details](docs/DIAGNOSTICS.md).

The host serves `/sw.js` to retire older root-scoped preview workers. Hashed browser assets are immutable; the page, WASM and other static assets are revalidated. COOP/COEP and same-origin resource headers are applied to the page and static responses. Infra owns production ingress, diagnostics storage, logging, backups and the eventual switch; the original live site remains authoritative until that acceptance.
