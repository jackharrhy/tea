# Marky

A real time collaborative Markdown editor adapted from the former standalone Marky project. It uses Remix 3 stable, Node's Fetch server adapter, and a `ws` upgrade for Yjs collaboration. Yjs and ProseMirror synchronize files over `/ws`. Files are saved under `MARKY_CONTENT_DIR` after an idle debounce. Optional Git integration commits and pushes saved files.

## Entry points and setup

`server.ts` starts the Remix router and WebSocket endpoint. `app/router.tsx` wires HTTP routes; `app/middleware/websocket-server.ts` handles upgrades and `app/middleware/sockets.ts` owns collaboration and persistence. `app/data/content-store.ts` owns Markdown files. `app/ui/editor/` and `app/frontend/` own the browser editor.

From the repository root, run `npm ci`, then `npm run marky:dev`. The local server listens on port 44100. Alternatively, `docker compose up --build marky` serves the app at <http://md.localhost>. Local Compose uses anonymous access and an isolated `marky-data` volume.

Run `npm run check --workspace @harrhy/marky` for typecheck and server tests. `npm run marky:check` also runs shared formatting and linting. Run `npx remix doctor` from this workspace after framework structure changes.

Remix 3.2 applies a fresh CSP nonce to each editor document and its import map, generated styles, and browser entry. HTML is private and no-store. The policy permits the same-origin collaboration WebSocket; `style-src-attr` allows the editor's per-user color and cursor-position attributes.

## Runtime and deployment

The Docker image runs pointer-compressed Node 26 on Debian Trixie, with Git installed for optional commit and push. `MARKY_CONTENT_DIR=/app/data/content` and `MARKY_SESSION_DIR=/app/data/sessions` should use a persistent, writable volume. The image listens on port 44100. This repository publishes `ghcr.io/jackharrhy/marky` from `main`; production routing and secrets live in the infra repo.

Production at <https://md.jackharrhy.dev> uses `MARKY_AUTH=central`. It requires `AUTH_ISSUER`,
`AUTH_CLIENT_ID`, `AUTH_PROJECT_ID`, `AUTH_ORGANIZATION_ID`, the existing
`SESSION_SECRET`, and `MARKY_BASE_URL=https://md.jackharrhy.dev`. Register
`https://md.jackharrhy.dev/auth/callback` for a public PKCE client. Central
project member/admin grants control access; Jack holds the initial reviewed
grant. Successful sign-in keeps Marky's local session and name/color presence,
with at most a one-hour lifetime. Sessions from the retired login cannot
authorize the editor or WebSockets. Anonymous mode is for local development;
it allows anyone with access to edit all files.

Set `MARKY_GIT_REPO` to a mounted Git checkout containing the content directory if edits should be committed. `MARKY_GIT_PUSH=true` additionally requires `MARKY_GIT_PAT`. Without Git configuration, Marky still writes Markdown files to disk. See `.env.example` for optional settings. Keep content, sessions, and credentials out of Git.
