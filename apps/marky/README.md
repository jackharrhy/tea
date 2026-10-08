# tea/marky

A real time collaborative Markdown editor adapted from the standalone [Marky](https://github.com/jackharrhy/marky) project. It uses Remix 3 stable, Node's Fetch server adapter, and a `ws` upgrade for Yjs collaboration. Yjs and ProseMirror synchronize files over `/ws`. Files are saved under `MARKY_CONTENT_DIR` after an idle debounce. Optional Git integration commits and pushes saved files.

## Entry points and setup

`server.ts` starts the Remix router and WebSocket endpoint. `app/router.tsx` wires HTTP routes; `app/middleware/websocket-server.ts` handles upgrades and `app/middleware/sockets.ts` owns collaboration and persistence. `app/data/content-store.ts` owns Markdown files. `app/ui/editor/` and `app/frontend/` own the browser editor.

From the Tea root, run `npm ci`, then `npm run marky:dev`. The local server listens on port 44100. Alternatively, `docker compose up --build marky` serves the app at <http://md.localhost>. Local Compose uses anonymous access and an isolated `marky-data` volume.

Run `npm run check --workspace @tea/marky` for typecheck and server tests. `npm run marky:check` also runs shared formatting and linting. Run `npx remix doctor` from this workspace after framework structure changes.

## Runtime and deployment

The Docker image runs Node 24 on Debian Bookworm, with Git installed for optional commit and push. `MARKY_CONTENT_DIR=/app/data/content` and `MARKY_SESSION_DIR=/app/data/sessions` should use a persistent, writable volume. The image listens on port 44100. Tea publishes `ghcr.io/jackharrhy/tea-marky` from `main`; production routing and secrets live in the infra repo.

Production at <https://md.jackharrhy.dev> uses `MARKY_AUTH=discord`. It requires `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `SESSION_SECRET`, and `MARKY_BASE_URL=https://md.jackharrhy.dev`; `DISCORD_BOT_TOKEN` enables Discord role colors. The Discord application's OAuth callback must include `https://md.jackharrhy.dev/auth/callback`. Anonymous mode is for local development; it allows anyone with access to edit all files.

Set `MARKY_GIT_REPO` to a mounted Git checkout containing the content directory if edits should be committed. `MARKY_GIT_PUSH=true` additionally requires `MARKY_GIT_PAT`. Without Git configuration, Marky still writes Markdown files to disk. See `.env.example` for optional settings. Keep content, sessions, and credentials out of Git.
