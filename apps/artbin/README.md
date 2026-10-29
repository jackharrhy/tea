# Artbin

Artbin is the game asset archive at [artbin.jackharrhy.dev](https://artbin.jackharrhy.dev). It accepts game assets, organizes folders, generates image and BSP previews, and serves the Artbin CLI. This workspace preserves Artbin's existing name, visual system, routes, and production URL.

## Entry points

`server.ts` starts the Node HTTP server. `app/router.ts` defines Remix routes and middleware, `app/assets.ts` serves browser modules, and `app/ui/` owns the visual system. `/cli` documents the Artbin CLI for visitors; its public guidance matches `apps/artbin-cli/README.md`. `/dev/kitchen-sink` is the live component reference. `src/db/` and `drizzle/` own the SQLite schema and migrations. `src/lib/` owns storage and processing. The CLI lives in `apps/artbin-cli`; shared scan and upload code lives in `packages/artbin-core`.

## Local setup

From the Tea root, run `npm ci`, then `npm run artbin:dev`. Node 24.3 or newer, ImageMagick, and Playwright Chromium are needed for all preview paths. Local development uses an administrator account unless `ARTBIN_REQUIRE_AUTH=1`. Set `ARTBIN_DB_PATH`, `ARTBIN_PUBLIC_DIR`, and `ARTBIN_TEMP_DIR` to use separate local data paths; defaults are `data/artbin.db`, `public`, and `tmp/uploads`. See `.env.example` for Jack Auth settings. Set `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_PROJECT_ID`, `AUTH_ORGANIZATION_ID` and the resource server's `AUTH_INTROSPECTION_CLIENT_ID` / `AUTH_INTROSPECTION_SECRET`. Production uses `ARTBIN_URL=https://artbin.jackharrhy.dev`. Browser and CLI callbacks are `/auth/callback` and `/auth/cli/callback`.

## Checks and deployment

Run `npm run artbin:check` from the root or `npm run check --workspace @tea/artbin`. `Dockerfile` produces the Node image published by `.github/workflows/publish-artbin.yml`. Root `compose.yml` provides a local Artbin container. Production host configuration and data migration belong in the infrastructure repo; keep the database and uploads together when changing images. The container expects writable `data`, `public/uploads`, and `tmp/uploads` directories under `/app/apps/artbin`.

Artbin keeps its own UI and storage behavior inside this app. Artbin consumes the Tea map renderer through its public package entry points. Keep its preview behavior, visual assets, and component styles intact when updating the renderer.

## Central identity rollout

Stop Artbin and back up its SQLite database before applying the reviewed mapping
with Jack Auth's `scripts/link-consumer-identities.py --application artbin`.
The private manifest maps existing 4orm subjects to central subjects; it keeps
Artbin user IDs, asset ownership and folder ownership. Unknown identities and
collisions abort the transaction. Run this before starting the image that applies
`0006_central_identity.sql` and renames the identity column to `auth_subject`.
Never match accounts by username. A fresh database needs no legacy mapping.

The migration clears old browser sessions and CLI handoffs. Members sign in again
through Jack Auth; sessions last at most an hour and never outlive the central
identity proof. CLI handoffs remain single-use and cannot extend expired proof.
App access requires this project's `member` or `admin` role; administrator actions
use its `admin` role. The former global 4orm admin flag is not an authority here.

API machine tokens require this project's audience, its role claims and the
explicit requested role scopes for `assets-read` or `assets-content`. The Maps
service has only those two roles. MCP requires a human administrator, the `admin`
role scope and the mapped local administrator record. Protected-resource metadata
advertises the central issuer and full required scopes. `@tea/identity` verifies
tokens; local sessions, user records and authorization remain in this app.
