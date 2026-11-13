# @harrhy/auth

Jack Auth's browser sign-in, consent, app directory, access management, enrollment, and support-login UI. ZITADEL remains the separate issuer and owns identities, passwords, sessions, grants, and token exchange. This app calls supported native APIs and stores only its own access ledger, Radio enrollment history, appearance choices, and short-lived browser state. It does not import `@harrhy/identity` as a privileged provider client.

`src/server.mjs` is the Node 26 entry point. Sign-in, delegated consent, account, email recovery, enrollment, device approval, the app directory, sessions, access management, People, groups, and service inventory use Remix components with one shared document shell in `src/document.tsx`. The Node entry uses Remix’s Web request listener and routers. Browser controller decisions still live in `src/server.mjs`, `src/access-routes.mjs`, and `src/support-routes.mjs` while they are separated by route. `config/applications.json` and `config/services.json` hold the app's reviewed client and directory policy. `integrations/` contains the native action source retained with its separate license. `__tests__/` holds the app's server and browser fixtures. The [architecture](docs/architecture.md), [support-login contract](docs/support-login.md), [product decisions](PRODUCT.md), and [design guide](DESIGN.md) provide details.

## Run and check

From the Harrhy root, run `npm ci`, then `npm run check --workspace @harrhy/auth`. The check typechecks the Remix component, runs the Node contract tests, and exercises the actual HTTP routes in Chromium against a synthetic issuer. The remaining plain stylesheet is served from `src/styles.css`; Tailwind is not used. Install Chromium once with `npx playwright install chromium` if needed. `npm run dev --workspace @harrhy/auth` starts the UI using an optional app-local `.env`; `docker compose --profile auth up --build auth` starts its opt-in local container at `auth.localhost`. A local UI can render without provider credentials, but real sign-in needs an approved local issuer/client and private mounted credentials.

### Real local sign-in

The opt-in profile in `local-real/` uses pinned ZITADEL 4.20.0 and PostgreSQL 17 images, this Auth UI, and the actual Artbin OAuth callback. It creates one synthetic organization user and an Artbin member grant. Its issuer and database are isolated from production; `@harrhy/dev-auth` remains the faster in-memory fixture for narrow checks. Docker is needed only for the provider and database. Node 26 and the repository dependencies run the two apps on loopback.

```sh
npm run auth:real:init
npm run auth:real:up
npm run auth:real:seed
```

In separate foreground terminals, run `npm run auth:real:ui` and `npm run auth:real:artbin`. Then open <http://localhost:18892/login> or run `npm run auth:real:smoke` for a browser sign-in, native authorization code, Artbin callback, session, and reload check. Stop the app terminals with Ctrl-C and run `npm run auth:real:down` to stop the provider. `down` preserves its local database and credentials for the next start. The generated local sign-in password is in the ignored, mode 0600 `apps/auth/.local-real/seed.json`; do not paste it into issues or logs. The local Auth UI is <http://localhost:18888>, and the native issuer is bound to <http://localhost:18887> only. Ports 18887, 18888, and 18892 must be free before starting. No standard dev command or CI job starts this profile.

The native setup writes only synthetic project/client IDs to local configuration. The operator PAT, login PAT, database password, master key, resource client secret, and local user password stay under ignored `apps/auth/.local-real/`. The committed production client IDs, callback URLs, role names, and issuer URLs in `config/` are public identifiers and policy, not credentials. Production keys, tokens, account records, and SQLite files are never copied into the local profile. The provider and Artbin share no database. `local-real/seed.mjs` checkpoints each native creation; if one fails with an uncertain outcome, it stops instead of creating a duplicate on retry.

The app is independently containerized by `Dockerfile`. Production settings, DNS, sealed credential files, both SQLite data files, appearance state, and backups are owned by Infra. Set `PUBLIC_ORIGIN`, `ZITADEL_API_URL`, `ORGANIZATION_ID`, the reviewed client/project IDs, and the relevant read-only credential file paths there. Keep `ACCESS_DB_FILE`, `RADIO_ENROLLMENT_DB_FILE`, `DOODLE_POOL_FILE`, and `AUTH_SUPPORT_CONFIG_FILE` with their existing data and recovery material. An Auth UI restart invalidates in-memory browser and support sessions; durable support cleanup still uses the sealed support key and access database. No source import or container build activates native impersonation.

## Routing migration boundary

Sign-in, delegated consent, account, email recovery, enrollment, device approval, the app directory, sessions, access management, People, groups, and service inventory now render through Remix 3 and use `@harrhy/ui` controls. All browser pages now render with Remix 3 components, including support and failure states. Public assets, health, enrollment completion, issuer policy, and support JSON endpoints now use Remix Web Request/Response routers. Browser requests now enter through a Remix Web Request/Response router. Account details, email verification and recovery, password, authorization, device, app directory, management, and support actions now enter through explicit Remix routes. The browser controller still dispatches login and enrollment centrally; those remain to split into route-owned controllers and middleware before replacing the standalone Auth deployment. The shell layout and shared controls use Remix `css(...)` mixins; the remaining plain stylesheet still needs to shrink to font and unsupported features. ZITADEL and its state remain separate. `@harrhy/identity` stays a consumer validation/client package.

## License

The app's `LICENSE` is MIT, as in the standalone repository's original committed license. The later standalone README line calling the whole repository AGPL-only conflicted with that file. `integrations/identity-claims.js` and `integrations/lore-claims.js` retain their AGPL-3.0-only SPDX headers and license text in `LICENSES/`; the Inter font retains its OFL notice in `public/fonts/`.
