# @harrhy/ref

A small, private board for images and links. It presents itself as Ref while retaining Ref's board format and storage contract. This app was adapted from the former standalone Ref repository and was inspired by [metalfinger/refboard](https://github.com/metalfinger/refboard). It uses Remix 3, a Worker, SQLite Durable Objects, native WebSockets, and R2-compatible image storage. Every approved member sees the same boards; there are no per-user spaces. The Newport production deployment runs this workspace's container image. Shared control styles come from [`@harrhy/ui`](../../packages/ui/README.md); Ref supplies its palette, board layout, and canvas presentation in `app/styles.ts`.

Jack Auth production sign-in uses `AUTH_ISSUER`, `AUTH_CLIENT_ID`,
`AUTH_PROJECT_ID`, `AUTH_ORGANIZATION_ID`, and
`AUTH_PUBLIC_ORIGIN=https://ref.jackharrhy.dev` together. Register the exact
public PKCE callback `https://ref.jackharrhy.dev/auth/callback`. An app
member/admin grant opens the shared boards; board and asset IDs stay stable.
The first Jack Auth grant is for Jack only; other users can be admitted later
without changing the board format.
Jack Auth sessions in `DirectoryCell` carry a subject and expire within one hour.
Old password sessions cannot authorize Ref. Local development uses the same OAuth
callback and subject-bound session code as production, with the disposable
[`@harrhy/dev-auth`](../../packages/dev-auth/README.md) issuer. The archive CLI
uses a delegated resource token.

## Run locally

Requires Node.js 26 LTS (26.13.0+) and npm. From the Harrhy root:

```sh
npm ci
cp apps/ref/.dev.vars.example apps/ref/.dev.vars
npm run ref:dev
```

Open <http://127.0.0.1:8787>. Select **Sign in with Jack Auth**, then continue as the disposable local user. This runs authorization code with PKCE S256, signed ID-token verification, userinfo, and the ordinary Ref callback. The local issuer has its own test subject and grants; it cannot authenticate a production account. Create a board, then add images with the button, drag and drop, or paste. Add links with **Add link**, by pasting a URL, or by dropping one onto the board. Link cards show the complete preview image; select one for metadata and the original post. Drag a card to move it; select it to resize, rotate, or remove it. Scroll or drag the background to pan; pinch or use the buttons to zoom. On narrow screens, item details open below the board.

`.dev.vars` is ignored by Git. Wrangler stores local board and image data under `apps/ref/.wrangler/`. Newport's production data lives in a separate Celld store; local development does not share it. **Lock** ends the current Ref session. Stopping the local issuer invalidates its in-memory codes and tokens; Ref sessions expire within one hour.
`/health` is process liveness; `/ready` also reads the directory store so startup and crash-recovery checks wait until sessions can be served.

## How it works

- `worker.ts` requires Jack Auth configuration, validates the OAuth callback, and resolves an opaque subject-bound session cookie.
- `DirectoryCell` stores sessions and the board list in SQLite. Existing boards from the previous account-based version are copied into the single-user list on first access. Old account sessions no longer work.
- `BoardCell` stores items, link previews, and image metadata per board. It validates edits, writes them to SQLite, and broadcasts updates to every open tab with hibernatable WebSockets.
- Removing the last item that uses an asset reclaims its metadata and stored image. Failed object-store deletions are retried by a Durable Object alarm. The operation log keeps roughly 10,000 recent edits per board; retries older than that window are no longer deduplicated.
- `MEDIA` stores uploaded images and cached link preview images. Reads and uploads require a valid session.
- `app/assets/board.ts` is the browser editor. It uses DOM APIs, pan and zoom, uploads, optimistic edits, reconnect, and revision checks. No React, Express, or Socket.IO.
- Remix 3.2 supplies a fresh CSP nonce for each HTML response. Ref allows its same-origin scripts, thumbnail worker, board WebSocket, stored and external link images, validated X video media, and the three explicitly supported social embeds. Private HTML remains `no-store`.

Images may be PNG, JPEG, GIF, or WebP, up to 20 MB each. Link previews are best effort: blocked sites still save as URL cards, and Twitter, YouTube, or Instagram embeds depend on those services remaining available. Numbered X photo links use FxTwitter's post metadata to select the linked image; if that lookup fails, Ref leaves the card image empty rather than showing a different photo. X video links use a validated remote MP4 with a cached poster and native playback controls; Ref does not copy the video. Ref stores the title, description, and cached preview image, but not a full page archive. Select a link and use **Refresh preview** to update an older thumbnail-only card or retry a stale preview; the existing card stays in place if Ref cannot obtain usable replacement media. See [the Karakeep workflow notes](docs/karakeep-notes.md) for what this first version covers. The local issuer grants access only to the isolated development store; production uses reviewed Jack Auth grants.

