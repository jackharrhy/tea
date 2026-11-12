# @harrhy/burger

Tea's Remix 3 Burger frontend and Bun authoritative game server. `app/router.ts` renders the world and atlas pages; `app/game/burger-game.tsx` mounts the original Pixi renderer after hydration and disposes it on removal. `app/game/burger-tools.tsx` restores the source app's compact taskbar and movable, resizable Atlas, Spawn, Bots, Zones and Palette windows. The Atlas editor opens inside the game window; `/atlas` also remains available directly. Paint and zone brush keep their E and Z shortcuts. `server/server.ts` runs the authoritative simulation, OAuth/session routes, WebSocket replication and SQLite persistence. The source development-only debug window is not part of the production interface.

## Develop and check

Install from the Tea root with `npm ci` and use Bun 1.4.4. Run `npm run check --workspace @harrhy/burger-core` and `npm run check --workspace @harrhy/burger` for type checking, source tests and client/server builds. `npm run test:browser --workspace @harrhy/burger` runs the built app against a disposable copy of the synthetic fixture and exercises two browser sessions, floating-window drag/resize and Atlas, admin editing/member denial, movement, remount and disconnect. `npm run dev --workspace @harrhy/burger` starts the built app on port 5000.

The live server requires `AUTH_CLIENT_ID` and `AUTH_PROJECT_ID` for the registered Burger client. `AUTH_ISSUER` defaults to Jack Auth; `BURGER_URL` must match the registered callback origin. `DB_PATH` chooses the SQLite file (default `data/burger.db`); `PORT` chooses the HTTP/WebSocket listener (default 5000), and `WEB_ROOT` points at the built client assets. The root Compose service uses the `burger` profile and requires `BURGER_AUTH_CLIENT_ID`, `BURGER_AUTH_PROJECT_ID`, and a matching `BURGER_URL` before starting. This repo does not register provider callbacks.

## Boundaries

`@harrhy/burger-core` owns shared ECS/physics and protocol constants. This app owns the Pixi client, Remix UI, auth, transport, simulation authority, persisted local IDs and content, and Docker runtime. Do not identify a Burger user by display name or email: `users.auth_subject` maps a verified central subject to the stable local `users.id`. The WebSocket requires a valid session and the server enforces movement, paint and admin policy. Production DNS, provider registration, secrets, backups and cutover live outside Tea.

The Bun server handles SIGTERM/SIGINT by stopping the simulation timer, closing player sockets, stopping the listener, and closing SQLite before exit. The production browser smoke sends SIGTERM with a player still connected, checks bounded exit, then verifies the fixture database contents and integrity.
