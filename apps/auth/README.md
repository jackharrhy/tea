# @harrhy/auth

Jack Auth's browser sign-in, consent, app directory, access management, enrollment, and support-login UI. ZITADEL remains the separate issuer and owns identities, passwords, sessions, grants, and token exchange. This app calls supported native APIs and stores only its own access ledger, Radio enrollment history, appearance choices, and short-lived browser state. It does not import `@harrhy/identity` as a privileged provider client.

`src/server.mjs` is the Node 26 entry point. `src/authorization.mjs`, `src/access-routes.mjs`, and `src/support-routes.mjs` own the three sensitive HTTP flows. `config/applications.json` and `config/services.json` hold the app's reviewed client and directory policy. `integrations/` contains the native action source retained with its separate license. `__tests__/` holds the app's server and browser fixtures. The [architecture](docs/architecture.md), [support-login contract](docs/support-login.md), [product decisions](PRODUCT.md), and [design guide](DESIGN.md) provide details.

## Run and check

From the Harrhy root, run `npm ci`, then `npm run check --workspace @harrhy/auth`. The check runs the Node contract tests, builds the stylesheet, and exercises the actual HTTP routes in Chromium against a synthetic issuer. Install Chromium once with `npx playwright install chromium` if needed. `npm run dev --workspace @harrhy/auth` starts the UI using an optional app-local `.env`; `docker compose --profile auth up --build auth` starts its opt-in local container at `auth.localhost`. A local UI can render without provider credentials, but real sign-in needs an approved local issuer/client and private mounted credentials.

The app is independently containerized by `Dockerfile`. Production settings, DNS, sealed credential files, both SQLite data files, appearance state, and backups are owned by Infra. Set `PUBLIC_ORIGIN`, `ZITADEL_API_URL`, `ORGANIZATION_ID`, the reviewed client/project IDs, and the relevant read-only credential file paths there. Keep `ACCESS_DB_FILE`, `RADIO_ENROLLMENT_DB_FILE`, `DOODLE_POOL_FILE`, and `AUTH_SUPPORT_CONFIG_FILE` with their existing data and recovery material. An Auth UI restart invalidates in-memory browser and support sessions; durable support cleanup still uses the sealed support key and access database. No source import or container build activates native impersonation.

## Routing migration boundary

This first workspace keeps the current Node HTTP router and server-rendered forms so that the existing login, recovery, consent, enrollment, and support contracts can be checked before route conversion. It is a temporary framework exception. The next source slice will move app routing and presentation to Remix 3 conventions while preserving these contracts; ZITADEL and its state remain separate. `@harrhy/identity` stays a consumer validation/client package.

## License

The app's `LICENSE` is MIT, as in the standalone repository's original committed license. The later standalone README line calling the whole repository AGPL-only conflicted with that file. `integrations/identity-claims.js` and `integrations/lore-claims.js` retain their AGPL-3.0-only SPDX headers and license text in `LICENSES/`; the Inter font retains its OFL notice in `public/fonts/`.