## Checks

```sh
npm run ref:check
```

Harrhy CI runs the browser smoke against a temporary Wrangler store and the local OAuth issuer when Ref is affected on a ready PR or `main`. It does not add a test board to your local development store.

Ref also runs a production-style Celld check using an isolated SQLite object store and the local OAuth issuer. It runs the browser smoke, kills Celld, removes its replica cache, then verifies the board, links, and WebSocket from the authoritative store. CI extracts the Celld binary from the image selected by this app's Dockerfile. To run the same check locally:

```sh
CELLD_BIN=/absolute/path/to/celld npm run test:celld --workspace @harrhy/ref
```

## Back up and restore

The archive commands require a short-lived delegated `REF_ACCESS_TOKEN` or a
private `REF_ACCESS_TOKEN_FILE`. For a local disposable archive check, use
`node packages/dev-auth/token.mjs /private/new-token-file` and point
`REF_ACCESS_TOKEN_FILE` to that file; remove it afterward.
Backup requires a Ref admin grant plus `archive-read` role and scope.
Restore requires the admin grant and both `archive-read` and `archive-restore`
roles/scopes; a browser cookie alone never authorizes archive routes. The
Worker introspects archive requests, board snapshot reads, and image downloads. Resource metadata
is at `/.well-known/oauth-protected-resource/api/archive`. Set `REF_URL` to
the instance you want to access:

```sh
REF_URL=https://ref.example.com npm run backup --workspace @harrhy/ref -- /safe/place/ref-backup
REF_URL=https://new-ref.example.com npm run restore --workspace @harrhy/ref -- /safe/place/ref-backup
```

The backup command creates a new directory containing `manifest.json`, uploaded images, and cached link preview images. It fails if that directory already exists or a board changes while it is being copied. Keep the directory private: it contains your board contents. Restore preserves board and item IDs, layout, link metadata, and image bytes. It verifies every file before changing the destination and reads the restored board and images back afterward. Run it against an empty instance; if a restore is interrupted, rerun the same command to resume. A destination with unrelated boards is rejected.

Archives contain the current board state, not edit history or full copies of linked web pages. Link preview images that were never cached still depend on their external URLs. Restore recreates item revision counters; clients should reload after a cutover.

With an original Ref checkout and Celld installed, run `npm run test:archive:source --workspace @harrhy/ref` to verify the transfer path. Set `REF_SOURCE_ROOT` to that checkout. This optional check creates a board with an image and link in disposable local source storage, backs it up with the original Ref archive command, restores it into a separate Tea Ref store twice, and compares the resulting archive. It does not read a live deployment or production data. The former local source checkout was removed after production cutover.

## Hosting

For a separate Cloudflare deployment, create the `tea-ref-media` R2 bucket and configure the Jack Auth browser and server-side introspection fields shown in `.dev.vars.example` with real reviewed values. The Worker is named `tea-ref`; it does not share the original Ref Worker or bucket. Use HTTPS on the public address and register its exact callback. [Cloudflare's secret documentation](https://developers.cloudflare.com/workers/configuration/secrets/) covers deployed secrets.

For a self-hosted runtime, [Celld](https://celld.dev/docs/) accepts this Wrangler configuration and can run it locally with `npm run dev:celld`. It reads `.dev.vars` for local development. A Celld fleet deployment needs the Jack Auth fields in private configuration; `celld deploy` does not read `.dev.vars`. See [Celld's deployment instructions](https://celld.dev/docs/) for storage and node setup. Use the archive commands before moving a production instance.

### Local container and production

The root `compose.yml` builds `apps/ref/Dockerfile`, serves `ref.localhost` with a separate `ref-data` volume, and starts the disposable local issuer at `ref-auth.localhost:8786`. Both use the same OAuth flow as `npm run ref:dev`; the issuer registration is exact to this local callback. Celld stores its authoritative SQLite object store under `/app/.celld/object-store/` and replicas under `/app/.celld/state/`; preserve the entire mount for backups. The `publish-ref` workflow builds and checks the app when Ref or its build inputs change on `main`, then publishes `ghcr.io/jackharrhy/ref:latest` and a commit tag. Newport uses `:latest` and Watchtower to deploy new main builds. See the infrastructure repository's `hosts/newport/ref/README.md` for its store and deployment path.

The Dockerfile pins the fork's Celld 0.6.2 image by digest. Its published binary matches the release binary used for Ref's browser and cold-restore smoke. Pass `--build-arg CELLD_IMAGE=<image>` to rehearse another runtime on an isolated store.
