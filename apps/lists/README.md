# tea/lists

Lists is a mailing-list application for subscriptions, campaign editing and delivery, inbound replies, and DMARC reports. One Bun process runs the Remix 3 routes, SQLite database, and AWS SES/SNS/SQS/S3 workers. The Tea deployment is authoritative. Public pages, admin pages, REST, MCP, and webhooks use Remix routers and one shared admin document.

## Entry points and local setup

`src/index.ts` starts the HTTP server and durable background workers. `src/http-app.ts` dispatches to the Remix routers in `app/`; `app/admin-router.tsx` and `app/admin.tsx` own the admin controllers and document. `app/admin-navigation.ts` owns the admin link list. The process drains or requeues mail work on SIGTERM before closing SQLite. `src/services/` owns mail and delivery behavior, `src/operations/` owns shared API and MCP operations, and `src/db/` plus `drizzle/` own the SQLite schema and ordered migrations. `emails/` contains the outbound templates.

Install from the Tea root with `npm ci` and use Bun 1.4.4 for execution. For local development, provide the environment described in `LOCAL_DEVELOPMENT.md`; run `npm run dev --workspace @harrhy/lists`. The app listens on port 8080. The local stack uses mocked AWS services and Mailpit. Do not use production AWS credentials for local tests.

Run `npm run check --workspace @harrhy/lists` for type checking, the isolated Bun test suite, and browser asset builds. The Compose-backed integration suite is `npm run test:local --workspace @harrhy/lists` after starting its local dependencies. Tests use synthetic in-memory databases and mocked SES unless explicitly marked as local stack tests.

## Boundaries and deployment

The database is the source of truth for subscriber and campaign state, recipient attempts, historical API tokens and OAuth records, and operator sessions. The delivery, scheduler, and inbound poller run in the same process. Keep confirmation, unsubscribe, bounce, and complaint behavior intact when changing routes. The production host, AWS resources, secrets, and DNS are managed in the Infra repository. The `lists.jackharrhy.dev` URL is the production entry point.

Production starts only with `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_PROJECT_ID`, `AUTH_ORGANIZATION_ID`, `AUTH_INTROSPECTION_CLIENT_ID`, and `AUTH_INTROSPECTION_SECRET` set. Browser sign-in uses the shared `@harrhy/identity` OIDC client, PKCE S256, signed ID token validation, and an exact human `auth_subject` lookup. Imported users retain local IDs, roles, and list assignments. A service account needs a separately reviewed subject and exact `client_id`; it can use only the REST API and the six source integration operations, subject to its local list assignment. Central mode does not mount the standalone OAuth issuer, local password login, or password-based user administration. The public callback is `${BASE_URL}/auth/callback`. Local Compose deliberately uses `NODE_ENV=development` and a synthetic password account so the mail stack can be exercised without live central credentials. Production import requires an explicit mapping for every local user; never derive one from email or display name.
