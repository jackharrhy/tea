# @harrhy/pool-app

Tea's Remix 3 pool hall. `app/router.ts` renders the hall and hydrates its canvas through `app/game/pool-game.tsx`; `server/index.ts` is the Bun authority for WebSocket play, guest sessions, optional account sign-in, owner controls, and the SQLite match and recording store. The renderer, physics prediction, and original sound and texture assets come from 8ballworld revision `ad1dc4446e1ab8e7b32111c95f6a3479ab8e532c`. Asset credits are in `public/audio/SOURCES.txt`, `public/textures/SOURCES.txt`, `public/textures/HALL-SOURCES.txt`, and `public/fonts/OFL.txt`.

## Develop and check

From the Tea root, install with `npm ci`. Bun 1.4.4 is required for the authoritative server and its tests. Run `npm run check --workspace @harrhy/pool-app` for typecheck, server/game tests, and both builds. Run `npm run test:browser --workspace @harrhy/pool-app` for an isolated production build browser and WebSocket smoke; it starts a disposable Bun server and database. Set `POOL_E2E_URL` to test an already running copy. For local play, run `npm run dev --workspace @harrhy/pool-app` after the build, then open `http://127.0.0.1:3188/`.

`DATA_DIR` chooses the writable SQLite directory, default `data`. `HOST` and `API_PORT` choose the public listener (default loopback and 3188). `WEB_ROOT` points at `dist/client`. `PUBLIC_ORIGIN` must match the browser origin for WebSocket admission. `UPDATE_CONTROL_PORT` binds a separate loopback-only listener; it is never a public route. `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, and `OWNER_SUBJECT` enable optional OIDC account and owner features. Guests and anonymous hall spectators work without those credentials. `POOL_RECORDINGS=0` disables shot recording. `APP_REVISION` labels builds and recordings.

## Boundaries

`@harrhy/pool`, `@harrhy/pool-simulation`, and `@harrhy/pool-protocol` hold shared rules, movement, and the versioned wire contract. The Bun app owns admission, match authority, persistence, account/owner policy, browser UI, and deployment lifecycle. The client may predict and render but cannot decide turns or results. `scripts/recordings.ts` lists, exports, and compares recordings without modifying the database.

The Remix canvas ref owns each client instance. Its abort signal closes the WebSocket, timers, input listeners, audio, prediction engine, and Three scene when the canvas unmounts. UI lookups and owner controls stay inside `#pool-root`; a new mount creates a new instance. The production browser smoke checks a navigation away and back, including socket closure and one remounted canvas.

The private pre-update hook in `server/pre-update.ts` must succeed before a live restart. Unfinished matches, including disconnected seats, block admission drain. Never expose its loopback port through a proxy or restart over a blocked receipt. Production routing, secrets, backups, and cutover belong to Infra and are outside this workspace.
