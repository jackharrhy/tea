# @tea/ref

A small, private board for images and links. This Tea app is adapted from the separate Ref repository and was inspired by [metalfinger/refboard](https://github.com/metalfinger/refboard). It uses Remix 3, a Worker, SQLite Durable Objects, native WebSockets, and R2-compatible image storage. There are no user accounts or shared spaces. One password opens every board. The original Ref deployment remains independent while this copy is validated.

## Run locally

Requires Node.js 24.3+ and npm. From the Tea root:

```sh
npm ci
cp apps/ref/.dev.vars.example apps/ref/.dev.vars
# Edit REF_PASSWORD in apps/ref/.dev.vars
npm run ref:dev
```

Open <http://localhost:8787>. Enter the password and create a board. Add images with the button, drag and drop, or paste. Add links with **Add link**, by pasting a URL, or by dropping one onto the board. Link cards show the complete preview image; select one for metadata and the original post. Drag a card to move it; select it to resize, rotate, or remove it. Scroll or drag the background to pan; pinch or use the buttons to zoom. On narrow screens, item details open below the board.

`.dev.vars` is ignored by Git. Wrangler stores local board and image data under `apps/ref/.wrangler/`. The original Ref repository's local and production data is not copied into Tea. Changing the password invalidates existing sessions; **Lock** ends the current session.
On Cloudflare, sign-in pauses after ten password attempts from the same client in ten minutes. The self-hosted deployment limits login requests by client IP at the public reverse proxy.

## How it works

- `worker.ts` checks the password secret and resolves an opaque session cookie.
- `DirectoryCell` stores sessions and the board list in SQLite. Existing boards from the previous account-based version are copied into the single-user list on first access. Old account sessions no longer work.
- `BoardCell` stores items, link previews, and image metadata per board. It validates edits, writes them to SQLite, and broadcasts updates to every open tab with hibernatable WebSockets.
- Removing the last item that uses an asset reclaims its metadata and stored image. Failed object-store deletions are retried by a Durable Object alarm. The operation log keeps roughly 10,000 recent edits per board; retries older than that window are no longer deduplicated.
- `MEDIA` stores uploaded images and cached link preview images. Reads and uploads require a valid session.
- `app/assets/board.ts` is the browser editor. It uses DOM APIs, pan and zoom, uploads, optimistic edits, reconnect, and revision checks. No React, Express, or Socket.IO.

Images may be PNG, JPEG, GIF, or WebP, up to 20 MB each. Link previews are best effort: blocked sites still save as URL cards, and Twitter, YouTube, or Instagram embeds depend on those services remaining available. Ref stores the title, description, and cached preview image, but not a full page archive. See [the Karakeep workflow notes](docs/karakeep-notes.md) for what this first version covers. The password grants access to all boards, so keep it private.

## Checks

```sh
npm run ref:check
```

The browser smoke test uses a separate local instance so it does not add a test board to your main data:

```sh
cd apps/ref
../../node_modules/.bin/wrangler dev --port 8788 --persist-to /tmp/tea-ref-smoke
cd ../..
REF_SMOKE_PASSWORD='the-value-in-.dev.vars' npm run smoke --workspace @tea/ref
```

Tea CI runs this smoke against a temporary Wrangler store and generated password when Ref is affected.

Ref also runs a production-style Celld check using an isolated SQLite object store and random password. It runs the browser smoke, kills Celld, removes its replica cache, then verifies the board, links, and WebSocket from the authoritative store. CI extracts the Celld binary from the image selected by this app's Dockerfile. To run the same check locally:

```sh
CELLD_BIN=/absolute/path/to/celld npm run test:celld --workspace @tea/ref
```

## Back up and restore

The archive commands use the same password as the app. Set `REF_PASSWORD` in your shell or secret manager, and set `REF_URL` to the instance you want to access:

```sh
REF_URL=https://ref.example.com npm run backup --workspace @tea/ref -- /safe/place/ref-backup
REF_URL=https://new-ref.example.com npm run restore --workspace @tea/ref -- /safe/place/ref-backup
```

The backup command creates a new directory containing `manifest.json`, uploaded images, and cached link preview images. It fails if that directory already exists or a board changes while it is being copied. Keep the directory private: it contains your board contents. Restore preserves board and item IDs, layout, link metadata, and image bytes. It verifies every file before changing the destination and reads the restored board and images back afterward. Run it against an empty instance; if a restore is interrupted, rerun the same command to resume. A destination with unrelated boards is rejected.

Archives contain the current board state, not edit history or full copies of linked web pages. Link preview images that were never cached still depend on their external URLs.

## Hosting

For a separate Cloudflare deployment of this Tea copy, create the `tea-ref-media` R2 bucket, set `REF_PASSWORD` as a Worker secret, then build and deploy from `apps/ref`. The Worker is named `tea-ref`; it does not share the original Ref Worker or bucket. Use HTTPS on the public address. [Cloudflare's secret documentation](https://developers.cloudflare.com/workers/configuration/secrets/) covers local and deployed secrets.

For a self-hosted runtime, [Celld](https://celld.dev/docs/) accepts this Wrangler configuration and can run it locally with `npm run dev:celld`. It reads `.dev.vars` for local development. A Celld fleet deployment needs `REF_PASSWORD` in the private deployment configuration; `celld deploy` does not read `.dev.vars`. See [Celld's deployment instructions](https://celld.dev/docs/) for storage and node setup. Use the archive commands before moving a production instance.

### Local container and eventual cutover

Tea's root `compose.yml` builds `apps/ref/Dockerfile` and serves `ref.localhost` with a separate `ref-data` volume. It uses `REF_PASSWORD` from the Compose environment, or a local development password if unset. Celld stores its authoritative SQLite object store under `/app/.celld/object-store/` and replicas under `/app/.celld/state/`; preserve the entire mount for backups. The original Newport deployment and `ghcr.io/jackharrhy/ref` image remain sourced from the original repository during the bake period. Moving production requires a verified backup, restore into the new store, and a separate infrastructure update.
