# tea/letters-to-steve

Letters to Steve is a correspondence site. Readers submit private letters with optional images; Steve reviews them in a protected inbox and can publish grouped answers. Public routes start closed on a new database. The app uses Remix 3, SQLite, and a small browser editor built with Tiptap. No other Tea workspace imports its private application code.

## Entry points and local setup

`server.ts` serves the Remix router from `app/router.ts`; `app/routes.ts` defines URLs, `app/actions/` contains route controllers, and `app/data/` owns SQLite and attachment storage. Committed migrations live in `db/migrations/`. `hmr.ts` is the optional browser HMR server. The former standalone checkout remains at `../letters-to-steve` for history and rollback reference.

From the Tea root, run `npm ci`, copy `apps/letters-to-steve/.env.example` to `apps/letters-to-steve/.env`, set `STEVE_ADMIN_PASSWORD`, then run `npm run letters-to-steve:dev`. Open <http://localhost:44110>. Alternatively, `docker compose up --build letters-to-steve` serves <http://letters.localhost> with an isolated data volume and a local development password. Set `STEVE_ADMIN_PASSWORD` before starting Compose to choose your own. The admin username is `steve`; its route is `/steve`.

Run `npm run letters-to-steve:check` for Tea formatting, lint, typecheck, and server tests. `npm run db:status --workspace @tea/letters-to-steve` reports migrations; `db:migrate` applies them. The server also applies committed migrations on startup. The editor enhances a working text-only form, so the public flow works without browser JavaScript.

## Runtime and data

`DATABASE_PATH` defaults to `./db/letters.sqlite`; `UPLOAD_DIRECTORY` defaults to `./tmp/uploads`. Keep both outside the public root and on persistent storage. The Docker image sets them to `/app/data/letters.sqlite` and `/app/data/uploads`, runs on Node 24, and listens on port 44110. Tea publishes `ghcr.io/jackharrhy/tea-letters-to-steve:latest` from `main`. Newport serves that image at <https://steve-letter-writ.ing> with Watchtower and a persistent store; routing, secrets, and rollback instructions live in the infrastructure repository's `hosts/newport/steve/README.md`.

Basic authentication protects `/steve`; serve it over HTTPS when deployed. `TRUST_PROXY=true` is appropriate only behind a proxy that overwrites forwarding headers. Image uploads accept JPEG, PNG, and WebP, convert to WebP, and have per-image and total size limits. The app does not send email; a private email address is only a reply handoff for Steve.
